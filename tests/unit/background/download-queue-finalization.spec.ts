import { describe, expect, it, vi } from "vitest"

import {
  finalizeDownloadTaskAfterDispatch,
  notifyDownloadTaskCompletion,
} from "@/entrypoints/background/download-queue-finalization"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { DownloadTaskState } from "@/src/types/queue-state"

const notificationMocks = vi.hoisted(() => ({
  showDownloadCompleteNotification: vi.fn(),
  notifyTaskFailed: vi.fn(),
}))

vi.mock("@/src/storage/chapter-persistence-service", () => ({
  chapterPersistenceService: {
    markChapterAsDownloaded: vi.fn(async () => undefined),
  },
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
