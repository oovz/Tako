import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { chapterPersistenceService } from "@/src/storage/chapter-persistence-service"
import type { DownloadTaskState } from "@/src/types/queue-state"
import { describe, expect, it, vi } from "vitest"
import {
  destinationService,
  recordDestinationIssue,
  recordDestinationRuntimeIssue,
} from "@/entrypoints/background/destination"
import { resolveDownloadPlan } from "@/entrypoints/background/queue-helpers"
import { configureDownloadQueueLifecycle } from "@/entrypoints/background/download-queue-runner"
import {
  createChapter,
  makeTask,
  mockEnsureOffscreenReady,
  mockGlobalState,
  mockRuntimeSendMessage,
  mockStateManager,
  processDownloadQueue,
  startDownloadTask,
  testSettings,
} from "./download-queue-test-setup"
import { createPendingDownloadsStoreStub } from "./pending-output-test-helpers"

export function registerDownloadQueueStartAndProcessCases(): void {
  describe("startDownloadTask", () => {
    it("should start a valid download task", async () => {
      const task = makeTask({ id: "task-1" })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockStateManager,
        "task-1",
        mockEnsureOffscreenReady
      )

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({
          status: "downloading",
          started: expect.any(Number),
        })
      )
      expect(mockEnsureOffscreenReady).toHaveBeenCalled()
      expect(mockStateManager.beginChapterDispatch).toHaveBeenCalled()
    })

    it("keeps a committed chapter successful when pending-output cleanup fails", async () => {
      const task = makeTask({ id: "task-cleanup-failure" })
      const pendingOutputsStore = createPendingDownloadsStoreStub()
      pendingOutputsStore.waitForJobOutputs.mockResolvedValue({
        requested: 1,
        committed: 1,
        failed: 0,
        completedDownloadIds: [42],
      })
      pendingOutputsStore.releaseJob.mockRejectedValueOnce(
        new Error("transient storage failure")
      )
      configureDownloadQueueLifecycle({
        onQueueDrained: null,
        pendingOutputsStore,
      })
      mockGlobalState.downloadQueue = [task]
      mockRuntimeSendMessage.mockResolvedValue({
        success: true,
        status: "completed",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 0,
      })

      try {
        await startDownloadTask(
          mockStateManager,
          task.id,
          mockEnsureOffscreenReady
        )

        expect(pendingOutputsStore.releaseJob).toHaveBeenCalledTimes(1)
        expect(mockGlobalState.downloadQueue[0]).toEqual(
          expect.objectContaining({ status: "completed" })
        )
        expect(
          mockStateManager.updateDownloadingTaskChapter
        ).toHaveBeenCalledWith(
          task.id,
          task.chapters[0]?.id,
          "completed",
          expect.objectContaining({
            outputs: { requested: 1, committed: 1, failed: 0 },
          })
        )
      } finally {
        configureDownloadQueueLifecycle({
          onQueueDrained: null,
          pendingOutputsStore: createPendingDownloadsStoreStub(),
        })
      }
    })

    it("keeps a committed chapter successful when its first history write fails", async () => {
      const task = makeTask({ id: "task-history-write-retry" })
      vi.mocked(
        chapterPersistenceService.markChapterAsDownloaded
      ).mockRejectedValueOnce(new Error("transient history storage failure"))
      mockGlobalState.downloadQueue = [task]
      mockRuntimeSendMessage.mockResolvedValue({
        success: true,
        status: "completed",
      })

      await startDownloadTask(
        mockStateManager,
        task.id,
        mockEnsureOffscreenReady
      )

      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({ status: "completed" })
      )
      expect(mockGlobalState.downloadQueue[0]?.chapters[0]).toEqual(
        expect.objectContaining({ status: "completed" })
      )
      expect(
        chapterPersistenceService.markChapterAsDownloaded
      ).toHaveBeenCalledTimes(2)
    })

    it("keeps the enqueue-time FSA destination frozen across every chapter", async () => {
      const chapters = [
        createChapter({ id: "ch1", title: "Chapter 1", index: 1 }),
        createChapter({
          id: "ch2",
          url: "https://example.com/ch2",
          title: "Chapter 2",
          index: 2,
        }),
      ]
      const task = makeTask({
        id: "task-destination-refresh",
        chapters,
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(testSettings, "test-site"),
          destination: "file-system-access",
        },
      })
      mockGlobalState.downloadQueue = [task]
      vi.mocked(resolveDownloadPlan).mockResolvedValue({
        format: "cbz",
        book: {
          siteId: "test-site",
          seriesId: "series-1",
          seriesTitle: "Test Manga",
          comicInfoBase: { Series: "Test Manga" },
        },
        chapters: chapters.map((chapter) => ({
          ...chapter,
          resolvedPath: `Test Manga/${chapter.title}.cbz`,
          comicInfo: {},
        })),
      })
      vi.mocked(destinationService.getEffectiveDestination).mockResolvedValue({
        kind: "custom",
        handleId: "root",
        handle: {} as FileSystemDirectoryHandle,
      })
      mockRuntimeSendMessage.mockResolvedValue({
        success: true,
        status: "completed",
      })

      await startDownloadTask(
        mockStateManager,
        task.id,
        mockEnsureOffscreenReady
      )

      const saveModes = mockRuntimeSendMessage.mock.calls
        .filter(([message]) => message.type === "OFFSCREEN_DOWNLOAD_CHAPTER")
        .map(([message]) => message.payload.saveMode)
      expect(saveModes).toEqual(["fsa", "fsa"])
      expect(destinationService.getEffectiveDestination).toHaveBeenCalledTimes(
        2
      )
      for (const [context] of vi.mocked(
        destinationService.getEffectiveDestination
      ).mock.calls) {
        expect(context).toMatchObject({
          taskId: task.id,
          destination: "file-system-access",
        })
      }
    })

    it("leaves the head task queued when its custom folder needs user action", async () => {
      const task = makeTask({
        id: "task-folder-preflight",
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(testSettings, "test-site"),
          destination: "file-system-access",
        },
      })
      mockGlobalState.downloadQueue = [task]
      vi.mocked(destinationService.preflight).mockResolvedValue({
        ready: false,
        reason: "permission_prompt",
      })

      await startDownloadTask(
        mockStateManager,
        task.id,
        mockEnsureOffscreenReady
      )

      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({
          status: "queued",
          activeBlock: "destination_action_required",
        })
      )
      expect(recordDestinationIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.id,
          destination: "file-system-access",
        }),
        { ready: false, reason: "permission_prompt" }
      )
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
      expect(mockStateManager.beginChapterDispatch).not.toHaveBeenCalled()
    })

    it("returns an active FSA chapter to a recoverable queued block after permission loss", async () => {
      const task = makeTask({
        id: "task-folder-runtime",
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(testSettings, "test-site"),
          destination: "file-system-access",
        },
      })
      mockGlobalState.downloadQueue = [task]
      vi.mocked(destinationService.getEffectiveDestination).mockResolvedValue({
        kind: "custom",
        handleId: "root",
        handle: {} as FileSystemDirectoryHandle,
      })
      mockRuntimeSendMessage.mockResolvedValue({
        success: true,
        status: "failed",
        errorCategory: "folder_permission_required",
        errorMessage: "Folder permission is required.",
        imagesFailed: 1,
        outputsRequested: 1,
        outputsCommitted: 0,
        outputsFailedBeforeHandoff: 1,
      })

      await startDownloadTask(
        mockStateManager,
        task.id,
        mockEnsureOffscreenReady
      )

      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({
          status: "queued",
          activeBlock: "destination_action_required",
          errorCategory: "folder_permission_required",
        })
      )
      expect(mockGlobalState.downloadQueue[0]?.chapters[0]).toEqual(
        expect.objectContaining({
          status: "queued",
          outputs: { requested: 1, committed: 0, failed: 1 },
        })
      )
      expect(recordDestinationRuntimeIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.id,
          chapterId: task.chapters[0]?.id,
          destination: "file-system-access",
        }),
        "fsa_permission_required"
      )
    })

    it("maps a generic FSA write category to an actionable destination issue", async () => {
      const task = makeTask({
        id: "task-folder-write",
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(testSettings, "test-site"),
          destination: "file-system-access",
        },
      })
      mockGlobalState.downloadQueue = [task]
      vi.mocked(destinationService.getEffectiveDestination).mockResolvedValue({
        kind: "custom",
        handleId: "root",
        handle: {} as FileSystemDirectoryHandle,
      })
      mockRuntimeSendMessage.mockResolvedValue({
        success: true,
        status: "failed",
        errorCategory: "folder_write_failed",
        errorMessage: "Tako could not write to the selected folder.",
        outputsRequested: 1,
        outputsCommitted: 0,
        outputsFailedBeforeHandoff: 0,
      })

      await startDownloadTask(
        mockStateManager,
        task.id,
        mockEnsureOffscreenReady
      )

      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({
          status: "queued",
          activeBlock: "destination_action_required",
          errorCategory: "folder_write_failed",
        })
      )
      expect(recordDestinationRuntimeIssue).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: task.id }),
        "fsa_write_failed"
      )
    })

    it("should allow multiple tasks from same tab", async () => {
      const existingTask = makeTask({
        id: "task-1",
        status: "completed",
        created: Date.now() - 5000,
        completed: Date.now() - 1000,
      })

      const newTask = makeTask({
        id: "task-2",
        chapters: [
          createChapter({
            url: "https://example.com/ch2",
            title: "Chapter 2",
            chapterNumber: 2,
          }),
        ],
        created: Date.now(),
      })

      mockGlobalState.downloadQueue = [existingTask, newTask]

      await startDownloadTask(
        mockStateManager,
        "task-2",
        mockEnsureOffscreenReady
      )

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "task-2",
        expect.objectContaining({
          status: "downloading",
        })
      )
      expect(mockEnsureOffscreenReady).toHaveBeenCalled()
      expect(mockStateManager.beginChapterDispatch).toHaveBeenCalled()
    })

    it("should start queued task regardless of tab origin", async () => {
      const task = makeTask({ id: "task-1" })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockStateManager,
        "task-1",
        mockEnsureOffscreenReady
      )

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({
          status: "downloading",
        })
      )

      expect(mockEnsureOffscreenReady).toHaveBeenCalled()
      expect(mockStateManager.updateDownloadingTaskChapter).toHaveBeenCalled()
    })

    it("should handle task not found error", async () => {
      mockGlobalState.downloadQueue = []

      await startDownloadTask(
        mockStateManager,
        "non-existent",
        mockEnsureOffscreenReady
      )

      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
    })

    it("does not dispatch a chapter when cancellation wins the atomic start update", async () => {
      const task = makeTask({ id: "task-cancel-race" })
      mockGlobalState.downloadQueue = [task]
      vi.mocked(mockStateManager.beginChapterDispatch).mockResolvedValueOnce({
        success: false,
        reason: "task-not-downloading",
        currentStatus: "canceled",
      })

      await startDownloadTask(
        mockStateManager,
        task.id,
        mockEnsureOffscreenReady
      )

      expect(mockRuntimeSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "OFFSCREEN_DOWNLOAD_CHAPTER" })
      )
    })

    it("should handle path validation failure", async () => {
      const { validateDownloadPathForTask } =
        await import("@/entrypoints/background/queue-helpers")
      vi.mocked(validateDownloadPathForTask).mockImplementationOnce(() => {
        throw new Error("Invalid download path")
      })

      const task = makeTask({ id: "task-1" })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockStateManager,
        "task-1",
        mockEnsureOffscreenReady
      )

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({
          status: "failed",
          errorMessage: "Invalid download path",
        })
      )
    })

    it("should handle plan resolution failure", async () => {
      const { resolveDownloadPlan } =
        await import("@/entrypoints/background/queue-helpers")
      vi.mocked(resolveDownloadPlan).mockRejectedValueOnce(
        new Error("Chapter title missing")
      )

      const task = makeTask({
        id: "task-1",
        chapters: [
          createChapter({
            url: "https://example.com/ch1",
            title: "",
            chapterNumber: 1,
          }),
        ],
      })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockStateManager,
        "task-1",
        mockEnsureOffscreenReady
      )

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({
          errorMessage: "Chapter title missing",
        })
      )
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({
          status: "failed",
        })
      )
    })

    it("re-resolves chapter paths on each dispatch iteration", async () => {
      const { resolveDownloadPlan } =
        await import("@/entrypoints/background/queue-helpers")

      vi.mocked(resolveDownloadPlan)
        .mockResolvedValueOnce({
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
              resolvedPath: "2026-02-26/Chapter 1.cbz",
              comicInfo: { Series: "Test Manga" },
            },
            {
              id: "ch2",
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
              resolvedPath: "2026-02-26/Chapter 2.cbz",
              comicInfo: { Series: "Test Manga" },
            },
          ],
        })
        .mockResolvedValueOnce({
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
              resolvedPath: "2026-02-27/Chapter 1.cbz",
              comicInfo: { Series: "Test Manga" },
            },
            {
              id: "ch2",
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
              resolvedPath: "2026-02-27/Chapter 2.cbz",
              comicInfo: { Series: "Test Manga" },
            },
          ],
        })

      const task = makeTask({
        id: "task-date-macros",
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
          archiveFormat: "cbz",
        },
      })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockStateManager,
        "task-date-macros",
        mockEnsureOffscreenReady
      )

      const chapterDispatchCalls = mockRuntimeSendMessage.mock.calls.filter(
        (call) => call?.[0]?.type === "OFFSCREEN_DOWNLOAD_CHAPTER"
      )

      expect(chapterDispatchCalls).toHaveLength(2)
      expect(chapterDispatchCalls[0]?.[0]?.payload?.chapter?.resolvedPath).toBe(
        "2026-02-26/Chapter 1.cbz"
      )
      expect(chapterDispatchCalls[1]?.[0]?.payload?.chapter?.resolvedPath).toBe(
        "2026-02-27/Chapter 2.cbz"
      )
      expect(vi.mocked(resolveDownloadPlan)).toHaveBeenCalledTimes(2)
    })

    it("uses TaskChapter.index (series position) not dispatch loop index in OFFSCREEN_DOWNLOAD_CHAPTER", async () => {
      const { resolveDownloadPlan } =
        await import("@/entrypoints/background/queue-helpers")
      const mockPlan = {
        format: "cbz" as const,
        book: {
          siteId: "test-site",
          seriesId: "series-1",
          seriesTitle: "Test Manga",
          comicInfoBase: { Series: "Test Manga" },
        },
        chapters: [
          {
            id: "ch5",
            url: "https://example.com/ch5",
            title: "Chapter 5",
            chapterNumber: 5,
            resolvedPath: "Chapter 5.cbz",
            comicInfo: { Series: "Test Manga" },
          },
          {
            id: "ch10",
            url: "https://example.com/ch10",
            title: "Chapter 10",
            chapterNumber: 10,
            resolvedPath: "Chapter 10.cbz",
            comicInfo: { Series: "Test Manga" },
          },
        ],
      }
      vi.mocked(resolveDownloadPlan)
        .mockResolvedValueOnce(mockPlan)
        .mockResolvedValueOnce(mockPlan)

      const task = makeTask({
        id: "task-index-test",
        chapters: [
          createChapter({
            id: "ch5",
            url: "https://example.com/ch5",
            title: "Chapter 5",
            chapterNumber: 5,
            index: 5,
          }),
          createChapter({
            id: "ch10",
            url: "https://example.com/ch10",
            title: "Chapter 10",
            chapterNumber: 10,
            index: 10,
          }),
        ],
      })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockStateManager,
        "task-index-test",
        mockEnsureOffscreenReady
      )

      const chapterDispatchCalls = mockRuntimeSendMessage.mock.calls.filter(
        (call) => call?.[0]?.type === "OFFSCREEN_DOWNLOAD_CHAPTER"
      )

      expect(chapterDispatchCalls).toHaveLength(2)
      expect(chapterDispatchCalls[0]?.[0]?.payload?.chapter?.index).toBe(5)
      expect(chapterDispatchCalls[1]?.[0]?.payload?.chapter?.index).toBe(10)
    })

    it("propagates chapter language to OFFSCREEN_DOWNLOAD_CHAPTER payload", async () => {
      const task = makeTask({
        id: "task-language",
        chapters: [
          createChapter({
            id: "ch1",
            url: "https://example.com/ch1",
            title: "Chapter 1",
            chapterNumber: 1,
            language: "ja",
          }),
        ],
      })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockStateManager,
        "task-language",
        mockEnsureOffscreenReady
      )

      const chapterDispatchCalls = mockRuntimeSendMessage.mock.calls.filter(
        (call) => call?.[0]?.type === "OFFSCREEN_DOWNLOAD_CHAPTER"
      )

      expect(chapterDispatchCalls).toHaveLength(1)
      expect(chapterDispatchCalls[0]?.[0]?.payload?.chapter?.language).toBe(
        "ja"
      )
      expect(chapterDispatchCalls[0]?.[0]?.payload?.seriesKey).toBe(
        "test-site#series-1"
      )
    })

    it("dispatches chapters sequentially even when stale task settings contain chapter concurrency above one", async () => {
      const dispatchOrder: string[] = []
      let inFlightDispatches = 0
      let maxInFlightDispatches = 0

      const { resolveDownloadPlan } =
        await import("@/entrypoints/background/queue-helpers")
      vi.mocked(resolveDownloadPlan).mockResolvedValue({
        format: "cbz",
        book: {
          siteId: "test-site",
          seriesId: "series-1",
          seriesTitle: "Sequential Series",
          comicInfoBase: { Series: "Sequential Series" },
        },
        chapters: [
          {
            id: "ch1",
            url: "https://example.com/ch1",
            title: "Chapter 1",
            chapterNumber: 1,
            resolvedPath: "Chapter 1.cbz",
            comicInfo: { Series: "Sequential Series" },
          },
          {
            id: "ch2",
            url: "https://example.com/ch2",
            title: "Chapter 2",
            chapterNumber: 2,
            resolvedPath: "Chapter 2.cbz",
            comicInfo: { Series: "Sequential Series" },
          },
          {
            id: "ch3",
            url: "https://example.com/ch3",
            title: "Chapter 3",
            chapterNumber: 3,
            resolvedPath: "Chapter 3.cbz",
            comicInfo: { Series: "Sequential Series" },
          },
        ],
      })

      mockRuntimeSendMessage.mockImplementation(
        async (message: {
          type?: string
          payload?: { chapter?: { id?: string } }
        }) => {
          if (message?.type !== "OFFSCREEN_DOWNLOAD_CHAPTER") {
            return { success: true, status: "completed" }
          }

          const chapterId = message.payload?.chapter?.id ?? "unknown"
          if (chapterId === "ch2") {
            expect(
              chapterPersistenceService.markChapterAsDownloaded
            ).toHaveBeenCalledWith(
              expect.objectContaining({
                chapterId: "ch1",
                seriesId: "series-1",
                format: "cbz",
              })
            )
          }
          dispatchOrder.push(`start:${chapterId}`)
          inFlightDispatches += 1
          maxInFlightDispatches = Math.max(
            maxInFlightDispatches,
            inFlightDispatches
          )

          await new Promise((resolve) => setTimeout(resolve, 5))

          inFlightDispatches -= 1
          dispatchOrder.push(`end:${chapterId}`)
          return { success: true, status: "completed" }
        }
      )

      const task = makeTask({
        id: "task-sequential-dispatch",
        seriesTitle: "Sequential Series",
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
          archiveFormat: "cbz",
          rateLimitSettings: {
            image: { concurrency: 2, delayMs: 0 },
            chapter: { concurrency: 2, delayMs: 0 },
          },
        },
      })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockStateManager,
        "task-sequential-dispatch",
        mockEnsureOffscreenReady
      )

      expect(maxInFlightDispatches).toBe(1)
      expect(
        dispatchOrder.filter((entry) => entry.startsWith("start:"))
      ).toHaveLength(3)
      expect(
        dispatchOrder.filter((entry) => entry.startsWith("end:"))
      ).toHaveLength(3)
    })

    it("persists and forwards the next chapter not-before deadline", async () => {
      vi.spyOn(Date, "now").mockReturnValue(10_000)
      vi.mocked(resolveDownloadPlan).mockResolvedValue({
        format: "cbz",
        book: {
          siteId: "test-site",
          seriesId: "series-1",
          seriesTitle: "Delayed Series",
          comicInfoBase: { Series: "Delayed Series" },
        },
        chapters: [
          {
            id: "ch1",
            url: "https://example.com/ch1",
            title: "Chapter 1",
            resolvedPath: "Chapter 1.cbz",
            comicInfo: { Series: "Delayed Series" },
          },
          {
            id: "ch2",
            url: "https://example.com/ch2",
            title: "Chapter 2",
            resolvedPath: "Chapter 2.cbz",
            comicInfo: { Series: "Delayed Series" },
          },
        ],
      })
      const task = makeTask({
        id: "task-durable-delay",
        chapters: [
          createChapter({ id: "ch1", url: "https://example.com/ch1" }),
          createChapter({ id: "ch2", url: "https://example.com/ch2" }),
        ],
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(testSettings, "test-site"),
          rateLimitSettings: {
            image: { concurrency: 2, delayMs: 0 },
            chapter: { concurrency: 1, delayMs: 750 },
          },
        },
      })
      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockStateManager,
        "task-durable-delay",
        mockEnsureOffscreenReady
      )

      const dispatches = mockRuntimeSendMessage.mock.calls
        .map((call) => call[0])
        .filter((message) => message?.type === "OFFSCREEN_DOWNLOAD_CHAPTER")
      expect(dispatches).toHaveLength(2)
      expect(dispatches[0]?.payload?.notBefore).toBeUndefined()
      expect(dispatches[1]?.payload?.notBefore).toBe(10_750)
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "task-durable-delay",
        { nextChapterDispatchAt: 10_750 }
      )
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "task-durable-delay",
        { nextChapterDispatchAt: undefined }
      )
    })

    it("does not overwrite chapter/task error when liveness recovery already marked them terminal", async () => {
      // Simulates the race: liveness recovery closes the offscreen mid-flight,
      // marking the chapter 'failed' with "Download process unresponsive".
      // The pending OFFSCREEN_DOWNLOAD_CHAPTER sendMessage then rejects with
      // "message channel closed". The dispatch catch must NOT overwrite the
      // liveness recovery error with the downstream sendMessage rejection.
      mockRuntimeSendMessage.mockImplementationOnce(
        async (message: { type?: string }) => {
          if (message?.type !== "OFFSCREEN_DOWNLOAD_CHAPTER") {
            return { success: true, status: "completed" }
          }

          // Simulate liveness recovery firing while the sendMessage is pending:
          // mark the chapter and task terminal with the canonical liveness error.
          const task = mockGlobalState.downloadQueue.find(
            (t) => t.id === "task-liveness-race"
          )
          if (task) {
            task.status = "failed"
            task.errorMessage = "Download process unresponsive"
            const chapter = task.chapters.find((c) => c.id === "ch1")
            if (chapter) {
              chapter.status = "failed"
              chapter.errorMessage = "Download process unresponsive"
            }
          }

          throw new Error(
            "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"
          )
        }
      )

      const task = makeTask({
        id: "task-liveness-race",
        chapters: [
          createChapter({
            id: "ch1",
            url: "https://example.com/ch1",
            title: "Chapter 1",
            chapterNumber: 1,
          }),
        ],
      })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockStateManager,
        "task-liveness-race",
        mockEnsureOffscreenReady
      )

      // The chapter should retain the liveness recovery error, not the
      // "message channel closed" sendMessage rejection.
      const chapterUpdateCalls = vi
        .mocked(mockStateManager.updateDownloadingTaskChapter)
        .mock.calls.filter((call) => call[1] === "ch1")
      const failedChapterUpdates = chapterUpdateCalls.filter(
        (call) =>
          call[2] === "failed" &&
          call[3]?.errorMessage ===
            "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"
      )
      expect(failedChapterUpdates).toHaveLength(0)

      // The chapter's final state in mockGlobalState should still have the
      // liveness recovery error (the dispatch catch skipped the overwrite).
      const finalTask = mockGlobalState.downloadQueue.find(
        (t) => t.id === "task-liveness-race"
      )
      const finalChapter = finalTask?.chapters.find((c) => c.id === "ch1")
      expect(finalChapter?.errorMessage).toBe("Download process unresponsive")
    })

    it("overwrites chapter error when no prior terminal state exists (normal dispatch failure)", async () => {
      // When liveness recovery has NOT fired, the dispatch catch should still
      // record the sendMessage rejection error as the chapter's failure reason.
      mockRuntimeSendMessage.mockImplementationOnce(
        async (message: { type?: string }) => {
          if (message?.type !== "OFFSCREEN_DOWNLOAD_CHAPTER") {
            return { success: true, status: "completed" }
          }
          throw new Error("Unexpected offscreen error")
        }
      )

      const task = makeTask({
        id: "task-normal-failure",
        chapters: [
          createChapter({
            id: "ch1",
            url: "https://example.com/ch1",
            title: "Chapter 1",
            chapterNumber: 1,
          }),
        ],
      })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockStateManager,
        "task-normal-failure",
        mockEnsureOffscreenReady
      )

      const finalTask = mockGlobalState.downloadQueue.find(
        (t) => t.id === "task-normal-failure"
      )
      const finalChapter = finalTask?.chapters.find((c) => c.id === "ch1")
      expect(finalChapter?.status).toBe("failed")
      expect(finalChapter?.errorMessage).toBe("Unexpected offscreen error")
    })
  })

  describe("processDownloadQueue", () => {
    it("should start at most one queued task when none are active", async () => {
      const tasks: DownloadTaskState[] = [
        makeTask({
          id: "task-1",
          mangaId: "series-1",
          seriesTitle: "Test Manga 1",
        }),
        makeTask({
          id: "task-2",
          mangaId: "series-2",
          seriesTitle: "Test Manga 2",
        }),
      ]

      mockGlobalState.downloadQueue = tasks

      await processDownloadQueue(mockStateManager, mockEnsureOffscreenReady)

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalled()
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({ status: "downloading" })
      )
      expect(mockStateManager.updateDownloadingTaskChapter).toHaveBeenCalled()
    })

    it("should not start new tasks when an active task exists", async () => {
      const tasks: DownloadTaskState[] = [
        makeTask({
          id: "task-1",
          mangaId: "series-1",
          seriesTitle: "Test Manga 1",
          status: "downloading",
        }),
        makeTask({
          id: "task-3",
          mangaId: "series-3",
          seriesTitle: "Test Manga 3",
        }),
        makeTask({
          id: "task-4",
          mangaId: "series-4",
          seriesTitle: "Test Manga 4",
        }),
      ]

      mockGlobalState.downloadQueue = tasks

      await processDownloadQueue(mockStateManager, mockEnsureOffscreenReady)

      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalled()
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
    })

    it("starts only one queued task even when multiple tasks are queued", async () => {
      const tasks: DownloadTaskState[] = [
        makeTask({
          id: "task-1",
          siteIntegrationId: "test-site-a",
          mangaId: "series-1",
          seriesTitle: "Test Manga 1",
          created: Date.now(),
        }),
        makeTask({
          id: "task-2",
          siteIntegrationId: "test-site-b",
          mangaId: "series-2",
          seriesTitle: "Test Manga 2",
          chapters: [
            createChapter({
              url: "https://example.com/ch2",
              title: "Chapter 2",
              chapterNumber: 2,
            }),
          ],
          created: Date.now() + 1,
        }),
        makeTask({
          id: "task-3",
          siteIntegrationId: "test-site-c",
          mangaId: "series-3",
          seriesTitle: "Test Manga 3",
          chapters: [
            createChapter({
              url: "https://example.com/ch3",
              title: "Chapter 3",
              chapterNumber: 3,
            }),
          ],
          created: Date.now() + 2,
        }),
      ]

      mockGlobalState.downloadQueue = tasks

      await processDownloadQueue(mockStateManager, mockEnsureOffscreenReady)

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({ status: "downloading" })
      )
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalledWith(
        "task-2",
        expect.objectContaining({ status: "downloading" })
      )
      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalledWith(
        "task-3",
        expect.objectContaining({ status: "downloading" })
      )
    })

    it("should skip processing when no queued tasks", async () => {
      mockGlobalState.downloadQueue = [
        makeTask({ id: "task-1", status: "completed", completed: Date.now() }),
      ]

      await processDownloadQueue(mockStateManager, mockEnsureOffscreenReady)

      expect(mockStateManager.updateDownloadTask).not.toHaveBeenCalled()
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
    })

    it("starts queued task without consulting stale chapter task limiter policy", async () => {
      const tasks: DownloadTaskState[] = [
        makeTask({
          id: "task-rate-limited",
          seriesTitle: "Rate Limited",
          chapters: [
            createChapter({
              url: "https://example.com/wait-1",
              title: "Chapter 1",
              chapterNumber: 1,
            }),
          ],
        }),
      ]

      mockGlobalState.downloadQueue = tasks

      const rateLimit = await import("@/src/runtime/rate-limit")
      const mockedResolvePolicy = vi.mocked(rateLimit.resolveEffectivePolicy)
      const mockedSchedule = vi.mocked(rateLimit.scheduleForIntegrationScope)

      await processDownloadQueue(mockStateManager, mockEnsureOffscreenReady)

      expect(mockedResolvePolicy).not.toHaveBeenCalled()
      expect(mockedSchedule).not.toHaveBeenCalled()

      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "task-rate-limited",
        expect.objectContaining({ status: "downloading" })
      )
    })

    it("marks the replacement task downloading without waiting for stale limiter scaffolding", async () => {
      const task = makeTask({
        id: "replacement-task",
        seriesTitle: "Replacement Series",
        chapters: [
          createChapter({
            url: "https://example.com/replacement-1",
            title: "Chapter 1",
            chapterNumber: 1,
          }),
        ],
      })

      mockGlobalState.downloadQueue = [task]

      const rateLimit = await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimit.scheduleForIntegrationScope).mockImplementationOnce(
        () => new Promise(() => undefined)
      )

      await processDownloadQueue(mockStateManager, mockEnsureOffscreenReady)

      expect(vi.mocked(rateLimit.resolveEffectivePolicy)).not.toHaveBeenCalled()
      expect(
        vi.mocked(rateLimit.scheduleForIntegrationScope)
      ).not.toHaveBeenCalled()
      expect(mockStateManager.updateDownloadTask).toHaveBeenCalledWith(
        "replacement-task",
        expect.objectContaining({ status: "downloading" })
      )
    })
  })
}
