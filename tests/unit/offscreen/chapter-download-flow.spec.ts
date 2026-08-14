import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { DEFAULT_FETCH_TIMEOUT_MS } from "@/src/constants/timeouts"
import { createOffscreenDispatchFingerprint } from "@/src/runtime/offscreen-job-fingerprint"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
const { offscreenSiteAdaptersById, getDefinitionMock } = vi.hoisted(() => ({
  offscreenSiteAdaptersById: {} as Record<string, unknown>,
  getDefinitionMock: vi.fn(),
}))
import type { OffscreenIntegration } from "@/src/types/site-integrations"
import {
  loadDownloadRootHandle,
  verifyPermission,
  writeBlobToPath,
} from "@/src/storage/fs-access"

type OffscreenDownloadChapterPayload =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">["payload"]
type UnsignedOffscreenDownloadChapterPayload = Omit<
  OffscreenDownloadChapterPayload,
  "fingerprint"
>

async function signDispatch(
  payload: UnsignedOffscreenDownloadChapterPayload
): Promise<OffscreenDownloadChapterPayload> {
  return {
    ...payload,
    fingerprint: await createOffscreenDispatchFingerprint(payload),
  }
}

// Mock dependencies
vi.mock("@/src/runtime/generated/site-integration-offscreen-registry", () => ({
  offscreenSiteAdaptersById,
}))

vi.mock("@/src/site-integrations/catalog", () => ({
  getDefinition: getDefinitionMock,
  setEnablementMap: vi.fn(),
  isEnabled: (id: string, enablement: Record<string, boolean>) =>
    enablement[id] === true,
}))

vi.mock("@/src/runtime/rate-limit", () => ({
  RateLimitService: class {
    constructor(private readonly policySource: any) {}

    resolveEffectivePolicy(integrationId: string, scope: string) {
      return this.policySource.resolveEffectivePolicy(integrationId, scope)
    }

    scheduleForIntegrationScope(
      _integrationId: string,
      _scope: string,
      task: () => Promise<unknown>
    ) {
      return task()
    }

    cleanupRateLimiters() {}
  },
}))

vi.mock("@/src/shared/filename-sanitizer", () => ({
  sanitizeFilename: (s: string) => s,
  normalizeImageFilename: () => "normalized.jpg",
  getExtensionFromMimeType: (mimeType: string) =>
    mimeType === "image/png" ? "png" : "jpg",
}))

vi.mock("@/entrypoints/offscreen/image-processor", () => ({
  PromiseQueue: class {
    add(fn: any) {
      return fn()
    }
    getQueueLength() {
      return 0
    }
    clear() {}
  },
  withRetries: async (fn: () => Promise<unknown>, _retries: number) => {
    return fn()
  },
  withTimeout: async (value: unknown) => await value,
  getHttpStatusFromError: () => 500,
}))

vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: vi.fn(),
  verifyPermission: vi.fn(),
  writeBlobToPath: vi.fn(),
}))

