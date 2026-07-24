import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import { siteIntegrationRegistry } from "@/src/runtime/site-integration-registry"
import type { OffscreenIntegration } from "@/src/types/site-integrations"
import {
  loadDownloadRootHandle,
  verifyPermission,
  writeBlobToPath,
} from "@/src/storage/fs-access"

// Mock dependencies
vi.mock("@/src/runtime/site-integration-registry", () => ({
  siteIntegrationRegistry: {
    getSiteIntegration: vi.fn(),
    findById: vi.fn(),
  },
  registerSiteIntegration: vi.fn(),
}))

vi.mock("@/src/runtime/rate-limit", () => ({
  scheduleForIntegrationScope: async (
    _id: string,
    _scope: string,
    fn: () => Promise<unknown>
  ) => fn(),
}))

vi.mock("@/src/shared/filename-sanitizer", () => ({
  sanitizeFilename: (s: string) => s,
  normalizeImageFilename: () => "normalized.jpg",
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
  fetchChapterHtml: vi.fn(),
  getHttpStatusFromError: () => 500,
}))

vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: vi.fn(),
  verifyPermission: vi.fn(),
  writeBlobToPath: vi.fn(),
}))

vi.mock("@/src/shared/settings-utils", () => ({
  resolveEffectiveRetries: async () => ({ image: 3, chapter: 3 }),
}))

// Mock global chrome
const messages: any[] = []
global.chrome = {
  runtime: {
    sendMessage: vi.fn(async (msg) => {
      messages.push(msg)
      if (msg.type === "OFFSCREEN_OUTPUT_READY") {
        return { success: true, id: 101 }
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
      if (url === "img2.jpg") {
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
      chapter: {
        images: async () => [
          { url: "img1.jpg", headers: {} },
          { url: "img2.jpg", headers: {} },
        ],
        downloadImage: mockDownloadImage,
        parseImageUrlsFromHtml: async () => ["img1.jpg", "img2.jpg"],
        processImageUrls: async (raw: any) => raw,
      },
    } as unknown as OffscreenIntegration

    // Fix mock return value structure for findById
    vi.mocked(siteIntegrationRegistry.findById).mockReturnValue({
      integration: { offscreen: mockOffscreenIntegration },
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should return FALSE (failed) when images fail in NONE format, but keep successful images", async () => {
    const request = {
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
        volumeNumber: "1",
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
        taskId: "task-123",
      },
    }

    const outcome = await worker.processDownloadChapter(request as any)

    // Check results
    const progressUpdates = messages.filter(
      (m) => m.type === "OFFSCREEN_DOWNLOAD_PROGRESS"
    )
    const chapterTerminalUpdate = progressUpdates.find(
      (m) =>
        m.payload?.chapterId === "c1" &&
        (m.payload?.status === "completed" ||
          m.payload?.status === "failed" ||
          m.payload?.status === "partial_success")
    )

    expect(outcome.status).toBe("partial_success")
    expect(chapterTerminalUpdate).toBeDefined()
    expect(chapterTerminalUpdate?.payload?.status).toBe("partial_success")
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
        return { status: "completed", imagesFailed: 0 }
      })

    worker.processChapterStreaming = processChapterStreamingMock

    const outcome = await worker.processDownloadChapter({
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
        taskId: "task-123",
      },
    })

    const progressUpdates = messages.filter(
      (m) =>
        m.type === "OFFSCREEN_DOWNLOAD_PROGRESS" &&
        m.payload?.taskId === "task-single" &&
        m.payload?.chapterId === "c1" &&
        m.payload?.status === "downloading"
    )
    const terminalUpdate = messages.find(
      (m) =>
        m.type === "OFFSCREEN_DOWNLOAD_PROGRESS" &&
        m.payload?.taskId === "task-single" &&
        m.payload?.chapterId === "c1" &&
        m.payload?.status === "completed"
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
    expect(outcome.status).toBe("completed")
    expect(terminalUpdate).toBeDefined()
    expect(terminalUpdate?.payload?.status).toBe("completed")
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
        return { status: "completed" as const }
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

    const first = worker.processDownloadChapter(
      createRequest("task-a", "integration-a", 1)
    )
    await vi.waitFor(() =>
      expect(processChapterStreamingMock).toHaveBeenCalledTimes(1)
    )
    const second = worker.processDownloadChapter(
      createRequest("task-b", "integration-b", 7)
    )
    await second
    releaseFirst()
    await first

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

  it("suppresses terminal and queued progress after a task is cancelled", async () => {
    vi.useFakeTimers()
    try {
      worker.processChapterStreaming = vi
        .fn()
        .mockImplementation(async (opts: any) => {
          await opts.onProgress(10, "ready", { current: 0, total: 2 })
          await opts.onProgress(20, "downloading", { current: 1, total: 2 })
          worker.cancelTask("task-cancelled")
          return { status: "completed", imagesFailed: 0 }
        })

      const outcome = await worker.processDownloadChapter({
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

      await vi.advanceTimersByTimeAsync(300)
      const taskProgress = messages.filter(
        (message) =>
          message.type === "OFFSCREEN_DOWNLOAD_PROGRESS" &&
          message.payload?.taskId === "task-cancelled"
      )

      expect(outcome.status).toBe("completed")
      expect(taskProgress).toHaveLength(1)
      expect(taskProgress[0]?.payload?.status).toBe("downloading")
      expect(taskProgress[0]?.payload?.imagesProcessed).toBe(0)
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
          return { status: "completed", imagesFailed: 0 }
        })

      worker.processChapterStreaming = processChapterStreamingMock

      const downloadPromise = worker.processDownloadChapter({
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

      await downloadPromise

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
    vi.mocked(siteIntegrationRegistry.findById).mockReturnValue({
      id: "test-site",
      name: "Test",
      author: "test",
      handlesOwnRetries: true,
      integration: {
        offscreen: {
          chapter: {
            downloadImage: mockDownloadImage,
            parseImageUrlsFromHtml: async () => ["img1.jpg"],
            processImageUrls: async (raw: any) => raw,
            resolveImageUrls: async () => ["img1.jpg"],
          },
        },
      },
    } as any)

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

    const outcome = await worker.processDownloadChapter({
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

    expect(callCount).toBe(1)
    expect(outcome.status).toBe("failed")
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

    const downloadPromise = worker.processDownloadChapter({
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

    await downloadPromise
  })
})
