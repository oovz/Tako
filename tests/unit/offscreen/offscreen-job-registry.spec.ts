import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import { createOffscreenDispatchFingerprint } from "@/src/runtime/offscreen-job-fingerprint"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { setEnablementMap as setUserSiteIntegrationEnablement } from "@/src/site-integrations/catalog"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import {
  OffscreenLiveResourceLedger,
  type OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"

type OffscreenDownloadChapterPayload =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">["payload"]

const RATE_LIMIT_SETTINGS = {
  image: { concurrency: 1, delayMs: 0 },
  chapter: { concurrency: 1, delayMs: 0 },
}

const enablementMocks = vi.hoisted(() => ({
  load: vi.fn(async () => ({}) as Record<string, boolean>),
}))

vi.mock("@/src/runtime/site-integration-offscreen-initialization", () => ({
  initializeOffscreenSiteIntegrations: vi.fn(async () => undefined),
  loadOffscreenSiteIntegrationEnablement: enablementMocks.load,
}))

vi.mock("@/entrypoints/offscreen/runtime-bridge", () => ({
  registerOffscreenRuntime: vi.fn(),
}))

vi.mock("@/entrypoints/offscreen/status-ui", () => ({
  createOffscreenStatusController: vi.fn(() => ({
    initializeDom: vi.fn(),
    onInitialized: vi.fn(),
    onInitializationError: vi.fn(),
    reportBootstrapError: vi.fn(),
  })),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

let OffscreenWorker: typeof import("@/entrypoints/offscreen/main").OffscreenWorker

async function request(
  overrides: Partial<Omit<OffscreenDownloadChapterPayload, "fingerprint">> = {}
): Promise<OffscreenDownloadChapterPayload> {
  const payload: Omit<OffscreenDownloadChapterPayload, "fingerprint"> = {
    jobId: "job-1",
    attempt: 1,
    taskId: "task-1",
    seriesKey: "shonenjumpplus:series-1",
    book: {
      siteIntegrationId: "shonenjumpplus",
      seriesTitle: "Series",
    },
    chapter: {
      id: "chapter-1",
      title: "Chapter 1",
      url: "https://example.test/chapter-1",
      index: 1,
      resolvedPath: "Series/Chapter 1.cbz",
    },
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "shonenjumpplus"),
      archiveFormat: "cbz",
    },
    saveMode: "downloads-api",
    ...overrides,
  }
  return {
    ...payload,
    fingerprint: await createOffscreenDispatchFingerprint(payload),
  }
}

function jobIdentity(
  worker: InstanceType<typeof OffscreenWorker>,
  payload: OffscreenDownloadChapterPayload
) {
  return {
    jobId: payload.jobId,
    attempt: payload.attempt,
    taskId: payload.taskId,
    chapterId: payload.chapter.id,
    fingerprint: payload.fingerprint,
    documentInstanceId: worker.documentInstanceId,
  }
}

describe("offscreen job registry", () => {
  beforeAll(async () => {
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
    })
    ;({ OffscreenWorker } = await import("@/entrypoints/offscreen/main"))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    enablementMocks.load.mockResolvedValue({})
    setUserSiteIntegrationEnablement({})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("rejects an unknown provider dispatch-context version before admission", async () => {
    const worker = new OffscreenWorker()
    const payload = await request({
      book: {
        siteIntegrationId: "mangadex",
        seriesTitle: "Series",
      },
      integrationContext: {
        schemaVersion: 2,
        data: { useDataSaver: true },
      },
    })

    await expect(worker.processDownloadChapter(payload)).rejects.toThrow(
      "Unsupported dispatch context schema version 2"
    )
    expect(worker.getActiveJobCount()).toBe(0)
  })

  it("returns the same immediate ACK for an identical replay without re-executing", async () => {
    const worker = new OffscreenWorker()
    let finish: ((outcome: { status: "completed" }) => void) | undefined
    const execution = new Promise<{ status: "completed" }>((resolve) => {
      finish = resolve
    })
    const executeDownloadChapter = vi.fn(() => execution)
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: executeDownloadChapter,
    })
    const payload = await request()

    const first = await worker.processDownloadChapter(payload)
    const replay = await worker.processDownloadChapter(structuredClone(payload))

    expect(replay).toEqual(first)
    expect(first).toEqual({
      accepted: true,
      ...jobIdentity(worker, payload),
    })
    await vi.waitFor(() =>
      expect(executeDownloadChapter).toHaveBeenCalledTimes(1)
    )
    expect(worker.getJobState(jobIdentity(worker, payload))).toMatchObject({
      jobId: "job-1",
      attempt: 1,
      status: "active",
    })
    finish?.({ status: "completed" })
    await expect(execution).resolves.toEqual({ status: "completed" })
  })

  it("rejects collisions that reuse a job id with different identity", async () => {
    const worker = new OffscreenWorker()
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: vi.fn(() => new Promise<{ status: "completed" }>(() => undefined)),
    })
    await worker.processDownloadChapter(await request())

    await expect(
      worker.processDownloadChapter(await request({ attempt: 2 }))
    ).rejects.toThrow("Job identity collision")
  })

  it("rejects an older attempt for a chapter with another job id", async () => {
    const worker = new OffscreenWorker()
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: vi.fn(() => new Promise<{ status: "completed" }>(() => undefined)),
    })
    await worker.processDownloadChapter(
      await request({ jobId: "job-new", attempt: 2 })
    )

    await expect(
      worker.processDownloadChapter(
        await request({ jobId: "job-stale", attempt: 1 })
      )
    ).rejects.toThrow("Stale chapter dispatch attempt")
  })

  it("rejects the same chapter attempt under a different job id", async () => {
    const worker = new OffscreenWorker()
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: vi.fn(() => new Promise<{ status: "completed" }>(() => undefined)),
    })
    await worker.processDownloadChapter(
      await request({ jobId: "job-original" })
    )

    await expect(
      worker.processDownloadChapter(await request({ jobId: "job-collision" }))
    ).rejects.toThrow("Chapter dispatch identity collision")
  })

  it("does not execute a job whose acceptance fence is rejected", async () => {
    const worker = new OffscreenWorker()
    const processChapterStreaming = vi.fn(async () => ({
      status: "completed" as const,
    }))
    const sendJobTerminal = vi.fn(async () => undefined)
    Object.defineProperties(worker, {
      processChapterStreaming: { value: processChapterStreaming },
      sendJobAccepted: {
        value: vi.fn(async () => {
          throw new Error("Stale or unknown job identity")
        }),
      },
      sendJobTerminal: { value: sendJobTerminal },
    })

    const payload = await request()
    await expect(worker.processDownloadChapter(payload)).resolves.toEqual({
      accepted: true,
      ...jobIdentity(worker, payload),
    })
    await vi.waitFor(() =>
      expect(worker.getJobState(jobIdentity(worker, payload))).toMatchObject({
        status: "terminal",
        outcome: {
          status: "failed",
          errorMessage: "Stale or unknown job identity",
        },
      })
    )
    expect(processChapterStreaming).not.toHaveBeenCalled()
    expect(sendJobTerminal).toHaveBeenCalledOnce()
  })

  it("refuses a default-disabled provider before starting data work", async () => {
    const worker = new OffscreenWorker()
    const processChapterStreaming = vi.fn(async () => ({
      status: "completed" as const,
    }))
    Object.defineProperties(worker, {
      processChapterStreaming: { value: processChapterStreaming },
      sendJobAccepted: {
        value: vi.fn(async () => undefined),
      },
      sendJobTerminal: { value: vi.fn(async () => undefined) },
    })

    const payload = await request({
      book: {
        siteIntegrationId: "mangadex",
        seriesTitle: "Series",
      },
    })
    const acknowledgment = await worker.processDownloadChapter(payload)

    expect(acknowledgment).toEqual({
      accepted: true,
      ...jobIdentity(worker, payload),
    })
    await vi.waitFor(() =>
      expect(worker.getJobState(jobIdentity(worker, payload))).toMatchObject({
        status: "terminal",
        outcome: {
          status: "failed",
          errorMessage: "Site integration mangadex is disabled",
        },
      })
    )
    expect(processChapterStreaming).not.toHaveBeenCalled()
  })

  it("refuses series parsing for a disabled provider", async () => {
    const worker = new OffscreenWorker()

    await expect(
      worker.parseSeriesHtml({
        requestId: "00000000-0000-4000-8000-000000000001",
        siteIntegrationId: "mangadex",
        seriesUrl: "https://mangadex.org/title/series-1",
        html: "<main></main>",
        rateLimitSettings: RATE_LIMIT_SETTINGS,
      })
    ).resolves.toEqual({
      success: false,
      error: "Site integration mangadex is disabled",
    })
  })

  it("counts series work while fresh enablement is still loading", async () => {
    const worker = new OffscreenWorker()
    let releaseEnablement:
      ((enablement: Record<string, boolean>) => void) | undefined
    enablementMocks.load.mockReturnValueOnce(
      new Promise<Record<string, boolean>>((resolve) => {
        releaseEnablement = resolve
      })
    )

    const parsing = worker.parseSeriesHtml({
      requestId: "00000000-0000-4000-8000-000000000002",
      siteIntegrationId: "mangadex",
      seriesUrl: "https://mangadex.org/title/series-1",
      html: "<main></main>",
      rateLimitSettings: RATE_LIMIT_SETTINGS,
    })
    await vi.waitFor(() => expect(enablementMocks.load).toHaveBeenCalledOnce())

    expect(worker.getActiveSeriesResolutionCount()).toBe(1)
    releaseEnablement?.({ mangadex: false })
    await expect(parsing).resolves.toEqual({
      success: false,
      error: "Site integration mangadex is disabled",
    })
    expect(worker.getActiveSeriesResolutionCount()).toBe(0)
  })

  it("keeps a canceled series resolution active until its parser settles", () => {
    const worker = new OffscreenWorker()
    const controller = new AbortController()
    const seriesResolutionControllers = (
      worker as unknown as {
        seriesResolutionControllers: Map<string, AbortController>
      }
    ).seriesResolutionControllers
    seriesResolutionControllers.set("request-1", controller)

    expect(worker.getActiveSeriesResolutionCount()).toBe(1)
    expect(worker.cancelSeriesHtml("request-1")).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(worker.getActiveSeriesResolutionCount()).toBe(1)

    seriesResolutionControllers.delete("request-1")
    expect(worker.getActiveSeriesResolutionCount()).toBe(0)
  })

  it("rejects a replacement while the lower attempt is still active", async () => {
    const worker = new OffscreenWorker()
    let finishOld: ((outcome: { status: "completed" }) => void) | undefined
    const oldExecution = new Promise<{ status: "completed" }>((resolve) => {
      finishOld = resolve
    })
    const executeDownloadChapter = vi
      .fn()
      .mockImplementationOnce(() => oldExecution)
      .mockResolvedValueOnce({ status: "completed" })
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: executeDownloadChapter,
    })
    const oldPayload = await request({ jobId: "job-old", attempt: 1 })
    const old = await worker.processDownloadChapter(oldPayload)
    await vi.waitFor(() =>
      expect(executeDownloadChapter).toHaveBeenCalledTimes(1)
    )
    const replacementPayload = await request({ jobId: "job-new", attempt: 2 })
    await expect(
      worker.processDownloadChapter(replacementPayload)
    ).rejects.toThrow("Previous chapter dispatch is still active")

    const jobs = (
      worker as unknown as {
        jobs: Map<
          string,
          {
            status: string
            controller: AbortController
            request: OffscreenDownloadChapterPayload
          }
        >
      }
    ).jobs
    expect(jobs.get("job-old")).toMatchObject({ status: "active" })
    expect(jobs.get("job-old")?.controller.signal.aborted).toBe(false)
    expect(jobs.has("job-new")).toBe(false)
    expect(worker.getJobState(jobIdentity(worker, oldPayload))).toMatchObject({
      jobId: "job-old",
      status: "active",
    })
    expect(executeDownloadChapter).toHaveBeenCalledTimes(1)

    finishOld?.({ status: "completed" })
    await expect(oldExecution).resolves.toEqual({ status: "completed" })
    expect(old).toEqual({
      accepted: true,
      ...jobIdentity(worker, oldPayload),
    })
  })

  it("cancels only an exact active job identity", async () => {
    const worker = new OffscreenWorker()
    let finish: ((outcome: { status: "failed" }) => void) | undefined
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: vi.fn(
        () =>
          new Promise<{ status: "failed" }>((resolve) => {
            finish = resolve
          })
      ),
    })
    const payload = await request()
    const pending = worker.processDownloadChapter(payload)
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"))

    expect(() =>
      worker.cancelJob({
        ...jobIdentity(worker, payload),
        attempt: 2,
      })
    ).toThrow("Job cancellation identity collision")
    expect(worker.cancelJob(jobIdentity(worker, payload))).toMatchObject({
      canceled: true,
      status: "canceled",
      jobId: "job-1",
    })
    expect(worker.getJobState(jobIdentity(worker, payload))).toMatchObject({
      status: "canceled",
      jobId: "job-1",
    })
    finish?.({ status: "failed" })
    await pending
  })

  it("revokes only the exact Blob URL identity owned by a pending output", () => {
    const ledger = new OffscreenLiveResourceLedger()
    const worker = new OffscreenWorker(undefined, ledger)
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:job-1-output")
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined)
    const browserBlobs = (
      worker as unknown as {
        browserBlobs: {
          retain: (input: {
            jobId: string
            attempt: number
            taskId: string
            chapterId: string
            fingerprint: string
            documentInstanceId: string
            outputId: string
            blob: Blob
            resourceLease: OffscreenLiveResourceLease
          }) => {
            jobId: string
            attempt: number
            taskId: string
            chapterId: string
            fingerprint: string
            documentInstanceId: string
            outputId: string
            blobUrl: string
          }
          getRetainedCount: () => number
        }
      }
    ).browserBlobs
    const blobLease = ledger.reserve(7, "test browser Blob")
    const identity = browserBlobs.retain({
      jobId: "job-1",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
      fingerprint: "a".repeat(64),
      documentInstanceId: worker.documentInstanceId,
      outputId: "job-1:archive:0",
      blob: new Blob(["archive"]),
      resourceLease: blobLease,
    })

    expect(browserBlobs.getRetainedCount()).toBe(1)
    expect(revokeObjectURL).not.toHaveBeenCalled()

    expect(
      worker.revokeBlobUrl({ ...identity, chapterId: "other-chapter" })
    ).toBe(false)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(browserBlobs.getRetainedCount()).toBe(1)

    expect(worker.revokeBlobUrl(identity)).toBe(true)
    expect(revokeObjectURL).toHaveBeenCalledWith(identity.blobUrl)
    expect(browserBlobs.getRetainedCount()).toBe(0)

    expect(worker.revokeBlobUrl(identity)).toBe(true)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)

    const replacementWorker = new OffscreenWorker()
    expect(replacementWorker.revokeBlobUrl(identity)).toBe(true)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it("retains Blob ownership and propagates a generic background failure", async () => {
    const ledger = new OffscreenLiveResourceLedger()
    const worker = new OffscreenWorker(undefined, ledger)
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: vi.fn(() => new Promise(() => undefined)),
    })
    const payload = await request()
    await worker.processDownloadChapter(payload)
    const originalChrome = globalThis.chrome
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:job-1-output")
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined)
    const sendMessage = vi.fn(async () => ({
      success: false as const,
      error: "Background dispatcher failed after durable prepare",
    }))
    vi.stubGlobal("chrome", {
      ...originalChrome,
      runtime: { ...originalChrome.runtime, sendMessage },
    })

    try {
      const blobLease = ledger.reserve(7, "test browser Blob")
      const blob = new Blob(["archive"])
      const handoff = (
        worker as unknown as {
          requestBrowserBlobDownload: (input: {
            jobId: string
            attempt: number
            taskId: string
            chapterId: string
            outputId: string
            blob: Blob
            resourceLease: OffscreenLiveResourceLease
            filename: string
            outputIndex: number
            outputCount: number
            outputKind: "archive"
            signal: AbortSignal
          }) => Promise<unknown>
        }
      ).requestBrowserBlobDownload({
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "chapter-1",
        outputId: "job-1:archive:0",
        blob,
        resourceLease: blobLease,
        filename: "Series/Chapter 1.cbz",
        outputIndex: 0,
        outputCount: 1,
        outputKind: "archive",
        signal: new AbortController().signal,
      })

      await expect(handoff).rejects.toThrow(
        "Background dispatcher failed after durable prepare"
      )
      expect(createObjectURL).toHaveBeenCalledOnce()
      expect(revokeObjectURL).not.toHaveBeenCalled()
      expect(
        (
          worker as unknown as {
            browserBlobs: { getRetainedCount: () => number }
          }
        ).browserBlobs.getRetainedCount()
      ).toBe(1)
    } finally {
      vi.stubGlobal("chrome", originalChrome)
    }
  })

  it("revokes a rejected handoff only when the background explicitly reports not persisted", async () => {
    const ledger = new OffscreenLiveResourceLedger()
    const worker = new OffscreenWorker(undefined, ledger)
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: vi.fn(() => new Promise(() => undefined)),
    })
    const payload = await request()
    await worker.processDownloadChapter(payload)
    const originalChrome = globalThis.chrome
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:not-persisted")
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined)
    const sendMessage = vi.fn(async () => ({
      success: true as const,
      disposition: "not_persisted" as const,
      reason: "stale-job",
    }))
    vi.stubGlobal("chrome", {
      ...originalChrome,
      runtime: { ...originalChrome.runtime, sendMessage },
    })

    try {
      const blobLease = ledger.reserve(7, "test browser Blob")
      const blob = new Blob(["archive"])
      const response = await (
        worker as unknown as {
          requestBrowserBlobDownload: (input: {
            jobId: string
            attempt: number
            taskId: string
            chapterId: string
            outputId: string
            blob: Blob
            resourceLease: OffscreenLiveResourceLease
            filename: string
            outputIndex: number
            outputCount: number
            outputKind: "archive"
            signal: AbortSignal
          }) => Promise<unknown>
        }
      ).requestBrowserBlobDownload({
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "chapter-1",
        outputId: "job-1:archive:0",
        blob,
        resourceLease: blobLease,
        filename: "Series/Chapter 1.cbz",
        outputIndex: 0,
        outputCount: 1,
        outputKind: "archive",
        signal: new AbortController().signal,
      })

      expect(response).toEqual({
        success: true,
        disposition: "not_persisted",
        reason: "stale-job",
      })
      expect(revokeObjectURL).toHaveBeenCalledOnce()
      expect(
        (
          worker as unknown as {
            browserBlobs: { getRetainedCount: () => number }
          }
        ).browserBlobs.getRetainedCount()
      ).toBe(0)
    } finally {
      vi.stubGlobal("chrome", originalChrome)
    }
  })

  it("replays the exact ACK after cancellation without executing twice", async () => {
    const worker = new OffscreenWorker()
    const executeDownloadChapter = vi.fn(() => new Promise(() => undefined))
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: executeDownloadChapter,
    })
    const payload = await request()
    const acknowledgment = await worker.processDownloadChapter(payload)
    await vi.waitFor(() =>
      expect(executeDownloadChapter).toHaveBeenCalledOnce()
    )
    expect(worker.getJobState(jobIdentity(worker, payload))?.status).toBe(
      "active"
    )

    expect(worker.cancelJob(jobIdentity(worker, payload))).toMatchObject({
      canceled: true,
      status: "canceled",
    })
    await expect(
      worker.processDownloadChapter(structuredClone(payload))
    ).resolves.toEqual(acknowledgment)
    expect(executeDownloadChapter).toHaveBeenCalledOnce()
  })

  it("waits until the persisted not-before boundary before resolving", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const worker = new OffscreenWorker()
    const record = {
      request: await request({ notBefore: 1_500 }),
      controller: new AbortController(),
      stage: "dispatching",
      updatedAt: 1_000,
    }
    const waitForNotBefore = (
      worker as unknown as {
        waitForNotBefore: (job: typeof record) => Promise<void>
      }
    ).waitForNotBefore(record)

    await vi.advanceTimersByTimeAsync(499)
    expect(record.stage).toBe("dispatching")
    await vi.advanceTimersByTimeAsync(1)
    await waitForNotBefore
    expect(record.stage).toBe("resolving")
    expect(record.updatedAt).toBe(1_500)
  })

  it("rejects an already-aborted not-before wait immediately", async () => {
    const worker = new OffscreenWorker()
    const controller = new AbortController()
    controller.abort("already canceled")
    const record = {
      request: await request({ notBefore: Date.now() + 60_000 }),
      controller,
      stage: "dispatching",
      updatedAt: Date.now(),
    }

    await expect(
      (
        worker as unknown as {
          waitForNotBefore: (job: typeof record) => Promise<void>
        }
      ).waitForNotBefore(record)
    ).rejects.toThrow("job-cancelled")
  })
})
