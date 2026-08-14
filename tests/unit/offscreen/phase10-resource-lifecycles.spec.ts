import { afterEach, describe, expect, it, vi } from "vitest"

import { ArchiveWorkerSession } from "@/entrypoints/offscreen/archive-worker-session"
import { BrowserBlobLeaseRegistry } from "@/entrypoints/offscreen/browser-blob-lease-registry"
import { processNoneFormatChapter } from "@/entrypoints/offscreen/chapter-processing"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image-core"
import { descrambleGigaviewerImage } from "@/src/site-integrations/shonenjumpplus/gigaviewer-image"
import {
  OffscreenLiveResourceLedger,
  OFFSCREEN_LIVE_RESOURCE_CAP_BYTES,
} from "@/src/runtime/offscreen-live-resource-ledger"
import { MAX_ARCHIVE_BYTES, MAX_IMAGE_BYTES } from "@/src/constants/timeouts"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { RateLimitService } from "@/src/runtime/rate-limit"

const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_integrationId: string, _scope: string, task: () => Promise<T>) =>
      task()
  ),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService

class WorkerStub {
  onmessage: Worker["onmessage"] = null
  onerror: Worker["onerror"] = null
  postMessage = vi.fn()
  terminate = vi.fn()
}

const incarnation = {
  jobId: "job-1",
  attempt: 1,
  taskId: "task-1",
  chapterId: "chapter-1",
  fingerprint: "a".repeat(64),
  documentInstanceId: "document-1",
}

