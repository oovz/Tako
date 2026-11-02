import { reconcileCompletedChapterHistory } from "@/src/storage/completed-chapter-history"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  finalizeDownloadTaskAfterDispatch,
  notifyDownloadTaskCompletion,
} from "@/entrypoints/background/download-queue-finalization"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { DownloadedChapterRecord } from "@/src/domain/history/types"

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

vi.mock("@/entrypoints/background/notification-service", () => ({
  getNotificationService: () => notificationMocks,
}))

describe("download task finalization", () => {
  const finalizationDependencies = {
    historyRepository: persistenceMocks,
    settingsRepository: {
      getSettings: vi.fn(async () => ({
        ...DEFAULT_SETTINGS,
        notifications: true,
      })),
    },
  }
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
          requestedPath: "Tako/Chapter.cbz",
          id: "already-recorded",
          title: "Already recorded",
          url: "https://example.com/already-recorded",
          index: 1,
          status: "completed",
          lastUpdated: 1,
        },
        {
          requestedPath: "Tako/Chapter.cbz",
          id: "missing-completed",
          title: "Missing completed",
          url: "https://example.com/missing-completed",
          index: 2,
          status: "completed",
          lastUpdated: 1,
        },
        {
          requestedPath: "Tako/Chapter.cbz",
          id: "partial",
          title: "Partial",
          url: "https://example.com/partial",
          index: 3,
          status: "partial_success",
          lastUpdated: 1,
        },
        {
          requestedPath: "Tako/Chapter.cbz",
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

    await reconcileCompletedChapterHistory(
      [task],
      finalizationDependencies.historyRepository
    )

    expect(
      persistenceMocks.restoreChapterFromCompletedTask
    ).toHaveBeenCalledTimes(1)
    expect(
      persistenceMocks.restoreChapterFromCompletedTask
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterId: "missing-completed",
        seriesId: "series-1",
        downloadedAt: 1,
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
          requestedPath: "Tako/Chapter.cbz",
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

    await reconcileCompletedChapterHistory(
      [task],
      finalizationDependencies.historyRepository
    )

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
          requestedPath: "Tako/Chapter.cbz",
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

    await reconcileCompletedChapterHistory(
      [task],
      finalizationDependencies.historyRepository
    )

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
    const finalizeDownloadTask = vi.fn(async () => ({
      outcome: "rejected" as const,
      reason: "task-not-active" as const,
      currentStatus: "canceled" as const,
    }))
    const queueRepository = {
      finalizeDownloadTask,
    } as unknown as QueueRepository
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
      stateManager: queueRepository,
      taskId: task.id,
      chapterOutcomesByIndex: [],
      finalizationDependencies,
    })

    expect(finalizeDownloadTask).toHaveBeenCalledWith({
      taskId: task.id,
      chapterOutcomesByIndex: [],
      completedAt: expect.any(Number),
      clearLease: undefined,
    })
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
          requestedPath: "Tako/Chapter.cbz",
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
    const queueRepository = {
      getTask: vi.fn(async () => task),
    } as unknown as QueueRepository

    await notifyDownloadTaskCompletion({
      stateManager: queueRepository,
      taskId: task.id,
      finalStatus: "partial_success",
      completedCount: 0,
      totalChapters: 1,
      settingsRepository: finalizationDependencies.settingsRepository,
    })

    expect(notificationMocks.notifyTaskFailed).toHaveBeenCalledWith({
      task,
      notificationsEnabled: true,
      errorMessage: undefined,
    })
  })

  it("observes and contains a rejected notification API promise", async () => {
    const task = {
      id: "task-notification-rejection",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series 1",
      chapters: [
        {
          requestedPath: "Tako/Chapter.cbz",
          id: "chapter-1",
          title: "Chapter 1",
          url: "https://example.com/chapter-1",
          index: 0,
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
    const queueRepository = {
      getTask: vi.fn(async () => task),
    } as unknown as QueueRepository
    notificationMocks.showDownloadCompleteNotification.mockRejectedValueOnce(
      new Error("notification API rejected")
    )

    await expect(
      notifyDownloadTaskCompletion({
        stateManager: queueRepository,
        taskId: task.id,
        finalStatus: "completed",
        completedCount: 1,
        totalChapters: 1,
        settingsRepository: finalizationDependencies.settingsRepository,
      })
    ).resolves.toBeUndefined()
    expect(
      notificationMocks.showDownloadCompleteNotification
    ).toHaveBeenCalledOnce()
    expect(notificationMocks.notifyTaskFailed).not.toHaveBeenCalled()
  })

  it.each(["completed", "failed"] as const)(
    "routes a %s task to its terminal notification",
    async (finalStatus) => {
      const task: DownloadTaskState = {
        id: "task-terminal-notification",
        siteIntegrationId: "mangadex",
        mangaId: "series-1",
        seriesTitle: "Series 1",
        chapters: [
          {
            requestedPath: "Tako/Chapter.cbz",
            id: "chapter-1",
            title: "Chapter 1",
            url: "https://example.com/chapter-1",
            index: 0,
            status: finalStatus,
            lastUpdated: 1,
          },
        ],
        status: finalStatus,
        errorMessage:
          finalStatus === "failed" ? "Download interrupted" : undefined,
        created: 1,
        settingsSnapshot: createTaskSettingsSnapshot(
          DEFAULT_SETTINGS,
          "mangadex"
        ),
      }
      const queueRepository = {
        getTask: vi.fn(async () => task),
      } as unknown as QueueRepository

      await notifyDownloadTaskCompletion({
        stateManager: queueRepository,
        taskId: task.id,
        finalStatus,
        completedCount: finalStatus === "completed" ? 1 : 0,
        totalChapters: 1,
        settingsRepository: finalizationDependencies.settingsRepository,
      })

      if (finalStatus === "completed") {
        expect(
          notificationMocks.showDownloadCompleteNotification
        ).toHaveBeenCalledExactlyOnceWith({
          task,
          notificationsEnabled: true,
          chaptersCompleted: 1,
          chaptersTotal: 1,
        })
        expect(notificationMocks.notifyTaskFailed).not.toHaveBeenCalled()
      } else {
        expect(
          notificationMocks.notifyTaskFailed
        ).toHaveBeenCalledExactlyOnceWith({
          task,
          notificationsEnabled: true,
          errorMessage: "Download interrupted",
        })
        expect(
          notificationMocks.showDownloadCompleteNotification
        ).not.toHaveBeenCalled()
      }
    }
  )
})
