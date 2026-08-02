import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type {
  DownloadTaskState,
  GlobalAppState,
  TaskChapter,
} from "@/src/types/queue-state"
import type { MangaPageState, ChapterState } from "@/src/types/tab-state"
import type { DownloadTaskStatus } from "@/src/shared/download-contract"
import { vi } from "vitest"
import { destinationService } from "@/entrypoints/background/destination"
import { ensureSiteIntegrationNetworkReady } from "@/src/site-integrations/session-rule-manager"
import { isExecutingDownloadTask } from "@/src/runtime/download-task-execution-state"

export const mockEnsureSiteIntegrationNetworkReady = vi.mocked(
  ensureSiteIntegrationNetworkReady
)

vi.mock("../../entrypoints/background/queue-helpers", () => ({
  resolveDownloadPlan: vi.fn().mockResolvedValue({
    format: "cbz",
    overwriteExisting: false,
    book: {
      siteId: "test-site",
      seriesId: "series-1",
      seriesTitle: "Test Manga",
      comicInfoBase: { Series: "Test Manga" },
    },
    chapters: [
      {
        id: "ch1",
        url: "https://example.com/ch1",
        title: "Chapter 1",
        chapterNumber: 1,
        resolvedPath: "/downloads/Test Manga/Chapter 1.cbz",
      },
    ],
  }),
  validateDownloadPathForTask: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("@/src/runtime/rate-limit", () => ({
  resolveEffectivePolicy: vi.fn(),
  scheduleForIntegrationScope: vi.fn(),
}))

vi.mock("@/src/runtime/site-integration-registry", () => ({
  findSiteIntegrationForUrl: vi.fn(() => ({
    id: "test-integration",
    name: "Test Integration",
    author: "tester",
  })),
  siteIntegrationRegistry: {
    findById: vi.fn(() => null),
  },
}))

vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  getBackgroundSiteAdapterById: vi.fn().mockResolvedValue(undefined),
}))

export {
  moveTaskToTop,
  processDownloadQueue,
  startDownloadTask,
} from "@/entrypoints/background/download-queue"

export let mockStateManager: CentralizedStateManager
export let mockEnsureOffscreenReady: () => Promise<void>
export let mockRuntimeSendMessage: ReturnType<typeof vi.fn>
export let mockGlobalState: GlobalAppState
export let mockTabState: MangaPageState

export const testSettings = {
  ...DEFAULT_SETTINGS,
  downloads: {
    ...DEFAULT_SETTINGS.downloads,
    pathTemplate: "/downloads",
  },
}

export const createChapter = (
  partial: Partial<ChapterState>
): ChapterState => ({
  id:
    partial.id ??
    (() => {
      const fallbackUrl = partial.url ?? "https://example.com/ch1"
      try {
        return (
          new URL(fallbackUrl).pathname.split("/").filter(Boolean).at(-1) ??
          "ch1"
        )
      } catch {
        return fallbackUrl
      }
    })(),
  url: partial.url || "https://example.com/ch1",
  title: partial.title || "Chapter 1",
  index: partial.index ?? 1,
  chapterNumber: partial.chapterNumber,
  status: partial.status || "queued",
  lastUpdated: partial.lastUpdated || Date.now(),
  ...partial,
})

