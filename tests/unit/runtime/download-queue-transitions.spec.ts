import { describe, expect, it } from "vitest"

import {
  beginChapterDispatchInQueue,
  cancelDownloadingTask,
  transitionDownloadTaskInQueue,
  updateTaskChapterInQueue,
} from "@/src/runtime/download-queue-transitions"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
} from "@/src/types/queue-state"

function createTask(
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  const now = 100
  return {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [
      {
        id: "chapter-1",
        url: "https://mangadex.org/chapter/chapter-1",
        title: "Chapter 1",
        index: 1,
        status: "queued",
        lastUpdated: now,
      },
    ],
    status: "queued",
    created: now,
    settingsSnapshot: {} as DownloadTaskState["settingsSnapshot"],
    ...overrides,
  }
}

function createLease(): ActiveDispatchLease {
  return {
    jobId: "job-1",
    attempt: 2,
    taskId: "task-1",
    chapterId: "chapter-1",
    stage: "dispatching",
    startedAt: 100,
    lastActivityAt: 100,
    leaseExpiresAt: 10_000,
    sequence: 1,
  }
}

describe("download queue transition kernel", () => {
  it("starts a dispatch without mutating the source queue", () => {
    const task = createTask({
      status: "downloading",
      chapters: [
        {
          id: "chapter-1",
          url: "https://mangadex.org/chapter/chapter-1",
          title: "Chapter 1",
          index: 1,
          status: "queued",
          errorMessage: "old retry error",
          errorCategory: "network_unavailable",
          outputs: { requested: 3, committed: 1, failed: 2 },
          lastUpdated: 100,
        },
      ],
    })
    const queue = [task]

    const transition = beginChapterDispatchInQueue({
      queue,
      taskId: "task-1",
      chapterId: "chapter-1",
      lease: createLease(),
      now: 500,
    })

    expect(transition.result).toEqual({ success: true, updated: true })
    expect(transition.queue).not.toBe(queue)
    expect(transition.queue[0]?.chapters[0]).toMatchObject({
      status: "downloading",
      dispatchAttempt: 2,
      outputs: { requested: 0, committed: 0, failed: 0 },
      errorMessage: undefined,
      // Preserve the historical transition semantics until a separate error
      // lifecycle migration explicitly clears categories at dispatch start.
      errorCategory: "network_unavailable",
      lastUpdated: 500,
    })
    expect(task.chapters[0]?.status).toBe("queued")
  })

  it("rejects a second active task transition", () => {
    const queue = [
      createTask({ id: "task-1", status: "downloading" }),
      createTask({ id: "task-2", status: "queued" }),
    ]

    const transition = transitionDownloadTaskInQueue(
      queue,
      "task-2",
      ["queued"],
      { status: "downloading", started: 500 }
    )

    expect(transition.result).toEqual({
      success: false,
      reason: "active-task-exists",
    })
    expect(transition.queue).toEqual(queue)
  })

  it("does not resurrect a terminal chapter from stale progress", () => {
    const task = createTask({
      status: "downloading",
      chapters: [
        {
          id: "chapter-1",
          url: "https://mangadex.org/chapter/chapter-1",
          title: "Chapter 1",
          index: 1,
          status: "completed",
          lastUpdated: 100,
        },
      ],
    })

    const transition = updateTaskChapterInQueue({
      queue: [task],
      taskId: "task-1",
      chapterId: "chapter-1",
      status: "downloading",
      now: 500,
      requireDownloadingTask: true,
    })

    expect(transition.result).toEqual({ success: true, updated: false })
    expect(transition.queue[0]?.chapters[0]?.status).toBe("completed")
  })

  it("maps active and queued chapters to cancellation outcomes", () => {
    const task = createTask({
      status: "downloading",
      activeBlock: "destination_action_required",
      browserDownloadWait: {
        downloadIds: [42],
        since: 100,
      },
      chapters: [
        {
          id: "chapter-1",
          url: "https://mangadex.org/chapter/chapter-1",
          title: "Chapter 1",
          index: 1,
          status: "downloading",
          lastUpdated: 100,
        },
        {
          id: "chapter-2",
          url: "https://mangadex.org/chapter/chapter-2",
          title: "Chapter 2",
          index: 2,
          status: "queued",
          lastUpdated: 100,
        },
      ],
    })

    const canceled = cancelDownloadingTask(task, 500)

    expect(canceled.status).toBe("canceled")
    expect(canceled.completed).toBe(500)
    expect(canceled.activeBlock).toBeUndefined()
    expect(canceled.browserDownloadWait).toBeUndefined()
    expect(canceled.chapters.map((chapter) => chapter.status)).toEqual([
      "canceled",
      "skipped",
    ])
    expect(task.status).toBe("downloading")
  })
})
