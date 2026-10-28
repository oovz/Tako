import { afterEach, describe, expect, it, vi } from "vitest"
import { unzipSync, strFromU8 } from "fflate"
import {
  processArchiveFormatChapter,
  processNoneFormatChapter,
  type ChapterDownloadImageFn,
  type ChapterProcessingRuntime,
  type ProcessChapterStreamingOptions,
} from "@/entrypoints/offscreen/chapter-processing"
import {
  installZipWorkerRuntime,
  type ZipWorkerRuntimeScope,
} from "@/entrypoints/offscreen/zip.worker"
import { withRetries } from "@/entrypoints/offscreen/image-processor"
import { downloadManhuaguiChapterImage } from "@/src/site-integrations/manhuagui/chapter-api"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { SHONEN_JUMP_PLUS_SCRAMBLED_PNG } from "@/tests/e2e/fixtures/mock-data/site-integrations/shonenjumpplus/scrambled-image-fixture"
import { decodeRgbaPng } from "@/tests/e2e/fixtures/png-decoder"

vi.mock("@/entrypoints/offscreen/archive-worker-factory", () => ({
  default: () => new RuntimeZipWorker(),
}))

const workers: RuntimeZipWorker[] = []
let archiveByteLimit: number | undefined

// Replace only the worker transport; the archive protocol and fflate run intact.
class RuntimeZipWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  private readonly scope: ZipWorkerRuntimeScope = {
    onmessage: null,
    addEventListener: () => undefined,
    postMessage: (data) => this.onmessage?.({ data } as MessageEvent),
  }

  constructor() {
    workers.push(this)
    installZipWorkerRuntime(this.scope)
  }

  postMessage(data: Record<string, unknown>, transfer: Transferable[] = []) {
    const message = structuredClone(data, { transfer })
    if (message.type === "init" && archiveByteLimit !== undefined) {
      message.maxArchiveBytes = archiveByteLimit
    }
    this.scope.onmessage?.({ data: message } as MessageEvent)
  }

  fail(error: Error) {
    this.onerror?.({ error } as ErrorEvent)
  }

  terminate = vi.fn(() => {
    this.scope.onmessage = null
  })
}

const PAGE = new Uint8Array(SHONEN_JUMP_PLUS_SCRAMBLED_PNG)
const URLS = [1, 2, 3].map(
  (page) => `https://i.hamreus.com/chapter/${page}.png`
)
const services: RateLimitService[] = []

function fixture(
  format: "cbz" | "none",
  downloadMode: "browser" | "custom",
  retries = 0,
  concurrency = 1
) {
  const files = new Map<string, Uint8Array>()
  const handoffs: Array<{ filename: string; blob: Blob }> = []
  const ledger = new OffscreenLiveResourceLedger()
  const rateLimitService = new RateLimitService({
    resolveEffectivePolicy: async () => ({ concurrency, delayMs: 0 }),
  })
  services.push(rateLimitService)
  const directory = (prefix = ""): FileSystemDirectoryHandle =>
    ({
      getDirectoryHandle: async (name: string) =>
        directory(`${prefix}${name}/`),
      getFileHandle: async (name: string) => ({
        createWritable: async () => {
          const chunks: Uint8Array[] = []
          return {
            write: async (chunk: Uint8Array) => chunks.push(chunk.slice()),
            close: async () => {
              const blob = new Blob(chunks as BlobPart[])
              files.set(
                `${prefix}${name}`,
                new Uint8Array(await blob.arrayBuffer())
              )
            },
            abort: async () => undefined,
          }
        },
      }),
    }) as unknown as FileSystemDirectoryHandle
  const runtime: ChapterProcessingRuntime = {
    liveResourceLedger: ledger,
    rateLimitService,
    withImageRetries: (fn, hooks, signal) =>
      withRetries(fn, retries, 0, hooks, signal),
    resolveWritableDownloadRoot: async () => directory(),
    requestBrowserBlobDownload: async ({ filename, blob }) => {
      handoffs.push({ filename, blob })
      return { success: true, disposition: "tracked", phase: "waiting" }
    },
    getMemoryStats: () => null,
  }
  const opts: ProcessChapterStreamingOptions = {
    taskId: "task",
    jobId: "job",
    attempt: 1,
    chapter: {
      id: "chapter",
      title: "Chapter",
      url: "https://www.manhuagui.com/comic/1/2.html",
      resolvedPath: format === "none" ? "chapter" : "chapter.cbz",
      comicInfo: {},
    },
    seriesTitle: "Series",
    format,
    downloadMode,
    includeComicInfo: false,
    comicInfoVersion: "2.0",
    abortSignal: new AbortController().signal,
    onProgress: async () => undefined,
    onArchiveProgress: async () => undefined,
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "manhuagui"),
      conflictPolicy: "overwrite",
      rateLimitSettings: {
        image: { concurrency, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 0 },
      },
    },
  }
  const downloadImage: ChapterDownloadImageFn = (url, options) =>
    downloadManhuaguiChapterImage(url, { ...options, skipRateLimit: true })
  const process = (imageFn = downloadImage, urls = URLS) => {
    const input = {
      urls,
      integrationId: "manhuagui",
      downloadImage: imageFn,
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3 as const,
      },
    }
    return format === "none"
      ? processNoneFormatChapter(runtime, {
          ...input,
          opts: { ...opts, format: "none" },
        })
      : processArchiveFormatChapter(runtime, {
          ...input,
          opts: { ...opts, format: "cbz" },
        })
  }
  const outputBytes = async () =>
    downloadMode === "custom"
      ? [...files.values()]
      : Promise.all(
          handoffs.map(
            async ({ blob }) => new Uint8Array(await blob.arrayBuffer())
          )
        )
  return {
    opts,
    runtime,
    process,
    outputBytes,
    ledger,
    handoffs,
    files,
    downloadImage,
  }
}