describe("Phase 10 offscreen resource lifecycles", () => {
  afterEach(() => vi.useRealTimers())

  it("times out only finalization and disposes an archive worker once", async () => {
    vi.useFakeTimers()
    const worker = new WorkerStub()
    const session = new ArchiveWorkerSession(
      worker as unknown as Worker,
      undefined,
      10
    )

    session.post({ type: "init", chapterTitle: "Chapter" })
    await vi.advanceTimersByTimeAsync(100)
    expect(session.getState()).toBe("collecting")

    const result = expect(session.finalize()).rejects.toThrow(
      "Zip worker timed out"
    )
    await vi.advanceTimersByTimeAsync(10)
    await result
    expect(session.getState()).toBe("settled")

    session.dispose()
    session.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(session.getState()).toBe("disposed")
  })

  it("stores a collection-phase worker failure without an unhandled rejection", async () => {
    const worker = new WorkerStub()
    const session = new ArchiveWorkerSession(worker as unknown as Worker)
    const failure = new Error("worker failed while collecting")

    worker.onerror?.call(
      worker as unknown as Worker,
      { error: failure } as ErrorEvent
    )

    expect(session.getState()).toBe("settled")
    await expect(session.finalize()).rejects.toThrow(failure)
    session.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it("retains an early archive failure and rejects finalization without posting or timing out", async () => {
    vi.useFakeTimers()
    const worker = new WorkerStub()
    const session = new ArchiveWorkerSession(
      worker as unknown as Worker,
      undefined,
      10
    )

    worker.onmessage?.call(
      worker as unknown as Worker,
      {
        data: { success: false, error: "archive input failed" },
      } as MessageEvent
    )

    expect(session.getState()).toBe("settled")
    await expect(session.finalize()).rejects.toThrow("archive input failed")
    expect(worker.postMessage).not.toHaveBeenCalledWith({ type: "finalize" })
    expect(vi.getTimerCount()).toBe(0)

    worker.onmessage?.call(
      worker as unknown as Worker,
      {
        data: {
          success: true,
          buffer: new ArrayBuffer(1),
          filename: "late.zip",
        },
      } as MessageEvent
    )
    expect(session.getState()).toBe("settled")
  })

  it("rejects an active finalizer once and clears its timer", async () => {
    vi.useFakeTimers()
    const worker = new WorkerStub()
    const session = new ArchiveWorkerSession(
      worker as unknown as Worker,
      undefined,
      10
    )

    const result = expect(session.finalize()).rejects.toThrow("deflate failed")
    expect(vi.getTimerCount()).toBe(1)
    worker.onmessage?.call(
      worker as unknown as Worker,
      {
        data: { success: false, error: "deflate failed" },
      } as MessageEvent
    )

    await result
    expect(session.getState()).toBe("settled")
    expect(vi.getTimerCount()).toBe(0)

    worker.onmessage?.call(
      worker as unknown as Worker,
      {
        data: { success: false, error: "late failure" },
      } as MessageEvent
    )
    expect(session.getState()).toBe("settled")
  })

  it("enforces aggregate Blob count and bytes while requiring exact revoke identity", () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second")
    const revokeObjectURL = vi.fn()
    const registry = new BrowserBlobLeaseRegistry(
      { maxCount: 2, maxBytes: 5 },
      { createObjectURL, revokeObjectURL }
    )

    const first = registry.retain({
      ...incarnation,
      outputId: "output-1",
      blob: new Blob([new Uint8Array(3)]),
    })
    const second = registry.retain({
      ...incarnation,
      outputId: "output-2",
      blob: new Blob([new Uint8Array(2)]),
    })
    expect(registry.getRetainedCount()).toBe(2)
    expect(registry.getRetainedBytes()).toBe(5)
    expect(
      registry.revoke({ ...first, documentInstanceId: "wrong-document" })
    ).toBe(false)
    expect(registry.getRetainedBytes()).toBe(5)
    expect(registry.revoke(first)).toBe(true)
    expect(registry.getRetainedBytes()).toBe(2)

    registry.dispose()
    registry.dispose()
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledWith(second.blobUrl)
    expect(registry.getRetainedCount()).toBe(0)
  })

  it("rejects aggregate Blob growth before creating another URL", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:lease")
    const registry = new BrowserBlobLeaseRegistry(
      { maxCount: 1, maxBytes: 4 },
      { createObjectURL, revokeObjectURL: vi.fn() }
    )
    registry.retain({
      ...incarnation,
      outputId: "output-1",
      blob: new Blob([new Uint8Array(4)]),
    })
    expect(() =>
      registry.retain({
        ...incarnation,
        outputId: "output-2",
        blob: new Blob([new Uint8Array(1)]),
      })
    ).toThrow("count limit")
    expect(createObjectURL).toHaveBeenCalledOnce()
  })

  it("rejects aggregate retained bytes before creating another URL", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:lease")
    const registry = new BrowserBlobLeaseRegistry(
      { maxCount: 2, maxBytes: 4 },
      { createObjectURL, revokeObjectURL: vi.fn() }
    )
    registry.retain({
      ...incarnation,
      outputId: "output-1",
      blob: new Blob([new Uint8Array(4)]),
    })
    expect(() =>
      registry.retain({
        ...incarnation,
        outputId: "output-2",
        blob: new Blob([new Uint8Array(1)]),
      })
    ).toThrow("byte limit")
    expect(createObjectURL).toHaveBeenCalledOnce()
  })

  it("reserves, resizes, transfers, and idempotently releases exact live-resource leases", () => {
    const ledger = new OffscreenLiveResourceLedger(10)
    const first = ledger.reserve(6, "first")

    expect(ledger.getUsedBytes()).toBe(6)
    first.resize(4)
    expect(first.bytes).toBe(4)
    expect(ledger.getUsedBytes()).toBe(4)

    const transferred = first.transfer("transferred")
    expect(first.bytes).toBe(0)
    expect(transferred.bytes).toBe(4)
    expect(ledger.getUsedBytes()).toBe(4)

    expect(() => ledger.reserve(7, "overflow")).toThrow(
      "Offscreen live resource cap exceeded"
    )
    expect(ledger.getUsedBytes()).toBe(4)

    transferred.release()
    transferred.release()
    first.release()
    expect(ledger.getUsedBytes()).toBe(0)
    expect(ledger.getCapacityBytes()).toBe(10)
    expect(OFFSCREEN_LIVE_RESOURCE_CAP_BYTES).toBe(1024 * 1024 * 1024)
  })

  it("admits queued live-resource acquisitions in FIFO order as capacity is released", async () => {
    const ledger = new OffscreenLiveResourceLedger(10)
    const held = ledger.reserve(8, "held")
    const admitted: string[] = []

    const firstPromise = ledger.acquire("first", 4).then((lease) => {
      admitted.push("first")
      return lease
    })
    const secondPromise = ledger.acquire("second", 2).then((lease) => {
      admitted.push("second")
      return lease
    })

    await Promise.resolve()
    expect(admitted).toEqual([])

    held.resize(6)
    const first = await firstPromise
    expect(admitted).toEqual(["first"])
    expect(ledger.getUsedBytes()).toBe(10)

    first.release()
    const second = await secondPromise
    expect(admitted).toEqual(["first", "second"])
    expect(ledger.getUsedBytes()).toBe(8)

    second.release()
    held.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("removes and rejects an aborted queued live-resource acquisition", async () => {
    const ledger = new OffscreenLiveResourceLedger(10)
    const held = ledger.reserve(8, "held")
    const controller = new AbortController()
    const abortReason = new Error("job-cancelled")
    const queued = ledger.acquire("queued", 4, controller.signal)
    const follower = ledger.acquire("follower", 2)
    const rejection = expect(queued).rejects.toBe(abortReason)

    controller.abort(abortReason)
    await rejection

    const admitted = await follower
    expect(ledger.getUsedBytes()).toBe(10)
    admitted.release()
    held.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("adopts a prepared Blob lease without eviction and releases it on exact revoke", () => {
    const ledger = new OffscreenLiveResourceLedger(5)
    const prepared = ledger.reserve(3, "prepared Blob")
    const createObjectURL = vi.fn().mockReturnValue("blob:lease")
    const registry = new BrowserBlobLeaseRegistry(
      { maxCount: 2, maxBytes: 5 },
      { createObjectURL, revokeObjectURL: vi.fn() },
      ledger
    )
    const identity = registry.retain({
      ...incarnation,
      outputId: "output-1",
      blob: new Blob([new Uint8Array(3)]),
      resourceLease: prepared,
    })

    expect(prepared.bytes).toBe(0)
    expect(ledger.getUsedBytes()).toBe(3)
    expect(() => ledger.reserve(3, "later job")).toThrow(
      "Offscreen live resource cap exceeded"
    )
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(registry.getRetainedCount()).toBe(1)

    expect(registry.revoke(identity)).toBe(true)
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("retains exact archive inputs until one matching worker acknowledgement", async () => {
    const ledger = new OffscreenLiveResourceLedger(30)
    const archiveAllowance = ledger.reserve(20, "archive allowance")
    const worker = new WorkerStub()
    const session = new ArchiveWorkerSession(
      worker as unknown as Worker,
      undefined,
      10,
      archiveAllowance
    )
    const inputLease = ledger.reserve(3, "archive input")
    const inputBuffer = new ArrayBuffer(3)

    session.post(
      {
        type: "addImage",
        inputId: "input-1",
        filename: "001.jpg",
        buffer: inputBuffer,
      },
      [inputBuffer],
      inputLease
    )
    expect(inputLease.bytes).toBe(0)
    expect(ledger.getUsedBytes()).toBe(23)

    worker.onmessage?.call(
      worker as unknown as Worker,
      {
        data: { type: "input-consumed", inputId: "input-1" },
      } as MessageEvent
    )
    expect(ledger.getUsedBytes()).toBe(20)
    worker.onmessage?.call(
      worker as unknown as Worker,
      {
        data: { type: "input-consumed", inputId: "input-1" },
      } as MessageEvent
    )
    expect(ledger.getUsedBytes()).toBe(20)

    const finalized = session.finalize()
    worker.onmessage?.call(
      worker as unknown as Worker,
      {
        data: {
          success: true,
          buffer: new ArrayBuffer(4),
          filename: "chapter.zip",
        },
      } as MessageEvent
    )
    const result = await finalized
    expect(ledger.getUsedBytes()).toBe(4)
    session.dispose()
    expect(ledger.getUsedBytes()).toBe(4)
    result.liveResourceLease?.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("releases retained encoded ownership when renderer validation fails", async () => {
    const ledger = new OffscreenLiveResourceLedger(4)
    const sourceLease = ledger.reserve(4, "invalid encoded image")
    vi.stubGlobal("createImageBitmap", vi.fn())
    vi.stubGlobal("OffscreenCanvas", class {})

    await expect(
      descrambleGigaviewerImage(
        new ArrayBuffer(4),
        "image/png",
        undefined,
        ledger,
        sourceLease
      )
    ).rejects.toThrow()

    vi.unstubAllGlobals()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("keeps cover, page source, and Blob leases through pending none-format handoffs", async () => {
    const ledger = new OffscreenLiveResourceLedger(3)
    const coverData = new Uint8Array([1]).buffer
    const coverLease = ledger.reserve(coverData.byteLength, "retained cover")
    const handoffResolvers: Array<
      (response: {
        success: true
        disposition: "tracked"
        phase: "waiting"
      }) => void
    > = []
    const requestBrowserBlobDownload = vi.fn(
      () =>
        new Promise<{
          success: true
          disposition: "tracked"
          phase: "waiting"
        }>((resolve) => {
          handoffResolvers.push(resolve)
        })
    )
    let resolvePage!: (result: {
      data: ArrayBuffer
      filename: string
      mimeType: string
      liveResourceLease: ReturnType<OffscreenLiveResourceLedger["reserve"]>
    }) => void
    const downloadImage = vi.fn(
      () =>
        new Promise<{
          data: ArrayBuffer
          filename: string
          mimeType: string
          liveResourceLease: ReturnType<OffscreenLiveResourceLedger["reserve"]>
        }>((resolve) => {
          resolvePage = resolve
        })
    )
    const processing = processNoneFormatChapter(
      {
        liveResourceLedger: ledger,
        rateLimitService,
        withImageRetries: async (operation) => operation(),
        resolveWritableDownloadRoot: vi.fn(),
        requestBrowserBlobDownload,
        getMemoryStats: () => null,
      },
      {
        opts: {
          taskId: "task-handoff",
          jobId: "job-handoff",
          attempt: 1,
          chapter: {
            id: "chapter-handoff",
            title: "Handoff",
            url: "https://example.com/chapter",
            comicInfo: {},
          },
          seriesTitle: "Series",
          format: "none",
          includeComicInfo: false,
          downloadMode: "browser",
          comicInfoVersion: "2.0",
          onProgress: vi.fn(async () => undefined),
          onArchiveProgress: vi.fn(async () => undefined),
          abortSignal: new AbortController().signal,
          coverImage: {
            data: coverData,
            mimeType: "image/png",
            liveResourceLease: coverLease,
          },
          settingsSnapshot: {
            ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
            archiveFormat: "none",
            rateLimitSettings: {
              image: { concurrency: 1, delayMs: 0 },
              chapter: { concurrency: 1, delayMs: 0 },
            },
          },
        },
        urls: ["https://images.example/page.png"],
        integrationId: "test-site",
        downloadImage,
        normalizeSettings: {
          normalizeImageFilenames: true,
          imagePaddingDigits: "auto",
        },
      }
    )

    await vi.waitFor(() =>
      expect(requestBrowserBlobDownload).toHaveBeenCalledTimes(1)
    )
    expect(ledger.getUsedBytes()).toBe(2)
    handoffResolvers[0]?.({
      success: true,
      disposition: "tracked",
      phase: "waiting",
    })

    await vi.waitFor(() => expect(downloadImage).toHaveBeenCalledOnce())
    expect(ledger.getUsedBytes()).toBe(1)
    const pageData = new Uint8Array([2]).buffer
    const pageLease = ledger.reserve(pageData.byteLength, "retained page")
    resolvePage({
      data: pageData,
      filename: "page.png",
      mimeType: "image/png",
      liveResourceLease: pageLease,
    })

    await vi.waitFor(() =>
      expect(requestBrowserBlobDownload).toHaveBeenCalledTimes(2)
    )
    expect(ledger.getUsedBytes()).toBe(3)
    handoffResolvers[1]?.({
      success: true,
      disposition: "tracked",
      phase: "waiting",
    })
    await processing

    expect(ledger.getUsedBytes()).toBe(1)
    coverLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("rejects a final Blob allocation under the combined live-resource peak without eviction", async () => {
    const browserBytes = 3
    const archiveInputBytes = 4
    const encodedSourceBytes = 24
    const decodedSurfaceBytes = 8
    const sourceBlobBytes = encodedSourceBytes
    const finalImageBytes = 1
    const capacity =
      browserBytes +
      2 * MAX_ARCHIVE_BYTES +
      archiveInputBytes +
      2 * MAX_IMAGE_BYTES +
      encodedSourceBytes +
      decodedSurfaceBytes +
      sourceBlobBytes +
      finalImageBytes
    const ledger = new OffscreenLiveResourceLedger(capacity)

    const browserPrepared = ledger.reserve(
      browserBytes,
      "prepared browser Blob"
    )
    const createObjectURL = vi.fn().mockReturnValue("blob:retained")
    const revokeObjectURL = vi.fn()
    const registry = new BrowserBlobLeaseRegistry(
      { maxCount: 2, maxBytes: 10 },
      { createObjectURL, revokeObjectURL },
      ledger
    )
    const browserIdentity = registry.retain({
      ...incarnation,
      outputId: "retained-output",
      blob: new Blob([new Uint8Array(browserBytes)]),
      resourceLease: browserPrepared,
    })

    const archiveAllowance = ledger.reserve(
      2 * MAX_ARCHIVE_BYTES,
      "archive allowance"
    )
    const worker = new WorkerStub()
    const session = new ArchiveWorkerSession(
      worker as unknown as Worker,
      undefined,
      10,
      archiveAllowance
    )
    const archiveInputLease = ledger.reserve(archiveInputBytes, "archive input")
    const archiveInput = new ArrayBuffer(archiveInputBytes)
    session.post(
      {
        type: "addImage",
        inputId: "held-input",
        filename: "001.jpg",
        buffer: archiveInput,
      },
      [archiveInput],
      archiveInputLease
    )

    const fetchController = new AbortController()
    const read = vi.fn(
      () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)
    )
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          url: "https://images.example/held.png",
          headers: new Headers({ "content-type": "image/png" }),
          body: {
            getReader: () => ({
              read,
              cancel: vi.fn(async () => undefined),
              releaseLock: vi.fn(),
            }),
            cancel: vi.fn(async () => undefined),
          },
        }) as unknown as Response
    )
    const fetchPromise = fetchImageWithStallDetection(
      "https://images.example/held.png",
      {
        signal: fetchController.signal,
        fetcher,
        stallTimeoutMs: 60_000,
        hardTimeoutMs: 60_000,
        liveResourceLedger: ledger,
      }
    )
    const observedFetch = fetchPromise.catch(() => undefined)
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())

    let rejectBitmap!: (reason: unknown) => void
    const createImageBitmapMock = vi.fn(
      () =>
        new Promise<ImageBitmap>((_resolve, reject) => {
          rejectBitmap = reject
        })
    )
    vi.stubGlobal("createImageBitmap", createImageBitmapMock)
    vi.stubGlobal("OffscreenCanvas", class {})
    const encodedSourceLease = ledger.reserve(
      encodedSourceBytes,
      "encoded render source"
    )
    const encodedSource = new Uint8Array(encodedSourceBytes)
    encodedSource.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    encodedSource.set([0x49, 0x48, 0x44, 0x52], 12)
    encodedSource[19] = 1
    encodedSource[23] = 1
    const rendererPromise = descrambleGigaviewerImage(
      encodedSource.buffer,
      "image/png",
      undefined,
      ledger,
      encodedSourceLease
    )
    const observedRenderer = rendererPromise.catch(() => undefined)
    await vi.waitFor(() => expect(createImageBitmapMock).toHaveBeenCalledOnce())

    const finalImageLease = ledger.reserve(
      finalImageBytes,
      "retained final encoded image"
    )
    const finalImage = new ArrayBuffer(finalImageBytes)
    expect(ledger.getUsedBytes()).toBe(capacity)

    const blobConstructor = vi.fn()
    vi.stubGlobal("Blob", blobConstructor)
    await expect(
      processNoneFormatChapter(
        {
          liveResourceLedger: ledger,
          rateLimitService,
          withImageRetries: async (operation) => operation(),
          resolveWritableDownloadRoot: vi.fn(),
          requestBrowserBlobDownload: vi.fn(),
          getMemoryStats: () => null,
        },
        {
          opts: {
            taskId: "task-stress",
            jobId: "job-stress",
            attempt: 1,
            chapter: {
              id: "chapter-stress",
              title: "Stress",
              url: "https://example.com/stress",
              comicInfo: {},
            },
            seriesTitle: "Series",
            format: "none",
            includeComicInfo: false,
            downloadMode: "browser",
            comicInfoVersion: "2.0",
            onProgress: vi.fn(async () => undefined),
            onArchiveProgress: vi.fn(async () => undefined),
            abortSignal: new AbortController().signal,
            settingsSnapshot: {
              ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
              archiveFormat: "none",
              rateLimitSettings: {
                image: { concurrency: 1, delayMs: 0 },
                chapter: { concurrency: 1, delayMs: 0 },
              },
            },
          },
          urls: ["https://images.example/final.png"],
          integrationId: "test-site",
          downloadImage: vi.fn(async () => ({
            data: finalImage,
            filename: "final.png",
            mimeType: "image/png",
            liveResourceLease: finalImageLease,
          })),
          normalizeSettings: {
            normalizeImageFilenames: true,
            imagePaddingDigits: "auto",
          },
        }
      )
    ).rejects.toThrow("Offscreen live resource cap exceeded")

    expect(blobConstructor).not.toHaveBeenCalled()
    expect(registry.getRetainedCount()).toBe(1)
    expect(revokeObjectURL).not.toHaveBeenCalled()

    fetchController.abort(new Error("test cleanup"))
    rejectBitmap(new Error("test cleanup"))
    await observedFetch
    await observedRenderer
    session.dispose()
    expect(registry.revoke(browserIdentity)).toBe(true)
    vi.unstubAllGlobals()

    expect(ledger.getUsedBytes()).toBe(0)
  })
})
