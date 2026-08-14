import type { DownloadTaskState } from "@/src/domain/queue/state"
import { describe, expect, it, vi } from "vitest"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import {
  configureDownloadQueueTestLifecycle,
  createChapter,
  makeTask,
  mockEnsureOffscreenReady,
  mockGlobalState,
  mockRuntimeSendMessage,
  mockQueueRepository,
  processDownloadQueue,
} from "./download-queue-test-setup"

export function registerDownloadQueueBehaviorCases(): void {
  describe("queue drain lifecycle", () => {
    it("runs the drain handler when no queued or active task remains", async () => {
      const onQueueDrained = vi.fn(async () => undefined)
      configureDownloadQueueTestLifecycle({
        onQueueDrained,
      })
      try {
        mockGlobalState.downloadQueue = []
        await processDownloadQueue(
          mockQueueRepository,
          mockEnsureOffscreenReady
        )
        expect(onQueueDrained).toHaveBeenCalledTimes(1)
      } finally {
        configureDownloadQueueTestLifecycle({
          onQueueDrained: null,
        })
      }
    })

    it("does not run the drain handler while an active task remains", async () => {
      const onQueueDrained = vi.fn(async () => undefined)
      configureDownloadQueueTestLifecycle({
        onQueueDrained,
      })
      try {
        mockGlobalState.downloadQueue = [
          makeTask({ id: "active-task", status: "downloading" }),
        ]
        await processDownloadQueue(
          mockQueueRepository,
          mockEnsureOffscreenReady
        )
        expect(onQueueDrained).not.toHaveBeenCalled()
      } finally {
        configureDownloadQueueTestLifecycle({
          onQueueDrained: null,
        })
      }
    })
  })

  describe("unlimited queue behavior", () => {
    it("accepts unlimited tasks without capacity enforcement", async () => {
      const tasks: DownloadTaskState[] = Array.from({ length: 50 }, (_, i) =>
        makeTask({
          id: `task-${i}`,
          mangaId: `series-${i}`,
          seriesTitle: `Test Manga ${i}`,
          chapters: [
            createChapter({
              url: `https://example.com/ch${i}`,
              title: `Chapter ${i}`,
              chapterNumber: i,
            }),
          ],
          status: "queued" as const,
          created: Date.now() + i,
        })
      )

      mockGlobalState.downloadQueue = tasks

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-0" })
      )
    })

    it("does not block new tasks based on queue size", async () => {
      const tasks: DownloadTaskState[] = Array.from({ length: 100 }, (_, i) =>
        makeTask({
          id: `task-${i}`,
          mangaId: `series-${i}`,
          seriesTitle: `Test Manga ${i}`,
          chapters: [
            createChapter({
              url: `https://example.com/ch${i}`,
              title: `Chapter ${i}`,
              chapterNumber: i,
            }),
          ],
          status: "queued" as const,
          created: Date.now() + i,
        })
      )

      mockGlobalState.downloadQueue = tasks

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-0" })
      )

      const failedCalls = vi
        .mocked(mockQueueRepository.interruptDownloadTask)
        .mock.calls.filter((call) => call[0].errorMessage.length > 0)
      expect(failedCalls).toHaveLength(0)
    })
  })

  describe("FIFO queue processing", () => {
    it("processes tasks in creation order (FIFO)", async () => {
      const now = Date.now()
      const tasks: DownloadTaskState[] = [
        makeTask({
          id: "task-old",
          mangaId: "series-1",
          seriesTitle: "Old Task",
          created: now - 10000,
        }),
        makeTask({
          id: "task-new",
          mangaId: "series-2",
          seriesTitle: "New Task",
          chapters: [
            createChapter({
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
            }),
          ],
          created: now,
        }),
      ]

      mockGlobalState.downloadQueue = tasks
      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-old" })
      )
      expect(mockQueueRepository.startDownloadTask).not.toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-new" })
      )
    })

    it("maintains queue order when first task completes", async () => {
      const now = Date.now()
      const tasks: DownloadTaskState[] = [
        makeTask({
          id: "task-1",
          mangaId: "series-1",
          seriesTitle: "First Task",
          status: "completed",
          created: now - 20000,
          completed: now - 1000,
        }),
        makeTask({
          id: "task-2",
          mangaId: "series-2",
          seriesTitle: "Second Task",
          chapters: [
            createChapter({
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
            }),
          ],
          created: now - 15000,
        }),
        makeTask({
          id: "task-3",
          mangaId: "series-3",
          seriesTitle: "Third Task",
          chapters: [
            createChapter({
              url: "https://example.com/ch3",
              title: "Chapter 3",
              chapterNumber: 3,
            }),
          ],
          created: now - 10000,
        }),
      ]

      mockGlobalState.downloadQueue = tasks

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-2" })
      )
    })
  })

  describe("single active task behavior", () => {
    it("allows only one downloading task at a time globally", async () => {
      const tasks: DownloadTaskState[] = [
        makeTask({
          id: "active-task",
          mangaId: "series-1",
          seriesTitle: "Active Download",
          status: "downloading",
          created: Date.now() - 5000,
        }),
        makeTask({
          id: "waiting-task",
          mangaId: "series-2",
          seriesTitle: "Waiting Download",
          chapters: [
            createChapter({
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
            }),
          ],
          created: Date.now(),
        }),
      ]

      mockGlobalState.downloadQueue = tasks
      await mockQueueRepository.beginChapterDispatch({
        taskId: "active-task",
        chapterId: tasks[0]!.chapters[0]!.id,
        expectedPreviousLease: null,
        lease: createDispatchLease({
          jobId: "active-job",
          attempt: 1,
          taskId: "active-task",
          chapterId: tasks[0]!.chapters[0]!.id,
          fingerprint: "a".repeat(64),
          saveMode: "downloads-api",
          now: Date.now(),
        }),
        now: Date.now(),
      })

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).not.toHaveBeenCalled()
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
    })

    it("starts next task after current task completes", async () => {
      const completedTask = makeTask({
        id: "completed-task",
        mangaId: "series-1",
        seriesTitle: "Completed Download",
        status: "completed",
        created: Date.now() - 10000,
        completed: Date.now() - 1000,
      })

      const nextTask = makeTask({
        id: "next-task",
        mangaId: "series-2",
        seriesTitle: "Next Download",
        chapters: [
          createChapter({
            url: "https://example.com/ch2",
            title: "Chapter 2",
            chapterNumber: 2,
          }),
        ],
        created: Date.now() - 5000,
      })

      mockGlobalState.downloadQueue = [completedTask, nextTask]

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "next-task" })
      )
    })

    it("allows multiple tasks from same series in queue", async () => {
      const tasks: DownloadTaskState[] = [
        makeTask({
          id: "task-1",
          mangaId: "same-series",
          seriesTitle: "Same Manga Part 1",
          created: Date.now() - 5000,
        }),
        makeTask({
          id: "task-2",
          mangaId: "same-series",
          seriesTitle: "Same Manga Part 2",
          chapters: [
            createChapter({
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
            }),
          ],
          created: Date.now(),
        }),
      ]

      mockGlobalState.downloadQueue = tasks

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1" })
      )
    })

    it("allows multiple queued tasks from same tab in queue", async () => {
      const tasks: DownloadTaskState[] = [
        makeTask({
          id: "task-1",
          mangaId: "series-1",
          created: Date.now() - 5000,
        }),
        makeTask({ id: "task-2", mangaId: "series-1", created: Date.now() }),
        makeTask({
          id: "task-3",
          mangaId: "series-1",
          chapters: [
            createChapter({
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
            }),
          ],
          created: Date.now() + 1000,
        }),
      ]

      mockGlobalState.downloadQueue = tasks

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1" })
      )
      expect(mockGlobalState.downloadQueue).toHaveLength(3)
    })
  })

  describe("queue status vocabulary excludes waiting/cooldown", () => {
    it("does not use waiting/cooldown fields when starting the single queued task", async () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)

      const task = makeTask({
        id: "rate-limited-task",
        seriesTitle: "Rate Limited",
        created: now - 1000,
      })

      mockGlobalState.downloadQueue = [task]

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "rate-limited-task" })
      )

      const committedTask = mockGlobalState.downloadQueue.find(
        (candidate) => candidate.id === task.id
      )
      expect(committedTask?.status).not.toBe("waiting")
      expect(committedTask).not.toHaveProperty("cooldownUntil")

      vi.useRealTimers()
    })

    it("processes queued tasks without requiring cooldown bookkeeping", async () => {
      const queuedTask = makeTask({
        id: "queued-task",
        seriesTitle: "Queued Task",
        created: Date.now() - 10000,
      })

      mockGlobalState.downloadQueue = [queuedTask]

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "queued-task" })
      )
    })
  })
}