function network(emptyResponses: number) {
  let middleRequests = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const empty = url === URLS[1] && ++middleRequests <= emptyResponses
      return new Response(empty ? new Uint8Array() : PAGE.slice(), {
        headers: { "content-type": "image/png" },
      })
    })
  )
  return () => middleRequests
}

afterEach(() => {
  services.splice(0).forEach((service) => service.cleanupRateLimiters())
  vi.unstubAllGlobals()
  workers.length = 0
  archiveByteLimit = undefined
})

describe("complete chapter output", () => {
  it.each(["browser", "custom"] as const)(
    "stops chapter production on worker failure before %s output and permits later work",
    async (mode) => {
      const f = fixture("cbz", mode, 1, 2)
      const urls = Array.from({ length: 6 }, (_, i) => `${URLS[0]}?page=${i}`)
      const signals: AbortSignal[] = []
      const releases: Array<() => void> = []
      const started = Promise.withResolvers<void>()
      const error = new Error("archive compression failed")
      const imageFn: ChapterDownloadImageFn = async (_url, options) => {
        const lease = f.ledger.reserve(PAGE.byteLength, "in-flight page")
        const signal = options!.signal!
        signals.push(signal)
        if (signals.length === 2) started.resolve()
        const page = Promise.withResolvers<void>()
        releases.push(page.resolve)
        const onAbort = () => page.resolve()
        signal.addEventListener("abort", onAbort, { once: true })
        try {
          await page.promise
        } finally {
          signal.removeEventListener("abort", onAbort)
        }
        // A transport can finish returning its buffer as cancellation arrives.
        return {
          data: PAGE.slice().buffer,
          filename: "page.png",
          mimeType: "image/png",
          liveResourceLease: lease,
        }
      }
      const result = f.process(imageFn, urls).catch((reason: unknown) => reason)
      await started.promise
      const worker = workers[0]
      try {
        worker.fail(error)
        expect(signals.every((signal) => signal.aborted)).toBe(true)
      } finally {
        releases.forEach((release) => release())
      }
      expect(await result).toBe(error)
      expect(signals).toHaveLength(2)
      expect(f.opts.abortSignal?.aborted).toBe(false)
      expect(await f.outputBytes()).toEqual([])
      expect(f.ledger.getUsedBytes()).toBe(0)
      expect(worker.terminate).toHaveBeenCalledOnce()

      network(0)
      expect(await f.process()).toMatchObject({ status: "completed" })
      expect(f.ledger.getUsedBytes()).toBe(0)
    }
  )

  it.each(["browser", "custom"] as const)(
    "preserves a streaming archive budget failure while canceling remaining %s pages",
    async (mode) => {
      archiveByteLimit = 1
      const f = fixture("cbz", mode, 1, 2)
      const urls = Array.from({ length: 6 }, (_, i) => `${URLS[0]}?page=${i}`)
      const started: string[] = []
      const signals: AbortSignal[] = []
      const twoStarted = Promise.withResolvers<void>()
      const remainingPage = Promise.withResolvers<void>()
      const imageFn: ChapterDownloadImageFn = async (url, options) => {
        started.push(url)
        const signal = options!.signal!
        signals.push(signal)
        const lease = f.ledger.reserve(PAGE.byteLength, "page buffer")
        if (url === urls[0]) {
          await twoStarted.promise
        } else if (url === urls[1]) {
          twoStarted.resolve()
          const onAbort = () => remainingPage.resolve()
          signal.addEventListener("abort", onAbort, { once: true })
          try {
            await remainingPage.promise
          } finally {
            signal.removeEventListener("abort", onAbort)
          }
        }
        return {
          data: PAGE.slice().buffer,
          filename: "page.png",
          mimeType: "image/png",
          liveResourceLease: lease,
        }
      }
      const result = f.process(imageFn, urls).catch((reason: unknown) => reason)
      try {
        await vi.waitFor(() => {
          expect(signals).toHaveLength(2)
          expect(signals.every((signal) => signal.aborted)).toBe(true)
        })
      } finally {
        remainingPage.resolve()
      }
      const failure = await result
      expect(failure).toBeInstanceOf(Error)
      expect(failure).toMatchObject({
        message: expect.stringContaining("Archive size exceeds 1 byte limit"),
      })
      expect(started).toEqual(urls.slice(0, 2))
      expect(f.opts.abortSignal?.aborted).toBe(false)
      expect(await f.outputBytes()).toEqual([])
      expect(f.ledger.getUsedBytes()).toBe(0)
      expect(workers[0].terminate).toHaveBeenCalledOnce()
    }
  )

  it("interrupts retry backoff when its archive worker fails", async () => {
    vi.useFakeTimers()
    const f = fixture("cbz", "browser", 10, 2)
    const error = new Error("archive worker stopped during image retry")
    const started: string[] = []
    const activePage = Promise.withResolvers<void>()
    f.runtime.withImageRetries = (fn, hooks, signal) =>
      withRetries(fn, 10, 60_000, hooks, signal)
    const imageFn: ChapterDownloadImageFn = async (url, options) => {
      started.push(url)
      if (url === URLS[0]) throw new Error("temporary image failure")
      const lease = f.ledger.reserve(PAGE.byteLength, "active page")
      const signal = options!.signal!
      const onAbort = () => activePage.resolve()
      signal.addEventListener("abort", onAbort, { once: true })
      try {
        await activePage.promise
      } finally {
        signal.removeEventListener("abort", onAbort)
      }
      return {
        data: PAGE.slice().buffer,
        filename: "page.png",
        mimeType: "image/png",
        liveResourceLease: lease,
      }
    }
    const result = f.process(imageFn).catch((reason: unknown) => reason)
    const settled = vi.fn()
    void result.then(settled)
    try {
      await vi.waitFor(() => expect(started).toEqual(URLS.slice(0, 2)))
      workers[0].fail(error)
      await vi.waitFor(() => expect(settled).toHaveBeenCalledWith(error))
      expect(started).toEqual(URLS.slice(0, 2))
      expect(f.opts.abortSignal?.aborted).toBe(false)
      expect(f.ledger.getUsedBytes()).toBe(0)
      expect(await f.outputBytes()).toEqual([])
    } finally {
      activePage.resolve()
      await vi.advanceTimersByTimeAsync(60_000)
      await result
      vi.useRealTimers()
    }
  })

  it.each(["cbz", "none"] as const)(
    "rejects an empty included cover before %s page production",
    async (format) => {
      network(0)
      const f = fixture(format, "browser")
      f.opts.coverImage = {
        data: new ArrayBuffer(0),
        mimeType: "image/png",
        liveResourceLease: f.ledger.reserve(0, "empty cover"),
      }
      await expect(f.process()).rejects.toThrow("Image payload is empty")
      expect(fetch).not.toHaveBeenCalled()
      expect(await f.outputBytes()).toEqual([])
      f.opts.coverImage.liveResourceLease.release()
      expect(f.ledger.getUsedBytes()).toBe(0)
    }
  )

  it.each(["browser", "custom"] as const)(
    "rejects an empty required page before %s archive output",
    async (mode) => {
      const requests = network(Infinity)
      const f = fixture("cbz", mode, 1)
      expect(await f.process()).toMatchObject({
        status: "failed",
        imagesFailed: 1,
        outputsCommitted: 0,
      })
      expect(await f.outputBytes()).toEqual([])
      expect(requests()).toBe(2)
      expect(f.ledger.getUsedBytes()).toBe(0)
    }
  )

  it.each(["browser", "custom"] as const)(
    "retains valid loose files when an empty page fails in %s mode",
    async (mode) => {
      network(Infinity)
      const f = fixture("none", mode)
      expect(await f.process()).toMatchObject({
        status: "partial_success",
        imagesFailed: 1,
        outputsRequested: 3,
        outputsCommitted: mode === "custom" ? 2 : 0,
        outputsFailedBeforeHandoff: mode === "browser" ? 1 : 0,
      })
      expect(await f.outputBytes()).toEqual([PAGE, PAGE])
      expect(f.ledger.getUsedBytes()).toBe(0)
    }
  )

  it.each([
    { withCover: false, mode: "browser" },
    { withCover: true, mode: "browser" },
    { withCover: false, mode: "custom" },
    { withCover: true, mode: "custom" },
  ] as const)(
    "creates a readable complete $mode archive with cover=$withCover and metadata",
    async ({ withCover, mode }) => {
      network(0)
      const f = fixture("cbz", mode)
      f.opts.includeComicInfo = true
      if (withCover) {
        f.opts.coverImage = {
          data: PAGE.slice().buffer,
          mimeType: "image/png",
          liveResourceLease: f.ledger.reserve(PAGE.byteLength, "cover"),
        }
      }
      expect(await f.process()).toMatchObject({ status: "completed" })
      const [bytes] = await f.outputBytes()
      const entries = unzipSync(bytes)
      const images = Object.entries(entries).filter(([name]) =>
        name.endsWith(".png")
      )
      expect(images).toHaveLength(withCover ? 4 : 3)
      expect(images.map(([, data]) => data)).toEqual(
        withCover ? [PAGE, PAGE, PAGE, PAGE] : [PAGE, PAGE, PAGE]
      )
      for (const [, data] of images) {
        const decoded = decodeRgbaPng(data)
        expect(decoded).toMatchObject({ width: 32, height: 32 })
        expect(Array.from(decoded.pixels.slice(0, 4))).toEqual([
          220, 38, 38, 255,
        ])
      }
      expect(strFromU8(entries["ComicInfo.xml"])).toContain(
        `<PageCount>${withCover ? 4 : 3}</PageCount>`
      )
      expect(f.ledger.getUsedBytes()).toBe(0)
    }
  )

  it("recovers an empty response under the configured image retry policy", async () => {
    const requests = network(1)
    const f = fixture("cbz", "browser", 1)
    expect(await f.process()).toMatchObject({ status: "completed" })
    const [bytes] = await f.outputBytes()
    expect(Object.values(unzipSync(bytes))).toEqual([PAGE, PAGE, PAGE])
    expect(requests()).toBe(2)
    expect(f.ledger.getUsedBytes()).toBe(0)
  })

  it("retries an empty transformed payload and releases each failed input lease", async () => {
    network(0)
    const f = fixture("none", "browser", 1)
    let attempts = 0
    const imageFn: ChapterDownloadImageFn = async (url, options) => {
      const image = await f.downloadImage(url, options)
      if (url === URLS[1] && ++attempts === 1) {
        image.data = new ArrayBuffer(0)
      }
      return image
    }
    expect(await f.process(imageFn)).toMatchObject({ status: "completed" })
    expect(await f.outputBytes()).toEqual([PAGE, PAGE, PAGE])
    expect(attempts).toBe(2)
    expect(f.ledger.getUsedBytes()).toBe(0)
  })
})