// Mock global chrome
const messages: any[] = []
global.chrome = {
  runtime: {
    sendMessage: vi.fn(async (msg) => {
      messages.push(msg)
      if (msg.type === "GET_SITE_INTEGRATION_ENABLEMENT") {
        return {
          success: true,
          enablement: {
            "test-site": true,
            "integration-a": true,
            "integration-b": true,
          },
        }
      }
      if (msg.type === "OFFSCREEN_OUTPUT_READY") {
        return {
          success: true,
          disposition: "tracked",
          phase: "prepared",
        }
      }
      if (
        msg.type === "OFFSCREEN_JOB_ACCEPTED" ||
        msg.type === "OFFSCREEN_DOWNLOAD_PROGRESS" ||
        msg.type === "OFFSCREEN_JOB_HEARTBEAT" ||
        msg.type === "OFFSCREEN_JOB_TERMINAL"
      ) {
        return { success: true, disposition: "renewed" }
      }
      return { success: true }
    }),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
} as any

// Mock DOM environment for OffscreenWorker init
const mockElement = {
  textContent: "",
  dataset: {},
  hidden: false,
  innerHTML: "",
}
global.document = {
  getElementById: vi.fn().mockReturnValue(mockElement),
  addEventListener: vi.fn(),
} as any
global.window = global as any
global.HTMLElement = class {} as any
global.HTMLDivElement = class {} as any

describe("OffscreenWorker Integration: NONE format failures", () => {
  let OffscreenWorkerClass: any
  let worker: any
  let mockDownloadImage: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    messages.length = 0
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    vi.mocked(loadDownloadRootHandle).mockResolvedValue(undefined)
    vi.mocked(verifyPermission).mockResolvedValue(false)
    vi.mocked(writeBlobToPath).mockResolvedValue({ status: "written" })

    // Dynamic import to ensure globals are set before module side-effects run
    const mod = await import("@/entrypoints/offscreen/main")
    OffscreenWorkerClass = mod.OffscreenWorker

    worker = new OffscreenWorkerClass()

    // Mock site integration
    mockDownloadImage = vi.fn().mockImplementation(async (url, _opts) => {
      if (url.endsWith("img2.jpg")) {
        throw new Error("Download failed")
      }
      return {
        filename: "img1.jpg",
        data: new ArrayBuffer(10),
        mimeType: "image/jpeg",
      }
    })

    const mockOffscreenIntegration = {
      id: "test-site",
      scope: "test",
      dispatchContext: {
        parse: (value: unknown) => value as Record<string, unknown>,
      },
      chapter: {
        resolveChapterPlan: async () => ({
          imageUrls: [
            "https://example.test/img1.jpg",
            "https://example.test/img2.jpg",
          ],
        }),
        downloadImage: mockDownloadImage,
      },
    } as unknown as OffscreenIntegration

    offscreenSiteAdaptersById["test-site"] = {
      id: "test-site",
      offscreen: mockOffscreenIntegration,
    }
    getDefinitionMock.mockReturnValue({
      resolution: { imageTransform: { kind: "none", estimatedCostMs: 0 } },
      retryOwner: "platform",
      runtimes: {
        dispatchContext: { mode: "optional", schemaVersion: 1 },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should return FALSE (failed) when images fail in NONE format, but keep successful images", async () => {
    const request = {
      jobId: "job-task1",
      attempt: 1,
      taskId: "task1",
      seriesKey: "test-site:test-book",
      book: {
        siteIntegrationId: "test-site",
        seriesTitle: "Test Book",
        coverUrl: undefined,
      },
      chapter: {
        url: "http://example.com/c1",
        title: "Chapter 1",
        id: "c1",
        index: 1,
        resolvedPath: "Chapter 1",
        volumeNumber: 1,
        chapterNumber: 1,
      },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
        archiveFormat: "none",
        includeComicInfo: true,
        includeCoverImage: true,
        overwriteExisting: false,
      },
      saveMode: "downloads-api" as const,
      integrationContext: {
        schemaVersion: 1,
        data: { taskId: "task-123" },
      },
    }

    const dispatch = await signDispatch(
      request as UnsignedOffscreenDownloadChapterPayload
    )
    const acknowledgment = await worker.processDownloadChapter(dispatch)
    await vi.waitFor(() =>
      expect(worker.getJobState(acknowledgment)).toMatchObject({
        status: "terminal",
        outcome: { status: "partial_success" },
      })
    )
    const outcome = worker.getJobState(acknowledgment)?.outcome

    // Check results
    const progressUpdates = messages.filter(
      (m) => m.type === "OFFSCREEN_DOWNLOAD_PROGRESS"
    )
    const chapterTerminalUpdate = messages.find(
      (m) =>
        m.type === "OFFSCREEN_JOB_TERMINAL" &&
        m.payload?.chapterId === "c1" &&
        m.payload?.outcome?.status === "partial_success"
    )

    expect(outcome?.status).toBe("partial_success")
    expect(chapterTerminalUpdate).toBeDefined()
    expect(chapterTerminalUpdate?.payload?.outcome?.status).toBe(
      "partial_success"
    )
    expect(
      progressUpdates.every((m) => m.payload?.chapterOutcomes === undefined)
    ).toBe(true)

    // Positive assertion: the successful image (img1.jpg) was kept and
    // passed through to the Downloads API, while the failed image (img2.jpg)
    // was dropped. In NONE format + downloads-api mode, each kept image is
    // handed off via an identity-bound OFFSCREEN_OUTPUT_READY message.
    const apiRequests = messages.filter(
      (m): m is { type: string; payload?: { filename?: string } } =>
        typeof m === "object" &&
        m !== null &&
        (m as { type?: string }).type === "OFFSCREEN_OUTPUT_READY"
    )
    const imageApiRequests = apiRequests.filter(
      (m) => !m.payload?.filename?.endsWith("ComicInfo.xml")
    )
    expect(imageApiRequests.length).toBe(1)
    expect(
      imageApiRequests[0].payload?.filename?.endsWith("normalized.jpg")
    ).toBe(true)
  })

  it("emits OFFSCREEN_DOWNLOAD_PROGRESS updates for single-chapter flow", async () => {
    const processChapterStreamingMock = vi
      .fn()
      .mockImplementation(async (opts: any) => {
        await opts.onProgress(20, undefined, { current: 1, total: 39 })
        await opts.onArchiveProgress(40)
        return {
          status: "completed",
          imagesFailed: 0,
          outputsRequested: 0,
          outputsFailedBeforeHandoff: 0,
          outputsCommitted: 0,
        }
      })

    worker.processChapterStreaming = processChapterStreamingMock

    const dispatch = await signDispatch({
      jobId: "job-task-single",
      attempt: 1,
      taskId: "task-single",
      seriesKey: "test-site:series-1",
      book: {
        siteIntegrationId: "test-site",
        seriesTitle: "Test Book",
        coverUrl: undefined,
      },
      chapter: {
        id: "c1",
        title: "Chapter 1",
        url: "http://example.com/c1",
        index: 1,
        chapterNumber: 1,
        resolvedPath: "Chapter 1",
      },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
        archiveFormat: "none",
        includeComicInfo: true,
      },
      saveMode: "downloads-api",
      integrationContext: {
        schemaVersion: 1,
        data: { taskId: "task-123" },
      },
    })
    const acknowledgment = await worker.processDownloadChapter(dispatch)
    await vi.waitFor(() =>
      expect(worker.getJobState(acknowledgment)).toMatchObject({
        status: "terminal",
        outcome: { status: "completed" },
      })
    )
    const outcome = worker.getJobState(acknowledgment)?.outcome

    const progressUpdates = messages.filter(
      (m) =>
        m.type === "OFFSCREEN_DOWNLOAD_PROGRESS" &&
        m.payload?.taskId === "task-single" &&
        m.payload?.chapterId === "c1" &&
        m.payload?.status === "downloading"
    )
    const terminalUpdate = messages.find(
      (m) =>
        m.type === "OFFSCREEN_JOB_TERMINAL" &&
        m.payload?.taskId === "task-single" &&
        m.payload?.chapterId === "c1" &&
        m.payload?.outcome?.status === "completed"
    )

    expect(progressUpdates.length).toBeGreaterThanOrEqual(1)
    const imageProgressUpdate = progressUpdates.find(
      (m) => m.payload?.imagesProcessed === 1
    )
    expect(imageProgressUpdate?.payload?.imagesProcessed).toBe(1)
    expect(imageProgressUpdate?.payload?.totalImages).toBe(39)
    expect(
      progressUpdates.every((m) => m.payload?.currentChapter === undefined)
    ).toBe(true)
    expect(
      progressUpdates.every((m) => m.payload?.progress === undefined)
    ).toBe(true)
    expect(outcome?.status).toBe("completed")
    expect(terminalUpdate).toBeDefined()
    expect(terminalUpdate?.payload?.outcome?.status).toBe("completed")
    const forwarded =
      processChapterStreamingMock.mock.calls[0]?.[0]?.integrationContext
    expect(forwarded).toEqual({ taskId: "task-123" })
  })

  it("keeps integration and retry settings isolated across concurrent jobs", async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const processChapterStreamingMock = vi.fn(
      async (opts: any, job: Record<string, unknown>) => {
        void job
        if (opts.taskId === "task-a") await firstGate
        return {
          status: "completed" as const,
          imagesFailed: 0,
          outputsRequested: 0,
          outputsFailedBeforeHandoff: 0,
          outputsCommitted: 0,
        }
      }
    )
    worker.processChapterStreaming = processChapterStreamingMock

    const createRequest = (
      taskId: string,
      integrationId: string,
      imageRetries: number
    ) => ({
      jobId: `job-${taskId}`,
      attempt: 1,
      taskId,
      seriesKey: `${integrationId}:series-1`,
      book: {
        siteIntegrationId: integrationId,
        seriesTitle: "Test Book",
      },
      chapter: {
        id: `${taskId}-chapter`,
        title: "Chapter 1",
        url: "https://example.com/chapter",
        index: 1,
        resolvedPath: "Chapter 1",
      },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, integrationId),
        archiveFormat: "none" as const,
        retrySettings: { image: imageRetries, chapter: imageRetries + 1 },
      },
      saveMode: "downloads-api" as const,
    })

    const firstDispatch = await signDispatch(
      createRequest(
        "task-a",
        "integration-a",
        1
      ) as UnsignedOffscreenDownloadChapterPayload
    )
    const first = await worker.processDownloadChapter(firstDispatch)
    await vi.waitFor(() =>
      expect(processChapterStreamingMock).toHaveBeenCalledTimes(1)
    )
    const secondDispatch = await signDispatch(
      createRequest(
        "task-b",
        "integration-b",
        7
      ) as UnsignedOffscreenDownloadChapterPayload
    )
    const second = await worker.processDownloadChapter(secondDispatch)
    await vi.waitFor(() =>
      expect(worker.getJobState(second)).toMatchObject({
        status: "terminal",
        outcome: { status: "completed" },
      })
    )
    releaseFirst()
    await vi.waitFor(() =>
      expect(worker.getJobState(first)).toMatchObject({
        status: "terminal",
        outcome: { status: "completed" },
      })
    )

    const terminalUpdates = messages.filter(
      (message) => message.type === "OFFSCREEN_JOB_TERMINAL"
    )
    expect(terminalUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: "task-a",
            outcome: {
              status: "completed",
              imagesFailed: 0,
              outputsRequested: 0,
              outputsFailedBeforeHandoff: 0,
              outputsCommitted: 0,
            },
          }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: "task-b",
            outcome: {
              status: "completed",
              imagesFailed: 0,
              outputsRequested: 0,
              outputsFailedBeforeHandoff: 0,
              outputsCommitted: 0,
            },
          }),
        }),
      ])
    )

    expect(processChapterStreamingMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        integrationId: "integration-a",
        retries: { image: 1, chapter: 2 },
      })
    )
    expect(processChapterStreamingMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        integrationId: "integration-b",
        retries: { image: 7, chapter: 8 },
      })
    )
  })

  it("suppresses terminal progress after a task is cancelled", async () => {
    vi.useFakeTimers()
    try {
      const cancellation = {
        identity: undefined as Record<string, unknown> | undefined,
      }
      worker.processChapterStreaming = vi
        .fn()
        .mockImplementation(async (opts: any) => {
          await opts.onProgress(10, "ready", { current: 0, total: 2 })
          await opts.onProgress(20, "downloading", { current: 1, total: 2 })
          worker.cancelJob(cancellation.identity)
          return {
            status: "completed",
            imagesFailed: 0,
            outputsRequested: 0,
            outputsFailedBeforeHandoff: 0,
            outputsCommitted: 0,
          }
        })

      const dispatch = await signDispatch({
        jobId: "job-cancelled",
        attempt: 1,
        taskId: "task-cancelled",
        seriesKey: "test-site:series-1",
        book: {
          siteIntegrationId: "test-site",
          seriesTitle: "Test Book",
          coverUrl: undefined,
        },
        chapter: {
          id: "c1",
          title: "Chapter 1",
          url: "http://example.com/c1",
          index: 1,
          chapterNumber: 1,
          resolvedPath: "Chapter 1",
        },
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
          archiveFormat: "none",
        },
        saveMode: "downloads-api",
      })
      cancellation.identity = await worker.processDownloadChapter(dispatch)
      await vi.waitFor(() =>
        expect(worker.getJobState(cancellation.identity)).toMatchObject({
          status: "canceled",
          outcome: { status: "completed" },
        })
      )
      const outcome = worker.getJobState(cancellation.identity)?.outcome

      await vi.advanceTimersByTimeAsync(300)
      const taskProgress = messages.filter(
        (message) =>
          message.type === "OFFSCREEN_DOWNLOAD_PROGRESS" &&
          message.payload?.taskId === "task-cancelled"
      )

      expect(outcome?.status).toBe("completed")
      expect(taskProgress).toHaveLength(2)
      expect(taskProgress[0]?.payload?.status).toBe("downloading")
      expect(taskProgress[0]?.payload?.imagesProcessed).toBe(0)
      expect(taskProgress[1]?.payload?.imagesProcessed).toBe(1)
      expect(
        messages.some(
          (message) =>
            message.type === "OFFSCREEN_JOB_TERMINAL" &&
            message.payload?.taskId === "task-cancelled"
        )
      ).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps the leading-edge progress update and emits the latest cumulative progress after the throttle window", async () => {
    vi.useFakeTimers()
    try {
      const processChapterStreamingMock = vi
        .fn()
        .mockImplementation(async (opts: any) => {
          await opts.onProgress(10, "ready", { current: 0, total: 4 })
          await opts.onProgress(20, undefined, { current: 1, total: 4 })
          return {
            status: "completed",
            imagesFailed: 0,
            outputsRequested: 0,
            outputsFailedBeforeHandoff: 0,
            outputsCommitted: 0,
          }
        })

      worker.processChapterStreaming = processChapterStreamingMock

      const dispatch = await signDispatch({
        jobId: "job-task-initial-progress",
        attempt: 1,
        taskId: "task-initial-progress",
        seriesKey: "test-site:series-1",
        book: {
          siteIntegrationId: "test-site",
          seriesTitle: "Test Book",
          coverUrl: undefined,
        },
        chapter: {
          id: "c1",
          title: "Chapter 1",
          url: "http://example.com/c1",
          index: 1,
          chapterNumber: 1,
          resolvedPath: "Chapter 1",
        },
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
          archiveFormat: "none",
          includeComicInfo: true,
        },
        saveMode: "downloads-api",
      })
      const acknowledgment = await worker.processDownloadChapter(dispatch)
      await vi.waitFor(() =>
        expect(worker.getJobState(acknowledgment)).toMatchObject({
          status: "terminal",
          outcome: { status: "completed" },
        })
      )

      const initialProgress = messages.find(
        (m) =>
          m.type === "OFFSCREEN_DOWNLOAD_PROGRESS" &&
          m.payload?.taskId === "task-initial-progress" &&
          m.payload?.chapterId === "c1" &&
          m.payload?.status === "downloading" &&
          m.payload?.imagesProcessed === 0 &&
          m.payload?.totalImages === 4
      )
      const immediateFollowUp = messages.find(
        (m) =>
          m.type === "OFFSCREEN_DOWNLOAD_PROGRESS" &&
          m.payload?.taskId === "task-initial-progress" &&
          m.payload?.chapterId === "c1" &&
          m.payload?.status === "downloading" &&
          m.payload?.imagesProcessed === 1
      )

      expect(initialProgress).toBeDefined()
      expect(initialProgress?.payload?.imagesFailed).toBe(0)
      // The throttled follow-up is flushed immediately when the terminal
      // progress message arrives (flushPendingChapterProgress), so it
      // appears in messages before the throttle window elapses.
      expect(immediateFollowUp).toBeDefined()
      expect(immediateFollowUp?.payload?.totalImages).toBe(4)
      expect(
        messages.find(
          (message) =>
            message.type === "OFFSCREEN_JOB_TERMINAL" &&
            message.payload?.taskId === "task-initial-progress"
        )?.payload?.outcome
      ).toEqual({
        status: "completed",
        imagesFailed: 0,
        outputsRequested: 0,
        outputsFailedBeforeHandoff: 0,
        outputsCommitted: 0,
      })

      await vi.advanceTimersByTimeAsync(250)

      const throttledFollowUp = messages.find(
        (m) =>
          m.type === "OFFSCREEN_DOWNLOAD_PROGRESS" &&
          m.payload?.taskId === "task-initial-progress" &&
          m.payload?.chapterId === "c1" &&
          m.payload?.status === "downloading" &&
          m.payload?.imagesProcessed === 1 &&
          m.payload?.totalImages === 4
      )

      expect(throttledFollowUp).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it("skips extension retry wrapper when integration declares handlesOwnRetries", async () => {
    offscreenSiteAdaptersById["test-site"] = {
      id: "test-site",
      offscreen: {
        name: "Test",
        dispatchContext: {
          parse: (value: unknown) => value as Record<string, unknown>,
        },
        chapter: {
          downloadImage: mockDownloadImage,
          resolveChapterPlan: async () => ({
            imageUrls: ["https://example.test/img1.jpg"],
          }),
        },
      },
    }
    getDefinitionMock.mockReturnValue({
      resolution: { imageTransform: { kind: "none", estimatedCostMs: 0 } },
      retryOwner: "provider",
      runtimes: {
        dispatchContext: { mode: "optional", schemaVersion: 1 },
      },
    })

    mockDownloadImage.mockReset()
    let callCount = 0
    mockDownloadImage.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        throw new Error("HTTP 503: Service Unavailable")
      }
      return {
        filename: "img1.jpg",
        data: new ArrayBuffer(10),
        mimeType: "image/jpeg",
      }
    })

    const dispatch = await signDispatch({
      jobId: "job-task-no-ext-retry",
      attempt: 1,
      taskId: "task-no-ext-retry",
      seriesKey: "test-site:series-1",
      book: {
        siteIntegrationId: "test-site",
        seriesTitle: "Test Book",
        coverUrl: undefined,
      },
      chapter: {
        id: "c1",
        title: "Chapter 1",
        url: "http://example.com/c1",
        index: 1,
        chapterNumber: 1,
        resolvedPath: "Chapter 1",
      },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
        archiveFormat: "none",
        includeComicInfo: false,
        includeCoverImage: false,
      },
      saveMode: "downloads-api",
    })
    const acknowledgment = await worker.processDownloadChapter(dispatch)
    await vi.waitFor(() =>
      expect(worker.getJobState(acknowledgment)).toMatchObject({
        status: "terminal",
        outcome: { status: "failed" },
      })
    )
    const outcome = worker.getJobState(acknowledgment)?.outcome

    expect(callCount).toBe(1)
    expect(outcome?.status).toBe("failed")
  })

  it("propagates job cancellation into provider URL resolution", async () => {
    let resolverSignal: AbortSignal | undefined
    const resolveChapterPlan = vi.fn(
      async (_chapter: unknown, input?: { signal?: AbortSignal }) => {
        resolverSignal = input?.signal
        return await new Promise<{ imageUrls: string[] }>((_, reject) => {
          input?.signal?.addEventListener(
            "abort",
            () => reject(new Error("job-cancelled")),
            { once: true }
          )
        })
      }
    )
    offscreenSiteAdaptersById["test-site"] = {
      id: "test-site",
      offscreen: {
        name: "Cancelable integration",
        dispatchContext: {
          parse: (value: unknown) => value as Record<string, unknown>,
        },
        chapter: {
          resolveChapterPlan,
          downloadImage: mockDownloadImage,
        },
      },
    }

    const dispatch = await signDispatch({
      jobId: "job-cancel-resolver",
      attempt: 1,
      taskId: "task-cancel-resolver",
      seriesKey: "test-site:series-1",
      book: {
        siteIntegrationId: "test-site",
        seriesTitle: "Test Book",
      },
      chapter: {
        id: "c1",
        title: "Chapter 1",
        url: "https://example.com/c1",
        index: 1,
        resolvedPath: "Chapter 1",
      },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
        archiveFormat: "none",
        includeComicInfo: false,
        includeCoverImage: false,
      },
      saveMode: "downloads-api",
    })
    const acknowledgment = await worker.processDownloadChapter(dispatch)
    await vi.waitFor(() => expect(resolverSignal).toBeInstanceOf(AbortSignal))

    expect(worker.cancelJob(acknowledgment)).toMatchObject({
      canceled: true,
      status: "canceled",
    })
    await vi.waitFor(() =>
      expect(worker.getJobState(acknowledgment)).toMatchObject({
        status: "canceled",
      })
    )

    expect(resolverSignal?.aborted).toBe(true)
    expect(resolveChapterPlan).toHaveBeenCalledOnce()
  })

  it("aborts provider URL resolution when its attempt times out", async () => {
    vi.useFakeTimers()
    let resolverSignal: AbortSignal | undefined
    const resolveChapterPlan = vi.fn(
      async (_chapter: unknown, input?: { signal?: AbortSignal }) => {
        resolverSignal = input?.signal
        return await new Promise<{ imageUrls: string[] }>((_, reject) => {
          input?.signal?.addEventListener(
            "abort",
            () => reject(new Error("provider request aborted")),
            { once: true }
          )
        })
      }
    )
    offscreenSiteAdaptersById["test-site"] = {
      id: "test-site",
      offscreen: {
        name: "Timeout-aware integration",
        dispatchContext: {
          parse: (value: unknown) => value as Record<string, unknown>,
        },
        chapter: {
          resolveChapterPlan,
          downloadImage: mockDownloadImage,
        },
      },
    }

    const dispatch = await signDispatch({
      jobId: "job-timeout-resolver",
      attempt: 1,
      taskId: "task-timeout-resolver",
      seriesKey: "test-site:series-1",
      book: {
        siteIntegrationId: "test-site",
        seriesTitle: "Test Book",
      },
      chapter: {
        id: "c1",
        title: "Chapter 1",
        url: "https://example.com/c1",
        index: 1,
        resolvedPath: "Chapter 1",
      },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
        archiveFormat: "none",
        includeComicInfo: false,
        includeCoverImage: false,
        retrySettings: { image: 0, chapter: 0 },
      },
      saveMode: "downloads-api",
    })
    const acknowledgment = await worker.processDownloadChapter(dispatch)
    await vi.waitFor(() => expect(resolverSignal).toBeInstanceOf(AbortSignal))

    await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS)
    await vi.waitFor(() =>
      expect(worker.getJobState(acknowledgment)).toMatchObject({
        status: "terminal",
      })
    )
    const outcome = worker.getJobState(acknowledgment)?.outcome

    expect(outcome).toMatchObject({
      status: "failed",
      errorMessage: "resolveChapterPlan timeout",
    })
    expect(resolverSignal?.aborted).toBe(true)
    expect(resolveChapterPlan).toHaveBeenCalledOnce()
  })

  it("does not emit premature progress with totalImages:0 before URL resolution", async () => {
    let resolveCoverFetch!: (value: {
      filename: string
      data: ArrayBuffer
      mimeType: string
    }) => void
    mockDownloadImage.mockImplementationOnce(async () => {
      return await new Promise((resolve) => {
        resolveCoverFetch = resolve
      })
    })

    const dispatch = await signDispatch({
      jobId: "job-task-cover-progress",
      attempt: 1,
      taskId: "task-cover-progress",
      seriesKey: "test-site:series-1",
      book: {
        siteIntegrationId: "test-site",
        seriesTitle: "Test Book",
        coverUrl: "https://example.com/cover.jpg",
      },
      chapter: {
        id: "c1",
        title: "Chapter 1",
        url: "http://example.com/c1",
        index: 1,
        chapterNumber: 1,
        resolvedPath: "Chapter 1",
      },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
        archiveFormat: "none",
        includeComicInfo: true,
        includeCoverImage: true,
      },
      saveMode: "downloads-api",
    })
    const acknowledgment = await worker.processDownloadChapter(dispatch)

    await Promise.resolve()
    await Promise.resolve()

    await vi.waitFor(() => {
      expect(mockDownloadImage).toHaveBeenCalledWith(
        "https://example.com/cover.jpg",
        expect.any(Object)
      )
      expect(resolveCoverFetch).toBeTypeOf("function")
    })

    // No progress message should be emitted before URL resolution completes.
    // The first progress message carries the correct totalImages (not 0).
    const prematureProgress = messages.find(
      (m) =>
        m.type === "OFFSCREEN_DOWNLOAD_PROGRESS" &&
        m.payload?.taskId === "task-cover-progress" &&
        m.payload?.chapterId === "c1" &&
        m.payload?.totalImages === 0
    )

    expect(prematureProgress).toBeUndefined()

    resolveCoverFetch({
      filename: "cover.jpg",
      data: new ArrayBuffer(8),
      mimeType: "image/jpeg",
    })

    await vi.waitFor(() =>
      expect(worker.getJobState(acknowledgment)).toMatchObject({
        status: "terminal",
      })
    )
  })
})
