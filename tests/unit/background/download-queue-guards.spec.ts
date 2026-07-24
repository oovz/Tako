/**
 * Adversarial Tests: Download Queue Guards
 *
 * Covers:
 *  - Guard 1: MAX_CONCURRENT_QUEUED_TASKS (queue overload protection)
 *    Source: entrypoints/background/download-queue-runner.ts:24 (value: 1)
 *    Enforcement: entrypoints/background/download-queue-runner.ts:388
 *  - Guard 4: Chapter delay enforcement
 *    Source: entrypoints/background/download-queue-runner.ts:117
 *    Enforcement: entrypoints/background/download-queue-runner.ts:311
 */
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { destinationService } from "@/entrypoints/background/destination"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createChapter,
  makeTask,
  mockEnsureOffscreenReady,
  mockGlobalState,
  mockRuntimeSendMessage,
  mockStateManager,
  processDownloadQueue,
  resetDownloadQueueTestEnvironment,
  startDownloadTask,
  testSettings,
} from "./download-queue-test-setup"

const enablementMocks = vi.hoisted(() => ({
  getAll: vi.fn(async () => ({}) as Record<string, boolean>),
}))

// In Vitest 4, vi.mock must be in the test file itself to intercept imports
// pulled in via the setup module's re-exports.
vi.mock("@/entrypoints/background/queue-helpers", () => ({
  resolveDownloadPlan: vi.fn().mockResolvedValue({
    format: "cbz",
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
vi.mock("@/entrypoints/background/destination", () => ({
  destinationService: {
    getEffectiveDestination: vi.fn(async () => ({ kind: "downloads" })),
    preflight: vi.fn(async () => ({ ready: true })),
  },
  clearDestinationIssuesForTask: vi.fn(),
  recordDestinationIssue: vi.fn(),
  recordDestinationRuntimeIssue: vi.fn(),
}))
vi.mock("@/src/storage/site-integration-enablement-service", () => ({
  siteIntegrationEnablementService: {
    getAll: enablementMocks.getAll,
  },
}))

describe("Download Queue Guards", () => {
  beforeEach(async () => {
    await resetDownloadQueueTestEnvironment()
    enablementMocks.getAll.mockResolvedValue({})
  })

  describe("MAX_CONCURRENT_QUEUED_TASKS (queue overload protection)", () => {
    it("does not dispatch when the queued-to-downloading transition loses a cancellation race", async () => {
      const queuedTask = makeTask({
        id: "canceled-before-start",
        status: "queued",
      })
      mockGlobalState.downloadQueue = [queuedTask]
      vi.mocked(mockStateManager.transitionDownloadTask).mockResolvedValueOnce({
        success: false,
        reason: "invalid-status",
        currentStatus: "canceled",
      })

      await startDownloadTask(
        mockStateManager,
        queuedTask.id,
        mockEnsureOffscreenReady
      )

      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
    })

    it("fails a disabled queued task before offscreen execution", async () => {
      const queuedTask = makeTask({
        id: "disabled-before-start",
        siteIntegrationId: "mangadex",
        status: "queued",
      })
      mockGlobalState.downloadQueue = [queuedTask]
      enablementMocks.getAll.mockResolvedValue({ mangadex: false })

      await startDownloadTask(
        mockStateManager,
        queuedTask.id,
        mockEnsureOffscreenReady
      )

      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({
          status: "failed",
          errorMessage: "Integration disabled",
          completed: expect.any(Number),
        })
      )
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
    })

    it("fails a disabled task resumed from a prior downloading state and releases the queue slot", async () => {
      const resumedTask = makeTask({
        id: "disabled-while-restarting",
        siteIntegrationId: "mangadex",
        status: "downloading",
        started: Date.now() - 5_000,
      })
      mockGlobalState.downloadQueue = [resumedTask]
      enablementMocks.getAll.mockResolvedValue({ mangadex: false })

      await startDownloadTask(
        mockStateManager,
        resumedTask.id,
        mockEnsureOffscreenReady,
        true
      )

      expect(mockStateManager.transitionDownloadTask).toHaveBeenCalledWith(
        resumedTask.id,
        ["queued", "downloading"],
        expect.objectContaining({
          status: "failed",
          errorMessage: "Integration disabled",
        })
      )
      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({ status: "failed" })
      )
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
    })

    it("fails a disabled FSA task before a destination block can retain its queue slot", async () => {
      const resumedTask = makeTask({
        id: "disabled-with-fsa-block",
        siteIntegrationId: "mangadex",
        status: "downloading",
        started: Date.now() - 5_000,
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(testSettings, "mangadex"),
          destination: "file-system-access",
        },
      })
      mockGlobalState.downloadQueue = [resumedTask]
      enablementMocks.getAll.mockResolvedValue({ mangadex: false })
      vi.mocked(destinationService.preflight).mockResolvedValue({
        ready: false,
        reason: "permission_prompt",
      })

      await startDownloadTask(
        mockStateManager,
        resumedTask.id,
        mockEnsureOffscreenReady,
        true
      )

      expect(destinationService.preflight).not.toHaveBeenCalled()
      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({
          status: "failed",
          errorMessage: "Integration disabled",
        })
      )
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
    })

    it("blocks starting a second task while one is already downloading", async () => {
      const activeTask = makeTask({
        id: "active-task",
        status: "downloading",
        started: Date.now() - 1000,
      })
      const queuedTask = makeTask({
        id: "queued-task",
        chapters: [
          createChapter({
            url: "https://example.com/ch2",
            title: "Chapter 2",
            chapterNumber: 2,
          }),
        ],
      })

      mockGlobalState.downloadQueue = [activeTask, queuedTask]

      await processDownloadQueue(mockStateManager, mockEnsureOffscreenReady)

      // The already-downloading task must not be re-started, and the queued
      // task must not be started while a download is in flight.
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalledWith(
        "queued-task",
        expect.objectContaining({ status: "downloading" })
      )
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
    })

    it("starts the second queued task only after the first completes", async () => {
      const completedTask = makeTask({
        id: "first-task",
        status: "completed",
        completed: Date.now() - 500,
      })
      const queuedTask = makeTask({
        id: "second-task",
        chapters: [
          createChapter({
            url: "https://example.com/ch2",
            title: "Chapter 2",
            chapterNumber: 2,
          }),
        ],
      })

      mockGlobalState.downloadQueue = [completedTask, queuedTask]

      await processDownloadQueue(mockStateManager, mockEnsureOffscreenReady)

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "second-task",
        expect.objectContaining({ status: "downloading" })
      )
    })

    it("enforces a single concurrent task even when many are queued", async () => {
      const tasks = Array.from({ length: 25 }, (_, index) =>
        makeTask({
          id: `task-${index}`,
          mangaId: `series-${index}`,
          seriesTitle: `Series ${index}`,
          chapters: [
            createChapter({
              url: `https://example.com/ch${index}`,
              title: `Chapter ${index}`,
              chapterNumber: index,
            }),
          ],
          status: "queued" as const,
          created: Date.now() + index,
        })
      )

      mockGlobalState.downloadQueue = tasks

      await processDownloadQueue(mockStateManager, mockEnsureOffscreenReady)

      const downloadingCalls = vi
        .mocked(mockStateManager.updateDownloadTask)
        .mock.calls.filter(
          (call) => (call[1] as { status?: string }).status === "downloading"
        )

      // Only one task may transition to downloading in a single processing pass.
      expect(downloadingCalls).toHaveLength(1)
      expect(downloadingCalls[0]?.[0]).toBe("task-0")
    })

    it("does not start any task when the active slot is occupied by a downloading task", async () => {
      mockGlobalState.downloadQueue = [
        makeTask({ id: "running", status: "downloading", started: Date.now() }),
        makeTask({ id: "waiting-1" }),
        makeTask({ id: "waiting-2" }),
      ]

      await processDownloadQueue(mockStateManager, mockEnsureOffscreenReady)

      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalled()
    })

    it("treats the concurrent limit as a hard ceiling: 0 active starts exactly 1, 1 active starts 0", async () => {
      // 0 active -> exactly 1 started
      mockGlobalState.downloadQueue = [
        makeTask({ id: "task-a" }),
        makeTask({
          id: "task-b",
          chapters: [
            createChapter({
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
            }),
          ],
        }),
      ]

      await processDownloadQueue(mockStateManager, mockEnsureOffscreenReady)

      const downloadingAfterFirst = vi
        .mocked(mockStateManager.updateDownloadTask)
        .mock.calls.filter(
          (call) => (call[1] as { status?: string }).status === "downloading"
        )
      expect(downloadingAfterFirst).toHaveLength(1)
      expect(downloadingAfterFirst[0]?.[0]).toBe("task-a")
    })
  })

  describe("Chapter delay enforcement", () => {
    it("persists chapterDelayMs as not-before deadlines for offscreen dispatch", async () => {
      vi.useFakeTimers()
      try {
        const { resolveDownloadPlan } =
          await import("@/entrypoints/background/queue-helpers")
        vi.mocked(resolveDownloadPlan).mockResolvedValue({
          format: "cbz",
          book: {
            siteId: "test-site",
            seriesId: "series-1",
            seriesTitle: "Delay Series",
            comicInfoBase: { Series: "Delay Series" },
          },
          chapters: [
            {
              id: "ch1",
              url: "https://example.com/ch1",
              title: "Chapter 1",
              chapterNumber: 1,
              resolvedPath: "Chapter 1.cbz",
              comicInfo: {},
            },
            {
              id: "ch2",
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
              resolvedPath: "Chapter 2.cbz",
              comicInfo: {},
            },
            {
              id: "ch3",
              url: "https://example.com/ch3",
              title: "Chapter 3",
              chapterNumber: 3,
              resolvedPath: "Chapter 3.cbz",
              comicInfo: {},
            },
          ],
        })

        const dispatchDeadlines: Array<number | undefined> = []
        mockRuntimeSendMessage.mockImplementation(
          async (message: {
            type?: string
            payload?: { notBefore?: number }
          }) => {
            if (message?.type === "OFFSCREEN_DOWNLOAD_CHAPTER") {
              dispatchDeadlines.push(message.payload?.notBefore)
            }
            return { success: true, status: "completed" }
          }
        )

        const task = makeTask({
          id: "task-delay",
          chapters: [
            createChapter({
              id: "ch1",
              url: "https://example.com/ch1",
              title: "Chapter 1",
              chapterNumber: 1,
            }),
            createChapter({
              id: "ch2",
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
            }),
            createChapter({
              id: "ch3",
              url: "https://example.com/ch3",
              title: "Chapter 3",
              chapterNumber: 3,
            }),
          ],
          settingsSnapshot: {
            ...createTaskSettingsSnapshot(testSettings, "test-site"),
            rateLimitSettings: {
              image: { concurrency: 2, delayMs: 0 },
              chapter: { concurrency: 1, delayMs: 1000 },
            },
          },
        })

        mockGlobalState.downloadQueue = [task]

        const taskPromise = startDownloadTask(
          mockStateManager,
          "task-delay",
          mockEnsureOffscreenReady
        )
        await vi.runAllTicks()
        await taskPromise

        expect(dispatchDeadlines).toHaveLength(3)
        expect(dispatchDeadlines[0]).toBeUndefined()
        expect(dispatchDeadlines[1]).toEqual(expect.any(Number))
        expect(dispatchDeadlines[2]).toEqual(expect.any(Number))
        expect(dispatchDeadlines[1]).toBeGreaterThanOrEqual(Date.now() + 1000)
        expect(dispatchDeadlines[2]).toBeGreaterThanOrEqual(Date.now() + 1000)
      } finally {
        vi.useRealTimers()
      }
    })

    it("does not delay between chapters when chapterDelayMs is 0", async () => {
      vi.useFakeTimers()
      try {
        const { resolveDownloadPlan } =
          await import("@/entrypoints/background/queue-helpers")
        vi.mocked(resolveDownloadPlan).mockResolvedValue({
          format: "cbz",
          book: {
            siteId: "test-site",
            seriesId: "series-1",
            seriesTitle: "No Delay Series",
            comicInfoBase: { Series: "No Delay Series" },
          },
          chapters: [
            {
              id: "ch1",
              url: "https://example.com/ch1",
              title: "Chapter 1",
              chapterNumber: 1,
              resolvedPath: "Chapter 1.cbz",
              comicInfo: {},
            },
            {
              id: "ch2",
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
              resolvedPath: "Chapter 2.cbz",
              comicInfo: {},
            },
          ],
        })

        const dispatchTimes: number[] = []
        mockRuntimeSendMessage.mockImplementation(
          async (message: { type?: string }) => {
            if (message?.type === "OFFSCREEN_DOWNLOAD_CHAPTER") {
              dispatchTimes.push(Date.now())
            }
            return { success: true, status: "completed" }
          }
        )

        const task = makeTask({
          id: "task-no-delay",
          chapters: [
            createChapter({
              id: "ch1",
              url: "https://example.com/ch1",
              title: "Chapter 1",
              chapterNumber: 1,
            }),
            createChapter({
              id: "ch2",
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
            }),
          ],
          settingsSnapshot: {
            ...createTaskSettingsSnapshot(testSettings, "test-site"),
            rateLimitSettings: {
              image: { concurrency: 2, delayMs: 0 },
              chapter: { concurrency: 1, delayMs: 0 },
            },
          },
        })

        mockGlobalState.downloadQueue = [task]

        const taskPromise = startDownloadTask(
          mockStateManager,
          "task-no-delay",
          mockEnsureOffscreenReady
        )
        await vi.advanceTimersByTimeAsync(100)
        await taskPromise

        expect(dispatchTimes).toHaveLength(2)
        // No delay: both dispatches happen at the same logical instant.
        expect(dispatchTimes[1]! - dispatchTimes[0]!).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it("clamps negative chapterDelayMs to 0 (no negative delay / immediate dispatch)", async () => {
      vi.useFakeTimers()
      try {
        const { resolveDownloadPlan } =
          await import("@/entrypoints/background/queue-helpers")
        vi.mocked(resolveDownloadPlan).mockResolvedValue({
          format: "cbz",
          book: {
            siteId: "test-site",
            seriesId: "series-1",
            seriesTitle: "Negative Delay Series",
            comicInfoBase: { Series: "Negative Delay Series" },
          },
          chapters: [
            {
              id: "ch1",
              url: "https://example.com/ch1",
              title: "Chapter 1",
              chapterNumber: 1,
              resolvedPath: "Chapter 1.cbz",
              comicInfo: {},
            },
            {
              id: "ch2",
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
              resolvedPath: "Chapter 2.cbz",
              comicInfo: {},
            },
          ],
        })

        const dispatchTimes: number[] = []
        mockRuntimeSendMessage.mockImplementation(
          async (message: { type?: string }) => {
            if (message?.type === "OFFSCREEN_DOWNLOAD_CHAPTER") {
              dispatchTimes.push(Date.now())
            }
            return { success: true, status: "completed" }
          }
        )

        const task = makeTask({
          id: "task-negative-delay",
          chapters: [
            createChapter({
              id: "ch1",
              url: "https://example.com/ch1",
              title: "Chapter 1",
              chapterNumber: 1,
            }),
            createChapter({
              id: "ch2",
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
            }),
          ],
          settingsSnapshot: {
            ...createTaskSettingsSnapshot(testSettings, "test-site"),
            rateLimitSettings: {
              image: { concurrency: 2, delayMs: 0 },
              chapter: { concurrency: 1, delayMs: -500 },
            },
          },
        })

        mockGlobalState.downloadQueue = [task]

        const taskPromise = startDownloadTask(
          mockStateManager,
          "task-negative-delay",
          mockEnsureOffscreenReady
        )
        await vi.advanceTimersByTimeAsync(100)
        await taskPromise

        expect(dispatchTimes).toHaveLength(2)
        // Math.max(0, -500) === 0 -> no delay between dispatches.
        expect(dispatchTimes[1]! - dispatchTimes[0]!).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it("forwards a very large chapterDelayMs without blocking the service worker", async () => {
      vi.useFakeTimers()
      try {
        const { resolveDownloadPlan } =
          await import("@/entrypoints/background/queue-helpers")
        vi.mocked(resolveDownloadPlan).mockResolvedValue({
          format: "cbz",
          book: {
            siteId: "test-site",
            seriesId: "series-1",
            seriesTitle: "Huge Delay Series",
            comicInfoBase: { Series: "Huge Delay Series" },
          },
          chapters: [
            {
              id: "ch1",
              url: "https://example.com/ch1",
              title: "Chapter 1",
              chapterNumber: 1,
              resolvedPath: "Chapter 1.cbz",
              comicInfo: {},
            },
            {
              id: "ch2",
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
              resolvedPath: "Chapter 2.cbz",
              comicInfo: {},
            },
          ],
        })

        const dispatchDeadlines: Array<number | undefined> = []
        mockRuntimeSendMessage.mockImplementation(
          async (message: {
            type?: string
            payload?: { notBefore?: number }
          }) => {
            if (message?.type === "OFFSCREEN_DOWNLOAD_CHAPTER") {
              dispatchDeadlines.push(message.payload?.notBefore)
            }
            return { success: true, status: "completed" }
          }
        )

        const task = makeTask({
          id: "task-huge-delay",
          chapters: [
            createChapter({
              id: "ch1",
              url: "https://example.com/ch1",
              title: "Chapter 1",
              chapterNumber: 1,
            }),
            createChapter({
              id: "ch2",
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
            }),
          ],
          settingsSnapshot: {
            ...createTaskSettingsSnapshot(testSettings, "test-site"),
            rateLimitSettings: {
              image: { concurrency: 2, delayMs: 0 },
              chapter: { concurrency: 1, delayMs: 60_000 },
            },
          },
        })

        mockGlobalState.downloadQueue = [task]

        const taskPromise = startDownloadTask(
          mockStateManager,
          "task-huge-delay",
          mockEnsureOffscreenReady
        )
        await vi.runAllTicks()
        await taskPromise

        expect(dispatchDeadlines).toHaveLength(2)
        expect(dispatchDeadlines[0]).toBeUndefined()
        expect(dispatchDeadlines[1]).toBeGreaterThanOrEqual(Date.now() + 60_000)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
