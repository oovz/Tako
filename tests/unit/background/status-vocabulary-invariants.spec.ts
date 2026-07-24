import { describe, expect, it, vi } from "vitest"

import {
  clearAllHistory,
  restartTask,
  retryFailedChapters,
} from "@/entrypoints/background/download-queue"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import type {
  DownloadTaskState,
  GlobalAppState,
  TaskChapter,
} from "@/src/types/queue-state"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"

const CANONICAL_TASK_STATUSES: Array<DownloadTaskState["status"]> = [
  "queued",
  "downloading",
  "completed",
  "partial_success",
  "failed",
  "canceled",
]

function makeChapter(overrides: Partial<TaskChapter> = {}): TaskChapter {
  return {
    id: overrides.id ?? "chapter-1",
    url: overrides.url ?? "https://example.com/chapter-1",
    title: overrides.title ?? "Chapter 1",
    index: overrides.index ?? 1,
    status: overrides.status ?? "queued",
    errorMessage: overrides.errorMessage,
    lastUpdated: overrides.lastUpdated ?? Date.now(),
  }
}

function makeTask(
  overrides: Partial<DownloadTaskState> & {
    id: string
    status: DownloadTaskState["status"]
  }
): DownloadTaskState {
  const siteIntegrationId = overrides.siteIntegrationId ?? "test-site"
  return {
    id: overrides.id,
    siteIntegrationId,
    mangaId: overrides.mangaId ?? "series-1",
    seriesTitle: overrides.seriesTitle ?? "Series 1",
    chapters: overrides.chapters ?? [makeChapter()],
    status: overrides.status,
    created: overrides.created ?? Date.now() - 1000,
    started: overrides.started,
    completed: overrides.completed,
    errorMessage: overrides.errorMessage,
    isRetried: overrides.isRetried,
    isRetryTask: overrides.isRetryTask,
    settingsSnapshot:
      overrides.settingsSnapshot ??
      createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
  }
}

function createMockStateManager(
  downloadQueue: DownloadTaskState[]
): CentralizedStateManager {
  const globalState: GlobalAppState = {
    downloadQueue,
    settings: DEFAULT_SETTINGS,
    lastActivity: Date.now(),
  }

  return {
    getGlobalState: vi.fn().mockResolvedValue(globalState),
    updateDownloadQueueAtomically: vi.fn(
      async (
        update: (queue: readonly DownloadTaskState[]) => {
          queue: DownloadTaskState[]
          result: unknown
        }
      ) => {
        const outcome = update(globalState.downloadQueue)
        globalState.downloadQueue = outcome.queue
        return outcome.result
      }
    ),
  } as unknown as CentralizedStateManager
}

describe("status vocabulary invariants", () => {
  it("retry/restart create new tasks using canonical queued status only", async () => {
    const retrySource = makeTask({
      id: "partial-task",
      status: "partial_success",
      chapters: [
        makeChapter({ id: "ch-1", status: "completed" }),
        makeChapter({ id: "ch-2", status: "failed", errorMessage: "failed" }),
      ],
    })

    const restartSource = makeTask({
      id: "canceled-task",
      status: "canceled",
      chapters: [
        makeChapter({ id: "ch-a", status: "queued" }),
        makeChapter({ id: "ch-b", status: "downloading" }),
      ],
    })

    const stateManager = createMockStateManager([retrySource, restartSource])

    const retryResult = await retryFailedChapters(stateManager, retrySource.id)
    const restartResult = await restartTask(stateManager, restartSource.id)

    expect(retryResult.success).toBe(true)
    expect(restartResult.success).toBe(true)

    const createdTasks = (
      await stateManager.getGlobalState()
    ).downloadQueue.filter((task) => task.isRetryTask)
    expect(createdTasks).toHaveLength(2)

    for (const task of createdTasks) {
      expect(task.status).toBe("queued")
      expect(CANONICAL_TASK_STATUSES).toContain(task.status)
      expect(task.settingsSnapshot).toEqual(
        expect.objectContaining({
          archiveFormat: DEFAULT_SETTINGS.downloads.defaultFormat,
          siteIntegrationId: task.siteIntegrationId,
        })
      )
      expect(
        task.chapters.every((chapter) => chapter.status === "queued")
      ).toBe(true)
      expect(
        task.chapters.every(
          (chapter) => chapter.status !== ("pending" as never)
        )
      ).toBe(true)
      expect(
        task.chapters.every(
          (chapter) => chapter.status !== ("waiting" as never)
        )
      ).toBe(true)
    }
  })

  it("clearAllHistory keeps only queued/downloading and removes terminal/non-canonical entries", async () => {
    const queue = [
      makeTask({ id: "queued-task", status: "queued" }),
      makeTask({ id: "downloading-task", status: "downloading" }),
      makeTask({
        id: "completed-task",
        status: "completed",
        completed: Date.now(),
      }),
      makeTask({ id: "failed-task", status: "failed", completed: Date.now() }),
      makeTask({
        id: "pending-legacy",
        status: "queued" as DownloadTaskState["status"],
      }),
    ]

    // Simulate corrupted legacy entry with non-canonical status in persisted state.
    ;(queue[4] as unknown as { status: string }).status = "waiting"

    const stateManager = createMockStateManager(queue)

    const result = await clearAllHistory(stateManager)
    expect(result.success).toBe(true)
    expect(result.removedCount).toBe(3)

    const updatedQueue = (await stateManager.getGlobalState()).downloadQueue
    expect(updatedQueue.map((task) => task.id)).toEqual([
      "queued-task",
      "downloading-task",
    ])
    expect(
      updatedQueue.every((task) =>
        CANONICAL_TASK_STATUSES.includes(task.status)
      )
    ).toBe(true)
  })
})
