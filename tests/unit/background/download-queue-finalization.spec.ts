import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  finalizeDownloadTaskAfterDispatch,
  notifyDownloadTaskCompletion,
  reconcileCompletedChapterHistory,
} from "@/entrypoints/background/download-queue-finalization"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { DownloadTaskState } from "@/src/types/queue-state"
import type { DownloadedChapterRecord } from "@/src/storage/chapter-persistence-service"

const notificationMocks = vi.hoisted(() => ({
  showDownloadCompleteNotification: vi.fn(),
  notifyTaskFailed: vi.fn(),
}))

const persistenceMocks = vi.hoisted(() => ({
  getDownloadedChapters: vi.fn<() => Promise<DownloadedChapterRecord[]>>(
    async () => []
  ),
  markChapterAsDownloaded: vi.fn(async () => undefined),
  restoreChapterFromCompletedTask: vi.fn(async () => true),
}))

vi.mock("@/src/storage/chapter-persistence-service", () => ({
  chapterPersistenceService: persistenceMocks,
  composeDownloadedChapterKey: (
    siteIntegrationId: string,
    seriesId: string,
    chapterId: string
  ) => `${siteIntegrationId}\u0000${seriesId}\u0000${chapterId}`,
}))

vi.mock("@/src/storage/settings-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/storage/settings-service")>()
  return {
    ...actual,
    settingsService: {
      getSettings: vi.fn(async () => ({ notifications: true })),
    },
  }
})

vi.mock("@/entrypoints/background/notification-service", () => ({
  getNotificationService: () => notificationMocks,
}))

describe("download task finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reconciles only fully completed chapters missing from history", async () => {
    persistenceMocks.getDownloadedChapters.mockResolvedValueOnce([
      {
        siteIntegrationId: "mangadex",
        chapterId: "already-recorded",
        url: "https://example.com/already-recorded",
        title: "Already recorded",
        seriesId: "series-1",
        seriesTitle: "Series 1",
        downloadedAt: 1,
        format: "cbz",
      },
    ])
    const task = {
      id: "task-reconcile",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series 1",
      chapters: [
        {
          id: "already-recorded",
          title: "Already recorded",
          url: "https://example.com/already-recorded",
          index: 1,
          status: "completed",
          lastUpdated: 1,
        },
        {
          id: "missing-completed",
          title: "Missing completed",
          url: "https://example.com/missing-completed",
          index: 2,
          status: "completed",
          lastUpdated: 1,
        },
        {
          id: "partial",
          title: "Partial",
          url: "https://example.com/partial",
          index: 3,
          status: "partial_success",
          lastUpdated: 1,
        },
        {
          id: "failed",
          title: "Failed",
          url: "https://example.com/failed",
          index: 4,
          status: "failed",
          lastUpdated: 1,
        },
      ],
      status: "partial_success",
      created: 1,
      settingsSnapshot: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "mangadex"
      ),
    } as DownloadTaskState

    await reconcileCompletedChapterHistory([task])

    expect(
      persistenceMocks.restoreChapterFromCompletedTask
    ).toHaveBeenCalledTimes(1)
    expect(
      persistenceMocks.restoreChapterFromCompletedTask
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterId: "missing-completed",
        seriesId: "series-1",
      }),
      1
    )
  })

  it("does not resurrect a completed chapter cleared after its last update", async () => {
    persistenceMocks.restoreChapterFromCompletedTask.mockResolvedValueOnce(
      false
    )
    const task = {
      id: "task-cleared-history",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series 1",
      chapters: [
        {
          id: "cleared",
          title: "Cleared",
          url: "https://example.com/cleared",
          index: 1,
          status: "completed",
          lastUpdated: 1,
        },
      ],
      status: "completed",
      created: 1,
      settingsSnapshot: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "mangadex"
      ),
    } as DownloadTaskState

    await reconcileCompletedChapterHistory([task])

    expect(
      persistenceMocks.restoreChapterFromCompletedTask
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        siteIntegrationId: "mangadex",
        seriesId: "series-1",
        chapterId: "cleared",
      }),
      1
    )
    expect(persistenceMocks.markChapterAsDownloaded).not.toHaveBeenCalled()
  })

  it("restores a completed chapter updated after history was cleared", async () => {
    const task = {
      id: "task-completed-after-clear",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series 1",
      chapters: [
        {
          id: "new-completion",
          title: "New completion",
          url: "https://example.com/new-completion",
          index: 1,
          status: "completed",
          lastUpdated: 3,
        },
      ],
      status: "completed",
      created: 1,
      settingsSnapshot: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "mangadex"
      ),
    } as DownloadTaskState

    await reconcileCompletedChapterHistory([task])

    expect(
      persistenceMocks.restoreChapterFromCompletedTask
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        siteIntegrationId: "mangadex",
        seriesId: "series-1",
        chapterId: "new-completion",
      }),
      3
    )
  })

  it("does not overwrite a task that was canceled before finalization commits", async () => {
    const transitionDownloadTask = vi.fn(async () => ({
      success: false as const,
      reason: "invalid-status" as const,
      currentStatus: "canceled" as const,
    }))
    const updateDownloadTask = vi.fn(async () => undefined)
    const stateManager = {
      transitionDownloadTask,
      updateDownloadTask,
    } as unknown as CentralizedStateManager
    const task: DownloadTaskState = {
      id: "task-canceled-at-finish",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series 1",
      chapters: [],
      status: "downloading",
      created: 1,
      settingsSnapshot: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "mangadex"
      ),
    }

    const result = await finalizeDownloadTaskAfterDispatch({
      stateManager,
      taskId: task.id,
      task,
      chapterOutcomesByIndex: [],
      settingsSnapshot: task.settingsSnapshot,
    })

    expect(transitionDownloadTask).toHaveBeenCalledWith(
      task.id,
      ["downloading"],
      expect.objectContaining({ status: "completed" })
    )
    expect(updateDownloadTask).not.toHaveBeenCalled()
    expect(result.finalized).toBe(false)
  })

  it("notifies when every unsuccessful chapter is partial without a task error message", async () => {
    const task = {
      id: "task-all-partial",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series 1",
      chapters: [
        {
          id: "chapter-1",
          title: "Chapter 1",
          url: "https://example.com/chapter-1",
          index: 1,
          status: "partial_success",
          lastUpdated: 1,
        },
      ],
      status: "partial_success",
      created: 1,
      settingsSnapshot: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "mangadex"
      ),
    } as DownloadTaskState
    const stateManager = {
      getGlobalState: vi.fn(async () => ({ downloadQueue: [task] })),
    } as unknown as CentralizedStateManager

    await notifyDownloadTaskCompletion({
      stateManager,
      taskId: task.id,
      finalStatus: "partial_success",
      completedCount: 0,
      totalChapters: 1,
    })

    expect(notificationMocks.notifyTaskFailed).toHaveBeenCalledWith({
      task,
      notificationsEnabled: true,
      errorMessage: undefined,
    })
  })
})
