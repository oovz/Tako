import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import type { OffscreenDownloadChapterPayload } from "@/src/runtime/message-schemas"

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

function request(
  overrides: Partial<OffscreenDownloadChapterPayload> = {}
): OffscreenDownloadChapterPayload {
  return {
    jobId: "job-1",
    attempt: 1,
    taskId: "task-1",
    seriesKey: "site:series-1",
    book: {
      siteIntegrationId: "site",
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
      archiveFormat: "cbz",
      conflictPolicy: "uniquify",
      includeComicInfo: true,
      includeCoverImage: true,
      rateLimitSettings: {
        image: { concurrency: 2, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 0 },
      },
      retrySettings: { image: 3, chapter: 3 },
    },
    saveMode: "downloads-api",
    ...overrides,
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
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns the same execution promise for an identical replay", async () => {
    const worker = new OffscreenWorker()
    let finish: ((outcome: { status: "completed" }) => void) | undefined
    const execution = new Promise<{ status: "completed" }>((resolve) => {
      finish = resolve
    })
    const executeDownloadChapter = vi.fn(() => execution)
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: executeDownloadChapter,
    })
    const payload = request()

    const first = worker.processDownloadChapter(payload)
    const replay = worker.processDownloadChapter(structuredClone(payload))

    expect(replay).toBe(first)
    await vi.waitFor(() =>
      expect(executeDownloadChapter).toHaveBeenCalledTimes(1)
    )
    expect(worker.getCurrentJobState()).toMatchObject({
      jobId: "job-1",
      attempt: 1,
      status: "active",
    })
    finish?.({ status: "completed" })
    await expect(first).resolves.toEqual({ status: "completed" })
  })

  it("rejects collisions that reuse a job id with different identity", async () => {
    const worker = new OffscreenWorker()
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: vi.fn(() => new Promise<{ status: "completed" }>(() => undefined)),
    })
    void worker.processDownloadChapter(request())

    await expect(
      worker.processDownloadChapter(request({ attempt: 2 }))
    ).rejects.toThrow("Job identity collision")
  })

  it("rejects an older attempt for a chapter with another job id", async () => {
    const worker = new OffscreenWorker()
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: vi.fn(() => new Promise<{ status: "completed" }>(() => undefined)),
    })
    void worker.processDownloadChapter(
      request({ jobId: "job-new", attempt: 2 })
    )

    await expect(
      worker.processDownloadChapter(request({ jobId: "job-stale", attempt: 1 }))
    ).rejects.toThrow("Stale chapter dispatch attempt")
  })

  it("rejects the same chapter attempt under a different job id", async () => {
    const worker = new OffscreenWorker()
    Object.defineProperty(worker, "executeDownloadChapter", {
      value: vi.fn(() => new Promise<{ status: "completed" }>(() => undefined)),
    })
    void worker.processDownloadChapter(request({ jobId: "job-original" }))

    await expect(
      worker.processDownloadChapter(request({ jobId: "job-collision" }))
    ).rejects.toThrow("Chapter dispatch identity collision")
  })

  it("does not execute a job whose acceptance fence is rejected", async () => {
    const worker = new OffscreenWorker()
    const processChapterStreaming = vi.fn(async () => ({
      status: "completed" as const,
    }))
    const sendJobProgressMessage = vi.fn(async () => undefined)
    Object.defineProperties(worker, {
      processChapterStreaming: { value: processChapterStreaming },
      sendMessageWithRetry: {
        value: vi.fn(async () => {
          throw new Error("Stale or unknown job identity")
        }),
      },
      sendJobProgressMessage: { value: sendJobProgressMessage },
    })

    await expect(
      worker.processDownloadChapter(request())
    ).resolves.toMatchObject({
      status: "failed",
      errorMessage: "Stale or unknown job identity",
    })
    expect(processChapterStreaming).not.toHaveBeenCalled()
    expect(sendJobProgressMessage).toHaveBeenCalledTimes(1)
  })

  it("waits for a fenced lower attempt to settle before executing its replacement", async () => {
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
    const old = worker.processDownloadChapter(
      request({ jobId: "job-old", attempt: 1 })
    )
    await vi.waitFor(() =>
      expect(executeDownloadChapter).toHaveBeenCalledTimes(1)
    )
    const replacement = worker.processDownloadChapter(
      request({ jobId: "job-new", attempt: 2 })
    )

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
    expect(jobs.get("job-old")).toMatchObject({ status: "canceled" })
    expect(jobs.get("job-old")?.controller.signal.aborted).toBe(true)
    expect(jobs.get("job-new")).toMatchObject({ status: "active" })
    expect(executeDownloadChapter).toHaveBeenCalledTimes(1)

    finishOld?.({ status: "completed" })
    await expect(old).resolves.toEqual({ status: "completed" })
    await vi.waitFor(() =>
      expect(executeDownloadChapter).toHaveBeenCalledTimes(2)
    )
    await expect(replacement).resolves.toEqual({ status: "completed" })
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
    const pending = worker.processDownloadChapter(request())
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"))

    expect(
      worker.cancelJob({
        jobId: "job-1",
        attempt: 2,
        taskId: "task-1",
        chapterId: "chapter-1",
      })
    ).toBe(false)
    expect(
      worker.cancelJob({
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "chapter-1",
      })
    ).toBe(true)
    expect(worker.getCurrentJobState()).toMatchObject({
      status: "canceled",
      jobId: "job-1",
    })
    finish?.({ status: "failed" })
    await pending
  })

  it("waits until the persisted not-before boundary before resolving", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const worker = new OffscreenWorker()
    const record = {
      request: request({ notBefore: 1_500 }),
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
      request: request({ notBefore: Date.now() + 60_000 }),
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