export const makeTask = (
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState => {
  const siteIntegrationId = overrides.siteIntegrationId ?? "test-site"
  return {
    id: overrides.id ?? "task-1",
    siteIntegrationId,
    mangaId: overrides.mangaId ?? "series-1",
    seriesTitle: overrides.seriesTitle ?? "Test Manga",
    chapters: overrides.chapters ?? [
      createChapter({
        url: "https://example.com/ch1",
        title: "Chapter 1",
        chapterNumber: 1,
      }),
    ],
    status: overrides.status ?? "queued",
    created: overrides.created ?? Date.now(),
    completed: overrides.completed,
    started: overrides.started,
    errorMessage: overrides.errorMessage,
    activeBlock: overrides.activeBlock,
    lastSuccessfulDownloadId: overrides.lastSuccessfulDownloadId,
    isRetried: overrides.isRetried,
    isRetryTask: overrides.isRetryTask,
    settingsSnapshot:
      overrides.settingsSnapshot ??
      createTaskSettingsSnapshot(testSettings, siteIntegrationId),
  }
}

export async function resetDownloadQueueTestEnvironment(): Promise<void> {
  vi.clearAllMocks()
  vi.mocked(destinationService.getEffectiveDestination).mockResolvedValue({
    kind: "downloads",
  })
  vi.mocked(destinationService.preflight).mockResolvedValue({ ready: true })
  if (vi.isMockFunction(mockEnsureSiteIntegrationNetworkReady)) {
    mockEnsureSiteIntegrationNetworkReady.mockResolvedValue(undefined)
  }

  mockGlobalState = {
    downloadQueue: [],
    lastActivity: Date.now(),
    settings: testSettings,
  }

  mockTabState = {
    siteIntegrationId: "test-site",
    mangaId: "series-1",
    seriesTitle: "Test Manga",
    chapters: [],
    volumes: [],
    metadata: {},
    lastUpdated: Date.now(),
  }

  const updateDownloadTaskMock = vi
    .fn()
    .mockImplementation(
      async (taskId: string, updates: Partial<DownloadTaskState>) => {
        const taskIndex = mockGlobalState.downloadQueue.findIndex(
          (task) => task.id === taskId
        )
        if (taskIndex >= 0) {
          mockGlobalState.downloadQueue[taskIndex] = {
            ...mockGlobalState.downloadQueue[taskIndex],
            ...updates,
          }
        }
      }
    )

  const updateDownloadTaskChapterMock = vi.fn().mockImplementation(
    async (
      taskId: string,
      chapterId: string,
      status: TaskChapter["status"],
      updates?: {
        errorMessage?: string
        totalImages?: number
        imagesFailed?: number
      }
    ) => {
      const task = mockGlobalState.downloadQueue.find((t) => t.id === taskId)
      const chapterIndex =
        task?.chapters.findIndex((c) => c.id === chapterId) ?? -1
      if (task && chapterIndex >= 0) {
        const chapter = task.chapters[chapterIndex]
        if (chapter) {
          task.chapters[chapterIndex] = {
            ...chapter,
            status,
            errorMessage: updates?.errorMessage,
            totalImages: updates?.totalImages ?? chapter.totalImages,
            imagesFailed: updates?.imagesFailed ?? chapter.imagesFailed,
            lastUpdated: Date.now(),
          }
        }
      }
    }
  )

  const updateDownloadingTaskChapterMock = vi.fn().mockImplementation(
    async (
      taskId: string,
      chapterId: string,
      status: TaskChapter["status"],
      updates?: {
        errorMessage?: string
        totalImages?: number
        imagesFailed?: number
      }
    ) => {
      const task = mockGlobalState.downloadQueue.find((t) => t.id === taskId)
      if (!task) {
        return { success: false as const, reason: "task-not-found" as const }
      }
      if (task.status !== "downloading") {
        return {
          success: false as const,
          reason: "task-not-downloading" as const,
          currentStatus: task.status,
        }
      }
      const chapter = task.chapters.find(
        (candidate) => candidate.id === chapterId
      )
      if (!chapter) {
        return {
          success: false as const,
          reason: "chapter-not-found" as const,
        }
      }
      const chapterIsTerminal =
        chapter.status === "completed" ||
        chapter.status === "failed" ||
        chapter.status === "partial_success"
      if (chapterIsTerminal && chapter.status !== status) {
        return { success: true as const, updated: false }
      }

      await updateDownloadTaskChapterMock(taskId, chapterId, status, updates)
      return { success: true as const, updated: true }
    }
  )

  const transitionDownloadTaskMock = vi.fn().mockImplementation(
    async (
      taskId: string,
      allowedCurrentStatuses: readonly DownloadTaskStatus[],
      updates: Partial<DownloadTaskState> & {
        status: DownloadTaskStatus
      }
    ) => {
      const task = mockGlobalState.downloadQueue.find(
        (candidate) => candidate.id === taskId
      )
      if (!task) {
        return { success: false as const, reason: "not-found" as const }
      }
      if (!allowedCurrentStatuses.includes(task.status)) {
        return {
          success: false as const,
          reason: "invalid-status" as const,
          currentStatus: task.status,
        }
      }
      if (
        updates.status === "downloading" &&
        mockGlobalState.downloadQueue.some(
          (candidate) =>
            candidate.id !== taskId && isExecutingDownloadTask(candidate)
        )
      ) {
        return {
          success: false as const,
          reason: "active-task-exists" as const,
        }
      }

      await updateDownloadTaskMock(taskId, updates)
      return {
        success: true as const,
        task: mockGlobalState.downloadQueue.find(
          (candidate) => candidate.id === taskId
        )!,
      }
    }
  )

  const transitionDownloadTaskWithDestinationIssuesMock = vi
    .fn()
    .mockImplementation(
      async (
        taskId: string,
        allowedCurrentStatuses: readonly DownloadTaskStatus[],
        updates: Partial<DownloadTaskState> & { status: DownloadTaskStatus }
      ) => transitionDownloadTaskMock(taskId, allowedCurrentStatuses, updates)
    )

  const beginChapterDispatchMock = vi
    .fn()
    .mockImplementation(
      async (input: {
        taskId: string
        chapterId: string
        lease: { attempt: number }
      }) => {
        const task = mockGlobalState.downloadQueue.find(
          (candidate) => candidate.id === input.taskId
        )
        if (!task) {
          return { success: false as const, reason: "task-not-found" as const }
        }
        if (task.status !== "downloading") {
          return {
            success: false as const,
            reason: "task-not-downloading" as const,
            currentStatus: task.status,
          }
        }
        const chapterIndex = task.chapters.findIndex(
          (chapter) => chapter.id === input.chapterId
        )
        if (chapterIndex === -1) {
          return {
            success: false as const,
            reason: "chapter-not-found" as const,
          }
        }
        const chapter = task.chapters[chapterIndex]
        if (chapter.status !== "queued" && chapter.status !== "downloading") {
          return {
            success: false as const,
            reason: "chapter-not-dispatchable" as const,
          }
        }

        task.chapters[chapterIndex] = {
          ...chapter,
          status: "downloading",
          dispatchAttempt: input.lease.attempt,
          outputs: { requested: 0, committed: 0, failed: 0 },
          errorMessage: undefined,
          lastUpdated: Date.now(),
        }
        return { success: true as const, updated: true as const }
      }
    )

  mockStateManager = {
    getGlobalState: vi.fn().mockResolvedValue(mockGlobalState),
    getTabState: vi.fn().mockResolvedValue(mockTabState),
    updateDownloadTask: updateDownloadTaskMock,
    transitionDownloadTask: transitionDownloadTaskMock,
    transitionDownloadTaskWithDestinationIssues:
      transitionDownloadTaskWithDestinationIssuesMock,
    beginChapterDispatch: beginChapterDispatchMock,
    updateDownloadTaskChapter: updateDownloadTaskChapterMock,
    updateDownloadingTaskChapter: updateDownloadingTaskChapterMock,
    updateGlobalState: vi
      .fn()
      .mockImplementation(async (updates: Partial<GlobalAppState>) => {
        mockGlobalState = {
          ...mockGlobalState,
          ...updates,
        }
      }),
    updateDownloadQueueAtomically: vi.fn().mockImplementation(
      async (
        update: (queue: readonly DownloadTaskState[]) => {
          queue: DownloadTaskState[]
          result: unknown
        }
      ) => {
        const outcome = update(mockGlobalState.downloadQueue)
        mockGlobalState = {
          ...mockGlobalState,
          downloadQueue: outcome.queue,
        }
        return outcome.result
      }
    ),
  } as unknown as CentralizedStateManager

  mockEnsureOffscreenReady = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined)
  mockRuntimeSendMessage = vi
    .fn()
    .mockResolvedValue({ success: true, status: "completed" })

  const chromeMock = {
    runtime: {
      sendMessage: mockRuntimeSendMessage,
    },
    storage: {
      session: {
        set: vi.fn(async () => undefined),
      },
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
  }
  vi.stubGlobal("chrome", chromeMock)
  ;(globalThis as { chrome?: unknown }).chrome = chromeMock

  const rateLimit = await import("@/src/runtime/rate-limit")
  const mockedResolvePolicy = vi.mocked(rateLimit.resolveEffectivePolicy)
  const mockedSchedule = vi.mocked(rateLimit.scheduleForIntegrationScope)

  mockedResolvePolicy.mockResolvedValue({ concurrency: 1, delayMs: 0 })
  mockedSchedule.mockImplementation(
    async (
      _integrationId: string,
      _scope: string,
      task: () => Promise<unknown>
    ) => {
      return task()
    }
  )
}
