import { describe, expect, it, vi } from "vitest"
import {
  createActiveDispatchLeaseStore,
  createDispatchLease,
} from "@/src/runtime/active-dispatch-lease"
import {
  LOCAL_STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
} from "@/src/runtime/storage-keys"
import {
  mockLocalStorage,
  mockSessionStorage,
  makeDownloadTask,
} from "./centralized-state-test-setup"

export function registerCentralizedStateGlobalQueueCases(): void {
  describe("Global State Operations", () => {
    it("retrieves global state", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      const globalState = await stateManager.getGlobalState()
      expect(globalState).toBeDefined()
      expect(globalState.downloadQueue).toEqual([])
      expect(globalState.settings).toBeDefined()
    })

    it("updates global state", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      await stateManager.updateGlobalState({
        downloadQueue: [makeDownloadTask({ id: "task-1", mangaId: "test" })],
      })

      const globalState = await stateManager.getGlobalState()
      expect(globalState.downloadQueue).toHaveLength(1)
      expect(globalState.downloadQueue[0].id).toBe("task-1")
      expect(mockLocalStorage.downloadQueue).toEqual(globalState.downloadQueue)
    })

    it("updates lastActivity timestamp on global state changes", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      const beforeUpdate = Date.now()
      await new Promise((resolve) => setTimeout(resolve, 10))

      await stateManager.updateGlobalState({ downloadQueue: [] })

      const globalState = await stateManager.getGlobalState()
      expect(globalState.lastActivity).toBeGreaterThan(beforeUpdate)
    })
  })

  describe("Download Task Management", () => {
    it("adds download task to queue", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      const task = makeDownloadTask({
        id: "task-1",
        mangaId: "test-series",
        seriesTitle: "Test Manga",
        status: "queued" as const,
      })

      await stateManager.addDownloadTask(task)

      const globalState = await stateManager.getGlobalState()
      expect(globalState.downloadQueue).toHaveLength(1)
      expect(globalState.downloadQueue[0]).toEqual(task)
      expect(mockLocalStorage.downloadQueue).toEqual(globalState.downloadQueue)
    })

    it("returns snapshots that cannot mutate the committed cache", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      const exposedState = await stateManager.getGlobalState()
      exposedState.downloadQueue.push(
        makeDownloadTask({ id: "uncommitted", mangaId: "test" })
      )

      expect((await stateManager.getGlobalState()).downloadQueue).toEqual([])
      expect(mockLocalStorage.downloadQueue).toEqual([])
    })

    it("does not expose or project an enqueue when the durable local commit fails", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
        new Error("local commit failed")
      )

      await expect(
        stateManager.addDownloadTask(
          makeDownloadTask({ id: "not-committed", mangaId: "test" })
        )
      ).rejects.toThrow("local commit failed")

      expect((await stateManager.getGlobalState()).downloadQueue).toEqual([])
      expect(mockLocalStorage.downloadQueue).toEqual([])
      expect(
        (
          mockSessionStorage[SESSION_STORAGE_KEYS.globalState] as {
            downloadQueue: unknown[]
          }
        ).downloadQueue
      ).toEqual([])
    })

    it("keeps a durable enqueue successful when the session projection fails", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      const sessionFailure = new Error("session projection failed")
      vi.mocked(chrome.storage.session.set)
        .mockRejectedValueOnce(sessionFailure)
        .mockRejectedValueOnce(sessionFailure)

      const task = makeDownloadTask({
        id: "durably-committed",
        mangaId: "test",
      })
      await expect(stateManager.addDownloadTask(task)).resolves.toBeUndefined()

      expect((await stateManager.getGlobalState()).downloadQueue).toEqual([
        task,
      ])
      expect(mockLocalStorage.downloadQueue).toEqual([task])

      const recoveredManager = new CentralizedStateManager()
      await recoveredManager.initialize()
      expect((await recoveredManager.getGlobalState()).downloadQueue).toEqual([
        expect.objectContaining({ id: task.id, mangaId: task.mangaId }),
      ])
    })

    it("transitions a download task from an allowed status", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      await stateManager.addDownloadTask(
        makeDownloadTask({ id: "task-1", mangaId: "test" })
      )

      const result = await stateManager.transitionDownloadTask(
        "task-1",
        ["queued"],
        {
          status: "downloading",
        }
      )

      const globalState = await stateManager.getGlobalState()
      expect(result).toMatchObject({ success: true })
      expect(globalState.downloadQueue[0].status).toBe("downloading")
    })

    it("atomically allows only one queued task to become downloading", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({ id: "queued-a", mangaId: "a" })
      )
      await stateManager.addDownloadTask(
        makeDownloadTask({ id: "queued-b", mangaId: "b" })
      )

      const results = await Promise.all([
        stateManager.transitionDownloadTask("queued-a", ["queued"], {
          status: "downloading",
        }),
        stateManager.transitionDownloadTask("queued-b", ["queued"], {
          status: "downloading",
        }),
      ])

      expect(results.filter((result) => result.success)).toHaveLength(1)
      expect(
        (await stateManager.getGlobalState()).downloadQueue.filter(
          (task) => task.status === "downloading"
        )
      ).toHaveLength(1)
    })

    it("commits chapter dispatch state and its lease in one durable write", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "atomic-dispatch",
          mangaId: "test",
          status: "downloading",
          chapters: [
            {
              id: "chapter-1",
              url: "chapter-1",
              title: "Chapter 1",
              index: 1,
              status: "queued",
              lastUpdated: 1,
            },
          ],
        })
      )
      const lease = createDispatchLease({
        jobId: "job-1",
        taskId: "atomic-dispatch",
        chapterId: "chapter-1",
        attempt: 3,
        now: 1_000,
      })
      vi.mocked(chrome.storage.local.set).mockClear()

      await expect(
        stateManager.beginChapterDispatch({
          taskId: "atomic-dispatch",
          chapterId: "chapter-1",
          expectedPreviousLease: null,
          lease,
        })
      ).resolves.toEqual({ success: true, updated: true })

      expect(chrome.storage.local.set).toHaveBeenCalledTimes(1)
      const commit = vi.mocked(chrome.storage.local.set).mock.calls[0][0] as
        Record<string, unknown> | undefined
      expect(commit).toBeDefined()
      if (!commit) throw new Error("Expected an atomic local storage commit")
      expect(commit[LOCAL_STORAGE_KEYS.activeDispatchLease]).toEqual(lease)
      expect(commit[LOCAL_STORAGE_KEYS.downloadQueue]).toEqual([
        expect.objectContaining({
          id: "atomic-dispatch",
          chapters: [
            expect.objectContaining({
              id: "chapter-1",
              status: "downloading",
              dispatchAttempt: 3,
              outputs: { requested: 0, committed: 0, failed: 0 },
            }),
          ],
        }),
      ])
    })

    it("serializes atomic queue dispatch with lease-store renewal", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")
      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "shared-gate-dispatch",
          mangaId: "test",
          status: "downloading",
          chapters: [
            {
              id: "chapter-1",
              url: "chapter-1",
              title: "Chapter 1",
              index: 1,
              status: "queued",
              lastUpdated: 1,
            },
          ],
        })
      )
      const lease = createDispatchLease({
        jobId: "shared-gate-job",
        taskId: "shared-gate-dispatch",
        chapterId: "chapter-1",
        attempt: 1,
        now: 1_000,
      })
      const events: string[] = []
      let atomicWriteStarted = false
      let signalAtomicWrite!: () => void
      let releaseAtomicWrite!: () => void
      const atomicWriteReached = new Promise<void>((resolve) => {
        signalAtomicWrite = resolve
      })
      const atomicWriteBarrier = new Promise<void>((resolve) => {
        releaseAtomicWrite = resolve
      })

      vi.mocked(chrome.storage.local.get).mockImplementation((async (
        keys?: string | string[] | null
      ) => {
        if (keys === LOCAL_STORAGE_KEYS.activeDispatchLease) {
          events.push(atomicWriteStarted ? "renew:get" : "dispatch:get")
          return { [keys]: mockLocalStorage[keys] }
        }
        if (keys === undefined || keys === null) {
          return mockLocalStorage
        }
        const keyArray = typeof keys === "string" ? [keys] : keys
        return Object.fromEntries(
          keyArray
            .filter((key) => key in mockLocalStorage)
            .map((key) => [key, mockLocalStorage[key]])
        )
      }) as never)
      vi.mocked(chrome.storage.local.set).mockImplementation(
        async (items: Record<string, unknown>) => {
          const isAtomicDispatchWrite =
            LOCAL_STORAGE_KEYS.downloadQueue in items &&
            LOCAL_STORAGE_KEYS.activeDispatchLease in items
          if (isAtomicDispatchWrite) {
            atomicWriteStarted = true
            events.push("dispatch:set:start")
            signalAtomicWrite()
            await atomicWriteBarrier
            events.push("dispatch:set:end")
          } else if (LOCAL_STORAGE_KEYS.activeDispatchLease in items) {
            events.push("renew:set")
          }
          Object.assign(mockLocalStorage, structuredClone(items))
        }
      )

      const dispatch = stateManager.beginChapterDispatch({
        taskId: "shared-gate-dispatch",
        chapterId: "chapter-1",
        expectedPreviousLease: null,
        lease,
      })
      await atomicWriteReached

      const leaseStore = createActiveDispatchLeaseStore()
      const renewal = leaseStore.renew({
        jobId: lease.jobId,
        attempt: lease.attempt,
        stage: "accepted",
        sequence: 1,
        activityAt: 2_000,
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(events).not.toContain("renew:get")

      releaseAtomicWrite()
      await expect(dispatch).resolves.toEqual({ success: true, updated: true })
      await expect(renewal).resolves.toBe(true)
      expect(events).toEqual([
        "dispatch:get",
        "dispatch:set:start",
        "dispatch:set:end",
        "renew:get",
        "renew:set",
      ])
    })

    it("rejects a new dispatch when the stored predecessor lease is unexpected", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")
      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "lease-cas-conflict",
          mangaId: "test",
          status: "downloading",
          chapters: [
            {
              id: "chapter-old",
              url: "chapter-old",
              title: "Old chapter",
              index: 1,
              status: "completed",
              lastUpdated: 1,
            },
            {
              id: "chapter-new",
              url: "chapter-new",
              title: "New chapter",
              index: 2,
              status: "queued",
              lastUpdated: 1,
            },
          ],
        })
      )
      const predecessor = createDispatchLease({
        jobId: "job-old",
        taskId: "lease-cas-conflict",
        chapterId: "chapter-old",
        attempt: 1,
        now: 1_000,
      })
      const replacement = createDispatchLease({
        jobId: "job-new",
        taskId: "lease-cas-conflict",
        chapterId: "chapter-new",
        attempt: 1,
        now: 2_000,
      })
      mockLocalStorage[LOCAL_STORAGE_KEYS.activeDispatchLease] = predecessor
      vi.mocked(chrome.storage.local.set).mockClear()

      await expect(
        stateManager.beginChapterDispatch({
          taskId: "lease-cas-conflict",
          chapterId: "chapter-new",
          expectedPreviousLease: null,
          lease: replacement,
        })
      ).resolves.toEqual({
        success: false,
        reason: "dispatch-lease-conflict",
      })

      expect(chrome.storage.local.set).not.toHaveBeenCalled()
      expect(mockLocalStorage[LOCAL_STORAGE_KEYS.activeDispatchLease]).toEqual(
        predecessor
      )
      expect(
        (await stateManager.getGlobalState()).downloadQueue[0].chapters[1]
          .status
      ).toBe("queued")
    })

    it("replaces only the exact expected predecessor dispatch lease", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")
      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "lease-cas-replace",
          mangaId: "test",
          status: "downloading",
          chapters: [
            {
              id: "chapter-old",
              url: "chapter-old",
              title: "Old chapter",
              index: 1,
              status: "completed",
              lastUpdated: 1,
            },
            {
              id: "chapter-new",
              url: "chapter-new",
              title: "New chapter",
              index: 2,
              status: "queued",
              lastUpdated: 1,
            },
          ],
        })
      )
      const predecessor = createDispatchLease({
        jobId: "job-old",
        taskId: "lease-cas-replace",
        chapterId: "chapter-old",
        attempt: 1,
        now: 1_000,
      })
      const replacement = createDispatchLease({
        jobId: "job-new",
        taskId: "lease-cas-replace",
        chapterId: "chapter-new",
        attempt: 1,
        now: 2_000,
      })
      mockLocalStorage[LOCAL_STORAGE_KEYS.activeDispatchLease] = predecessor

      await expect(
        stateManager.beginChapterDispatch({
          taskId: "lease-cas-replace",
          chapterId: "chapter-new",
          expectedPreviousLease: {
            jobId: predecessor.jobId,
            taskId: predecessor.taskId,
            chapterId: predecessor.chapterId,
            attempt: predecessor.attempt,
          },
          lease: replacement,
        })
      ).resolves.toEqual({ success: true, updated: true })

      expect(mockLocalStorage[LOCAL_STORAGE_KEYS.activeDispatchLease]).toEqual(
        replacement
      )
      expect(
        (await stateManager.getGlobalState()).downloadQueue[0].chapters[1]
      ).toEqual(
        expect.objectContaining({
          status: "downloading",
          dispatchAttempt: 1,
        })
      )
    })

    it("commits task cancellation and matching lease removal together", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "atomic-cancel",
          mangaId: "test",
          status: "downloading",
          chapters: [
            {
              id: "chapter-active",
              url: "chapter-active",
              title: "Active chapter",
              index: 1,
              status: "queued",
              lastUpdated: 1,
            },
            {
              id: "chapter-queued",
              url: "chapter-queued",
              title: "Queued chapter",
              index: 2,
              status: "queued",
              lastUpdated: 1,
            },
          ],
        })
      )
      const lease = createDispatchLease({
        jobId: "job-cancel",
        taskId: "atomic-cancel",
        chapterId: "chapter-active",
        attempt: 1,
        now: 1_000,
      })
      await stateManager.beginChapterDispatch({
        taskId: "atomic-cancel",
        chapterId: "chapter-active",
        expectedPreviousLease: null,
        lease,
      })
      vi.mocked(chrome.storage.local.set).mockClear()

      const result = await stateManager.cancelDownloadTaskAtomically(
        "atomic-cancel",
        2_000
      )

      expect(result).toMatchObject({ success: true, canceledLease: lease })
      expect(chrome.storage.local.set).toHaveBeenCalledTimes(1)
      const commit = vi.mocked(chrome.storage.local.set).mock.calls[0][0] as
        Record<string, unknown> | undefined
      expect(commit).toBeDefined()
      if (!commit) throw new Error("Expected an atomic local storage commit")
      expect(commit[LOCAL_STORAGE_KEYS.activeDispatchLease]).toBeNull()
      expect(commit[LOCAL_STORAGE_KEYS.downloadQueue]).toEqual([
        expect.objectContaining({
          id: "atomic-cancel",
          status: "canceled",
          completed: 2_000,
          chapters: [
            expect.objectContaining({
              id: "chapter-active",
              status: "canceled",
            }),
            expect.objectContaining({
              id: "chapter-queued",
              status: "skipped",
            }),
          ],
        }),
      ])
    })

    it("normalizes active and queued children while preserving every terminal outcome", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")
      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      const terminalChapters = [
        {
          id: "chapter-completed",
          url: "chapter-completed",
          title: "Completed",
          index: 3,
          status: "completed" as const,
          errorMessage: "retained completed audit text",
          lastUpdated: 3,
        },
        {
          id: "chapter-partial",
          url: "chapter-partial",
          title: "Partial",
          index: 4,
          status: "partial_success" as const,
          errorMessage: "retained partial audit text",
          lastUpdated: 4,
        },
        {
          id: "chapter-failed",
          url: "chapter-failed",
          title: "Failed",
          index: 5,
          status: "failed" as const,
          errorMessage: "retained failure audit text",
          lastUpdated: 5,
        },
        {
          id: "chapter-canceled",
          url: "chapter-canceled",
          title: "Canceled",
          index: 6,
          status: "canceled" as const,
          errorMessage: "retained cancellation audit text",
          lastUpdated: 6,
        },
        {
          id: "chapter-skipped",
          url: "chapter-skipped",
          title: "Skipped",
          index: 7,
          status: "skipped" as const,
          errorMessage: "retained skipped audit text",
          lastUpdated: 7,
        },
      ]
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "cancel-child-matrix",
          mangaId: "test",
          status: "downloading",
          chapters: [
            {
              id: "chapter-active",
              url: "chapter-active",
              title: "Active",
              index: 1,
              status: "downloading",
              lastUpdated: 1,
            },
            {
              id: "chapter-queued",
              url: "chapter-queued",
              title: "Queued",
              index: 2,
              status: "queued",
              lastUpdated: 2,
            },
            ...terminalChapters,
          ],
        })
      )

      const result = await stateManager.cancelDownloadTaskAtomically(
        "cancel-child-matrix",
        9_000
      )

      expect(result).toMatchObject({ success: true })
      const task = (await stateManager.getGlobalState()).downloadQueue[0]
      expect(task.chapters[0]).toMatchObject({
        status: "canceled",
        errorMessage: "Canceled by user",
        lastUpdated: 9_000,
      })
      expect(task.chapters[1]).toMatchObject({
        status: "skipped",
        errorMessage: "Skipped after task cancellation",
        lastUpdated: 9_000,
      })
      expect(task.chapters.slice(2)).toEqual(terminalChapters)
    })

    it("stages queued cancellation for Undo without requiring an active dispatch lease", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")
      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "queued-cancel-no-lease",
          mangaId: "test",
          status: "queued",
          chapters: [
            {
              id: "chapter-queued",
              url: "chapter-queued",
              title: "Queued",
              index: 1,
              status: "queued",
              lastUpdated: 1,
            },
          ],
        })
      )

      const result = await stateManager.cancelDownloadTaskAtomically(
        "queued-cancel-no-lease",
        10_000
      )

      expect(result).toMatchObject({
        success: true,
        canceledLease: null,
        undo: { type: "cancel_queued", expiresAt: 15_000 },
      })
      expect((await stateManager.getGlobalState()).downloadQueue).toEqual([])
      const pendingAction = (await stateManager.getPendingUndoActions())[0]
      expect(pendingAction).toMatchObject({
        type: "cancel_queued",
        previousQueuePosition: 0,
        taskSnapshot: { id: "queued-cancel-no-lease", status: "queued" },
      })

      await stateManager.finalizePendingUndoAction(pendingAction.token)
      expect(
        (await stateManager.getGlobalState()).downloadQueue[0]
      ).toMatchObject({
        status: "canceled",
        completed: 10_000,
        chapters: [expect.objectContaining({ status: "skipped" })],
      })
    })

    it("does not expose either half of a failed atomic dispatch commit", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "failed-atomic-dispatch",
          mangaId: "test",
          status: "downloading",
          chapters: [
            {
              id: "chapter-1",
              url: "chapter-1",
              title: "Chapter 1",
              index: 1,
              status: "queued",
              lastUpdated: 1,
            },
          ],
        })
      )
      const lease = createDispatchLease({
        jobId: "job-failed-commit",
        taskId: "failed-atomic-dispatch",
        chapterId: "chapter-1",
        attempt: 1,
        now: 1_000,
      })
      vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
        new Error("atomic commit failed")
      )

      await expect(
        stateManager.beginChapterDispatch({
          taskId: "failed-atomic-dispatch",
          chapterId: "chapter-1",
          expectedPreviousLease: null,
          lease,
        })
      ).rejects.toThrow("atomic commit failed")

      expect(
        (await stateManager.getGlobalState()).downloadQueue[0].chapters[0]
          .status
      ).toBe("queued")
      expect(
        (mockLocalStorage.downloadQueue as Array<{ chapters: unknown[] }>)[0]
          .chapters[0]
      ).toMatchObject({ status: "queued" })
      expect(
        mockLocalStorage[LOCAL_STORAGE_KEYS.activeDispatchLease]
      ).toBeUndefined()
    })

    it("does not rewrite an already-terminal chapter status", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "active-with-completed-chapter",
          mangaId: "test",
          status: "downloading",
          chapters: [
            {
              id: "chapter-1",
              url: "chapter-1",
              title: "Chapter 1",
              index: 1,
              status: "completed",
              lastUpdated: 1,
            },
          ],
        })
      )

      await stateManager.updateDownloadTaskChapter(
        "active-with-completed-chapter",
        "chapter-1",
        "failed",
        { errorMessage: "late failure" }
      )

      const chapter = (await stateManager.getGlobalState()).downloadQueue[0]
        .chapters[0]
      expect(chapter.status).toBe("completed")
      expect(chapter.errorMessage).toBeUndefined()
    })

    it("atomically rejects a chapter update after its parent task is cancelled", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "cancel-race",
          mangaId: "test",
          status: "downloading",
          chapters: [
            {
              id: "chapter-1",
              url: "chapter-1",
              title: "Chapter 1",
              index: 1,
              status: "downloading",
              lastUpdated: 1,
            },
          ],
        })
      )

      await stateManager.transitionDownloadTask(
        "cancel-race",
        ["downloading"],
        { status: "canceled", completed: 2 }
      )
      const result = await stateManager.updateDownloadingTaskChapter(
        "cancel-race",
        "chapter-1",
        "completed"
      )

      expect(result).toEqual({
        success: false,
        reason: "task-not-downloading",
        currentStatus: "canceled",
      })
      expect(
        (await stateManager.getGlobalState()).downloadQueue[0].chapters[0]
          .status
      ).toBe("downloading")
    })

    it("atomically preserves a terminal chapter while its parent remains downloading", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "terminal-child",
          mangaId: "test",
          status: "downloading",
          chapters: [
            {
              id: "chapter-1",
              url: "chapter-1",
              title: "Chapter 1",
              index: 1,
              status: "completed",
              lastUpdated: 1,
            },
          ],
        })
      )

      const result = await stateManager.updateDownloadingTaskChapter(
        "terminal-child",
        "chapter-1",
        "failed",
        { errorMessage: "late failure" }
      )

      expect(result).toEqual({ success: true, updated: false })
      const chapter = (await stateManager.getGlobalState()).downloadQueue[0]
        .chapters[0]
      expect(chapter.status).toBe("completed")
      expect(chapter.errorMessage).toBeUndefined()
    })

    it("rejects a terminal task transition and preserves its state", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "completed-task",
          mangaId: "test",
          status: "completed",
          completed: 123,
        })
      )

      const result = await stateManager.transitionDownloadTask(
        "completed-task",
        ["queued", "downloading"],
        { status: "canceled", completed: 456 }
      )

      const task = (await stateManager.getGlobalState()).downloadQueue[0]
      expect(result).toEqual({
        success: false,
        reason: "invalid-status",
        currentStatus: "completed",
      })
      expect(task.status).toBe("completed")
      expect(task.completed).toBe(123)
    })

    it("returns not-found when transitioning a missing task", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      await expect(
        stateManager.transitionDownloadTask(
          "missing-task",
          ["queued", "downloading"],
          { status: "canceled" }
        )
      ).resolves.toEqual({ success: false, reason: "not-found" })
    })

    it("allows only one competing terminal transition to win", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "racing-task",
          mangaId: "test",
          status: "downloading",
        })
      )

      const results = await Promise.all([
        stateManager.transitionDownloadTask("racing-task", ["downloading"], {
          status: "completed",
          completed: 100,
        }),
        stateManager.transitionDownloadTask(
          "racing-task",
          ["queued", "downloading"],
          { status: "canceled", completed: 200 }
        ),
      ])

      expect(results.filter((result) => result.success)).toHaveLength(1)
      expect(results.filter((result) => !result.success)).toHaveLength(1)
      expect(
        (await stateManager.getGlobalState()).downloadQueue[0].status
      ).toMatch(/^(completed|canceled)$/)
    })

    it("removes download task from queue", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      await stateManager.addDownloadTask(
        makeDownloadTask({ id: "task-1", mangaId: "test" })
      )

      await stateManager.removeDownloadTask("task-1")

      const globalState = await stateManager.getGlobalState()
      expect(globalState.downloadQueue).toHaveLength(0)
    })

    it("handles updating non-existent task gracefully", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      await expect(
        stateManager.updateDownloadTask("non-existent", {
          errorMessage: "missing",
        })
      ).resolves.toBeUndefined()
    })

    it("preserves concurrent chapter status mutations without dropping earlier updates", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "task-concurrent",
          mangaId: "test",
          chapters: [
            {
              id: "ch1",
              url: "ch1",
              title: "Chapter 1",
              index: 1,
              status: "queued",
              lastUpdated: Date.now(),
            },
            {
              id: "ch2",
              url: "ch2",
              title: "Chapter 2",
              index: 2,
              status: "queued",
              lastUpdated: Date.now(),
            },
          ],
          status: "downloading",
        })
      )

      await Promise.all([
        stateManager.updateDownloadTaskChapter(
          "task-concurrent",
          "ch1",
          "completed"
        ),
        stateManager.updateDownloadTaskChapter(
          "task-concurrent",
          "ch2",
          "completed"
        ),
      ])

      const globalState = await stateManager.getGlobalState()
      const task = globalState.downloadQueue.find(
        (t) => t.id === "task-concurrent"
      )

      expect(task?.chapters.map((chapter) => chapter.status)).toEqual([
        "completed",
        "completed",
      ])
    })
  })

  describe("downloadId constraints for task states", () => {
    it("lastSuccessfulDownloadId is only set on completed tasks", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "completed-task",
          mangaId: "test",
          status: "completed",
          completed: Date.now(),
          lastSuccessfulDownloadId: 12345,
        })
      )

      const globalState = await stateManager.getGlobalState()
      const task = globalState.downloadQueue.find(
        (t) => t.id === "completed-task"
      )

      expect(task?.status).toBe("completed")
      expect(task?.lastSuccessfulDownloadId).toBe(12345)
    })

    it("queued/downloading tasks do not have lastSuccessfulDownloadId", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "active-task",
          mangaId: "test",
          status: "downloading",
        })
      )

      const globalState = await stateManager.getGlobalState()
      const task = globalState.downloadQueue.find((t) => t.id === "active-task")

      expect(task?.lastSuccessfulDownloadId).toBeUndefined()
    })
  })

  describe("task audit trail storage", () => {
    it("stores chapter outcomes in task state", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "audit-task",
          mangaId: "test",
          chapters: [
            {
              id: "ch1",
              url: "ch1",
              title: "Chapter 1",
              index: 1,
              status: "completed",
              lastUpdated: Date.now(),
            },
            {
              id: "ch2",
              url: "ch2",
              title: "Chapter 2",
              index: 2,
              status: "failed",
              lastUpdated: Date.now(),
              errorMessage: "Network error",
            },
            {
              id: "ch3",
              url: "ch3",
              title: "Chapter 3",
              index: 3,
              status: "completed",
              lastUpdated: Date.now(),
            },
          ],
          status: "partial_success",
          completed: Date.now(),
        })
      )

      const globalState = await stateManager.getGlobalState()
      const task = globalState.downloadQueue.find((t) => t.id === "audit-task")

      expect(task?.chapters).toHaveLength(3)
      expect(task?.chapters[0].status).toBe("completed")
      expect(task?.chapters[1].status).toBe("failed")
      expect(task?.chapters[1].errorMessage).toBe("Network error")
    })
  })

  describe("multiple tasks for the same series", () => {
    it("allows multiple tasks for the same series", async () => {
      const { CentralizedStateManager } =
        await import("@/src/runtime/centralized-state")

      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()

      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "task-1",
          mangaId: "same-series",
          seriesTitle: "Same Manga",
          chapters: [
            {
              id: "ch1",
              url: "ch1",
              title: "Chapter 1",
              index: 1,
              status: "queued",
              lastUpdated: Date.now(),
            },
          ],
        })
      )

      await stateManager.addDownloadTask(
        makeDownloadTask({
          id: "task-2",
          mangaId: "same-series",
          seriesTitle: "Same Manga",
          chapters: [
            {
              id: "ch2",
              url: "ch2",
              title: "Chapter 2",
              index: 2,
              status: "queued",
              lastUpdated: Date.now(),
            },
          ],
        })
      )

      const globalState = await stateManager.getGlobalState()
      expect(globalState.downloadQueue).toHaveLength(2)

      const sameSeriesTasks = globalState.downloadQueue.filter(
        (t) => t.mangaId === "same-series"
      )
      expect(sameSeriesTasks).toHaveLength(2)
    })
  })
}
