import { describe, expect, it } from "vitest"

import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState, TaskChapter } from "@/src/domain/queue/state"
import { createQueueRepositoryTestHarness } from "./queue-repository-test-harness"

function makeChapter(overrides: Partial<TaskChapter> = {}): TaskChapter {
  return {
    requestedPath: "Tako/Chapter.cbz",
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

describe("queue task lifecycle", () => {
  it("queues new retry and restart tasks", async () => {
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

    const queueRepository = createQueueRepositoryTestHarness([
      retrySource,
      restartSource,
    ])

    const retryResult = await queueRepository.retryFailedChapters({
      taskId: retrySource.id,
      retryTaskId: "retry-task",
      now: Date.now(),
    })
    const restartResult = await queueRepository.restartDownloadTask({
      taskId: restartSource.id,
      restartTaskId: "restart-task",
      now: Date.now(),
    })

    expect(retryResult.outcome).toBe("applied")
    expect(restartResult.outcome).toBe("applied")

    const createdTasks = (await queueRepository.getQueue()).filter(
      (task) => task.isRetryTask
    )
    expect(createdTasks).toHaveLength(2)

    for (const task of createdTasks) {
      expect(task.status).toBe("queued")
      expect(task.settingsSnapshot).toEqual(
        expect.objectContaining({
          archiveFormat: DEFAULT_SETTINGS.downloads.defaultFormat,
          siteIntegrationId: task.siteIntegrationId,
        })
      )
      expect(
        task.chapters.every((chapter) => chapter.status === "queued")
      ).toBe(true)
    }
  })

  it("clearing task history preserves queued and active tasks", async () => {
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
        id: "partial-task",
        status: "partial_success",
        completed: Date.now(),
      }),
      makeTask({
        id: "canceled-task",
        status: "canceled",
        completed: Date.now(),
      }),
    ]

    const queueRepository = createQueueRepositoryTestHarness(queue)

    const result = await queueRepository.clearTerminalHistory()
    expect(result.outcome).toBe("applied")
    expect(result.removedTaskIds).toHaveLength(4)

    const updatedQueue = await queueRepository.getQueue()
    expect(updatedQueue.map((task) => task.id)).toEqual([
      "queued-task",
      "downloading-task",
    ])
  })
})
