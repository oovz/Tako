import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { historyRepository } from "./download-queue-test-setup"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { resolveDownloadPlan } from "@/entrypoints/background/queue-helpers"
import {
  continueDownloadTaskAfterChapterSettlement,
  createChapter,
  handleOffscreenJobTerminal,
  makeTask,
  mockEnsureOffscreenReady,
  mockEnsureSiteIntegrationNetworkReady,
  mockProviderNetworkPolicyContinuation,
  mockGlobalState,
  mockDestinationService,
  mockRateLimitService,
  mockNativeOutputCoordinator,
  mockRuntimeSendMessage,
  mockQueueRepository,
  processDownloadQueue,
  resumeProviderPolicyBlockedQueue,
  startDownloadTask,
  testSettings,
} from "./download-queue-test-setup"
import {
  ProviderNetworkPolicyActionRequiredError,
  ProviderNetworkPolicyPendingError,
} from "@/src/site-integrations/session-rule-manager"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"

type DispatchMessage = RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">
type TerminalOutcome =
  RuntimeMessageRequest<"OFFSCREEN_JOB_TERMINAL">["payload"]["outcome"]

const DOCUMENT_INSTANCE_ID = "document-1"

function dispatchAcknowledgement(
  message: DispatchMessage
): RuntimeMessageResponse<"OFFSCREEN_DOWNLOAD_CHAPTER"> {
  return {
    success: true,
    accepted: true,
    jobId: message.payload.jobId,
    attempt: message.payload.attempt,
    taskId: message.payload.taskId,
    chapterId: message.payload.chapter.id,
    fingerprint: message.payload.fingerprint,
    documentInstanceId: DOCUMENT_INSTANCE_ID,
  }
}

function installDispatchAcknowledgementResponder(): void {
  mockRuntimeSendMessage.mockImplementation(async (message) => {
    if (message?.type === "OFFSCREEN_DOWNLOAD_CHAPTER") {
      return dispatchAcknowledgement(message as DispatchMessage)
    }
    return { success: true }
  })
}

function dispatchedChapters(taskId: string): DispatchMessage[] {
  return mockRuntimeSendMessage.mock.calls
    .map(([message]) => message as DispatchMessage)
    .filter(
      (message): message is DispatchMessage =>
        message.type === "OFFSCREEN_DOWNLOAD_CHAPTER" &&
        message.payload.taskId === taskId
    )
}

async function settleAcceptedDispatch(
  message: DispatchMessage,
  outcome: TerminalOutcome = {
    status: "completed",
    outputsRequested: 1,
    outputsFailedBeforeHandoff: 0,
    outputsCommitted: 1,
  }
): Promise<void> {
  await handleOffscreenJobTerminal({
    stateManager: mockQueueRepository,
    nativeOutputCoordinator: mockNativeOutputCoordinator,
    ensureOffscreenReady: mockEnsureOffscreenReady,
    payload: {
      jobId: message.payload.jobId,
      attempt: message.payload.attempt,
      taskId: message.payload.taskId,
      chapterId: message.payload.chapter.id,
      fingerprint: message.payload.fingerprint,
      documentInstanceId: DOCUMENT_INSTANCE_ID,
      sequence: 1,
      stage: "saving",
      terminalAt: Date.now(),
      outcome,
    },
  })

  const task = await mockQueueRepository.getTask(message.payload.taskId)
  if (
    message.payload.saveMode === "downloads-api" &&
    task?.status === "downloading"
  ) {
    await continueDownloadTaskAfterChapterSettlement({
      stateManager: mockQueueRepository,
      taskId: message.payload.taskId,
      ensureOffscreenReady: mockEnsureOffscreenReady,
    })
  }
}

async function settleAllAcceptedDispatches(taskId: string): Promise<void> {
  const expectedCount =
    (await mockQueueRepository.getTask(taskId))?.chapters.length ?? 0
  for (let index = 0; index < expectedCount; index += 1) {
    const message = dispatchedChapters(taskId)[index]
    if (!message)
      throw new Error(`Missing acknowledged chapter dispatch ${index + 1}`)
    await settleAcceptedDispatch(message)
    const task = await mockQueueRepository.getTask(taskId)
    if (task?.status !== "downloading") return
  }
}

export function registerDownloadQueueStartAndProcessCases(): void {
  beforeEach(() => {
    installDispatchAcknowledgementResponder()
  })

  describe("startDownloadTask", () => {
    it.each([
      { label: "new", resumeExistingTask: false },
      { label: "recovered", resumeExistingTask: true },
    ])(
      "waits for provider network readiness before dispatching a $label task",
      async ({ resumeExistingTask }) => {
        let releaseReadiness!: () => void
        const readiness = new Promise<void>((resolve) => {
          releaseReadiness = resolve
        })
        mockEnsureSiteIntegrationNetworkReady.mockReturnValue(readiness)
        const task = makeTask({
          id: `task-network-ready-${String(resumeExistingTask)}`,
          siteIntegrationId: "manhuagui",
          status: resumeExistingTask ? "downloading" : "queued",
        })
        mockGlobalState.downloadQueue = [task]

        const taskPromise = startDownloadTask(
          mockQueueRepository,
          task.id,
          mockEnsureOffscreenReady,
          resumeExistingTask
        )
        await vi.waitFor(() =>
          expect(mockEnsureSiteIntegrationNetworkReady).toHaveBeenCalledWith(
            "manhuagui"
          )
        )

        expect(mockDestinationService.preflight).not.toHaveBeenCalled()
        expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
        expect(mockRuntimeSendMessage).not.toHaveBeenCalledWith(
          expect.objectContaining({ type: "OFFSCREEN_DOWNLOAD_CHAPTER" })
        )

        releaseReadiness()
        await taskPromise
        expect(mockEnsureOffscreenReady).toHaveBeenCalled()
      }
    )

    it("atomically unblocks every pending provider task and schedules the queue once", async () => {
      const firstTask = makeTask({
        id: "task-provider-policy-resume-1",
        siteIntegrationId: "manhuagui",
        status: "queued",
        activeBlock: "provider_network_policy_pending",
      })
      const secondTask = makeTask({
        id: "task-provider-policy-resume-2",
        siteIntegrationId: "pixiv-comic",
        status: "queued",
        activeBlock: "provider_network_policy_pending",
      })
      const actionRequiredTask = makeTask({
        id: "task-provider-policy-action",
        status: "queued",
        activeBlock: "provider_network_policy_action_required",
      })
      mockGlobalState.downloadQueue = [
        firstTask,
        secondTask,
        actionRequiredTask,
      ]
      await chrome.storage.session.set({
        [SESSION_STORAGE_KEYS.providerNetworkPolicyContinuation]: {
          revision: 1,
        },
      })

      await resumeProviderPolicyBlockedQueue(
        mockQueueRepository,
        mockEnsureOffscreenReady
      )

      expect(
        mockQueueRepository.releaseProviderPolicyBlocks
      ).toHaveBeenCalledOnce()
      expect(mockGlobalState.downloadQueue).toMatchObject([
        { id: firstTask.id, activeBlock: undefined },
        { id: secondTask.id, activeBlock: undefined },
        {
          id: actionRequiredTask.id,
          activeBlock: "provider_network_policy_action_required",
        },
      ])
      await vi.waitFor(() =>
        expect(
          mockEnsureSiteIntegrationNetworkReady.mock.calls.length
        ).toBeGreaterThanOrEqual(2)
      )
      expect(mockEnsureSiteIntegrationNetworkReady).toHaveBeenCalledWith(
        "manhuagui"
      )
      expect(mockEnsureOffscreenReady).toHaveBeenCalled()
      expect(
        mockProviderNetworkPolicyContinuation.clearContinuation
      ).toHaveBeenCalledWith(1)
    })

    it("clears the continuation when no runnable task remains after unblocking", async () => {
      const task = makeTask({
        id: "task-provider-policy-no-runnable",
        status: "queued",
        activeBlock: "provider_network_policy_action_required",
      })
      mockGlobalState.downloadQueue = [task]
      await chrome.storage.session.set({
        [SESSION_STORAGE_KEYS.providerNetworkPolicyContinuation]: {
          revision: 1,
        },
      })

      await resumeProviderPolicyBlockedQueue(
        mockQueueRepository,
        mockEnsureOffscreenReady
      )

      expect(
        mockProviderNetworkPolicyContinuation.clearContinuation
      ).toHaveBeenCalledWith(1)
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
    })

    it("should start a valid download task", async () => {
      const task = makeTask({ id: "task-1" })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockQueueRepository,
        "task-1",
        mockEnsureOffscreenReady
      )

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1" })
      )
      expect(mockEnsureOffscreenReady).toHaveBeenCalled()
      expect(mockQueueRepository.beginChapterDispatch).toHaveBeenCalled()
      const dispatch = dispatchedChapters(task.id)[0]!
      await expect(
        mockQueueRepository.getActiveDispatchLease()
      ).resolves.toMatchObject({
        jobId: dispatch.payload.jobId,
        attempt: dispatch.payload.attempt,
        taskId: dispatch.payload.taskId,
        chapterId: dispatch.payload.chapter.id,
        fingerprint: dispatch.payload.fingerprint,
        documentInstanceId: DOCUMENT_INSTANCE_ID,
      })
    })

    it("returns a transient provider-policy failure to a blocked queued state", async () => {
      const task = makeTask({
        id: "task-provider-network-policy-pending",
        siteIntegrationId: "manhuagui",
        status: "queued",
      })
      mockGlobalState.downloadQueue = [task]
      mockEnsureSiteIntegrationNetworkReady.mockRejectedValueOnce(
        new ProviderNetworkPolicyPendingError(
          "manhuagui",
          new Error("DNR temporarily unavailable")
        )
      )

      await startDownloadTask(
        mockQueueRepository,
        task.id,
        mockEnsureOffscreenReady
      )

      expect(
        mockQueueRepository.blockTaskForProviderPolicy
      ).toHaveBeenCalledWith({
        taskId: task.id,
        block: "provider_network_policy_pending",
      })
      expect(mockGlobalState.downloadQueue[0]).toMatchObject({
        status: "queued",
        activeBlock: "provider_network_policy_pending",
      })
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
    })

    it("terminalizes a definitive provider host-access denial", async () => {
      const task = makeTask({
        id: "task-provider-network-policy-action",
        siteIntegrationId: "manhuagui",
        status: "queued",
      })
      mockGlobalState.downloadQueue = [task]
      mockEnsureSiteIntegrationNetworkReady.mockRejectedValueOnce(
        new ProviderNetworkPolicyActionRequiredError(
          "manhuagui",
          "host_permission_denied"
        )
      )

      await startDownloadTask(
        mockQueueRepository,
        task.id,
        mockEnsureOffscreenReady
      )

      expect(mockGlobalState.downloadQueue[0]).toMatchObject({
        status: "failed",
        activeBlock: undefined,
        completed: expect.any(Number),
      })
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
    })

    it("leaves terminal event state recoverable when finalization persistence fails", async () => {
      const fsaSettings = {
        ...createTaskSettingsSnapshot(testSettings, "test-site"),
        destination: "file-system-access" as const,
      }
      const interruptedTask = makeTask({
        id: "task-finalization-failure",
        created: 1,
        settingsSnapshot: fsaSettings,
      })
      const nextTask = makeTask({
        id: "task-after-finalization-failure",
        mangaId: "series-2",
        created: 2,
        settingsSnapshot: fsaSettings,
      })
      mockGlobalState.downloadQueue = [interruptedTask, nextTask]
      vi.mocked(
        mockDestinationService.getEffectiveDestination
      ).mockResolvedValue({
        kind: "custom",
        handleId: "root",
        handle: {} as FileSystemDirectoryHandle,
      })
      const finalization = vi
        .spyOn(mockQueueRepository, "finalizeDownloadTask")
        .mockRejectedValueOnce(new Error("finalization commit failed"))

      try {
        await startDownloadTask(
          mockQueueRepository,
          interruptedTask.id,
          mockEnsureOffscreenReady
        )

        const dispatch = dispatchedChapters(interruptedTask.id)[0]!
        await expect(
          settleAcceptedDispatch(dispatch, {
            status: "failed",
            errorMessage: "chapter dispatch failed",
            errorCategory: "unknown",
            outputsRequested: 0,
            outputsFailedBeforeHandoff: 0,
            outputsCommitted: 0,
          })
        ).rejects.toThrow("finalization commit failed")

        const admittedLease = vi
          .mocked(mockQueueRepository.beginChapterDispatch)
          .mock.calls.find(
            ([input]) => input.taskId === interruptedTask.id
          )?.[0].lease
        expect(admittedLease).toBeDefined()
        expect(
          mockGlobalState.downloadQueue.find(
            (task) => task.id === interruptedTask.id
          )
        ).toMatchObject({
          status: "downloading",
          chapters: [
            expect.objectContaining({
              status: "failed",
              errorMessage: "chapter dispatch failed",
            }),
          ],
        })
        expect(await mockQueueRepository.getActiveDispatchLease()).toBeNull()
        expect(mockEnsureOffscreenReady).toHaveBeenCalledTimes(1)
        expect(
          mockGlobalState.downloadQueue.find((task) => task.id === nextTask.id)
        ).toMatchObject({ status: "queued" })
        const dispatchedTaskIds = mockRuntimeSendMessage.mock.calls
          .map(([message]) => message)
          .filter((message) => message?.type === "OFFSCREEN_DOWNLOAD_CHAPTER")
          .map((message) => message.payload.taskId)
        expect(dispatchedTaskIds).toEqual([interruptedTask.id])
      } finally {
        finalization.mockRestore()
      }
    })

    it("leaves native chapter history to the sole settlement callback", async () => {
      const task = makeTask({ id: "task-history-write-retry" })
      mockGlobalState.downloadQueue = [task]
      await startDownloadTask(
        mockQueueRepository,
        task.id,
        mockEnsureOffscreenReady
      )
      await settleAcceptedDispatch(dispatchedChapters(task.id)[0]!)

      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({ status: "completed" })
      )
      expect(mockGlobalState.downloadQueue[0]?.chapters[0]).toEqual(
        expect.objectContaining({ status: "completed" })
      )
      expect(historyRepository.markChapterAsDownloaded).not.toHaveBeenCalled()
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
      vi.mocked(
        mockDestinationService.getEffectiveDestination
      ).mockResolvedValue({
        kind: "custom",
        handleId: "root",
        handle: {} as FileSystemDirectoryHandle,
      })
      await startDownloadTask(
        mockQueueRepository,
        task.id,
        mockEnsureOffscreenReady
      )
      await settleAllAcceptedDispatches(task.id)

      const saveModes = mockRuntimeSendMessage.mock.calls
        .filter(([message]) => message.type === "OFFSCREEN_DOWNLOAD_CHAPTER")
        .map(([message]) => message.payload.saveMode)
      expect(saveModes).toEqual(["fsa", "fsa"])
      expect(
        mockDestinationService.getEffectiveDestination
      ).toHaveBeenCalledTimes(2)
      for (const [context] of vi.mocked(
        mockDestinationService.getEffectiveDestination
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
      vi.mocked(mockDestinationService.preflight).mockResolvedValue({
        ready: false,
        reason: "permission_prompt",
      })

      await startDownloadTask(
        mockQueueRepository,
        task.id,
        mockEnsureOffscreenReady
      )

      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({
          status: "queued",
          activeBlock: "destination_action_required",
        })
      )
      expect(
        mockDestinationService.recordDestinationIssue
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.id,
          destination: "file-system-access",
        }),
        { ready: false, reason: "permission_prompt" }
      )
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
      expect(mockQueueRepository.beginChapterDispatch).not.toHaveBeenCalled()
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
      vi.mocked(
        mockDestinationService.getEffectiveDestination
      ).mockResolvedValue({
        kind: "custom",
        handleId: "root",
        handle: {} as FileSystemDirectoryHandle,
      })
      await startDownloadTask(
        mockQueueRepository,
        task.id,
        mockEnsureOffscreenReady
      )
      await settleAcceptedDispatch(dispatchedChapters(task.id)[0]!, {
        status: "failed",
        errorCategory: "folder_permission_required",
        errorMessage: "Folder permission is required.",
        imagesFailed: 1,
        outputsRequested: 1,
        outputsCommitted: 0,
        outputsFailedBeforeHandoff: 1,
      })

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
      expect(
        mockDestinationService.recordDestinationRuntimeIssue
      ).toHaveBeenCalledWith(
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
      vi.mocked(
        mockDestinationService.getEffectiveDestination
      ).mockResolvedValue({
        kind: "custom",
        handleId: "root",
        handle: {} as FileSystemDirectoryHandle,
      })
      await startDownloadTask(
        mockQueueRepository,
        task.id,
        mockEnsureOffscreenReady
      )
      await settleAcceptedDispatch(dispatchedChapters(task.id)[0]!, {
        status: "failed",
        errorCategory: "folder_write_failed",
        errorMessage: "Tako could not write to the selected folder.",
        outputsRequested: 1,
        outputsCommitted: 0,
        outputsFailedBeforeHandoff: 0,
      })

      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({
          status: "queued",
          activeBlock: "destination_action_required",
          errorCategory: "folder_write_failed",
        })
      )
      expect(
        mockDestinationService.recordDestinationRuntimeIssue
      ).toHaveBeenCalledWith(
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
      const defaultPlan = await vi.mocked(resolveDownloadPlan)(newTask)
      vi.mocked(resolveDownloadPlan).mockResolvedValueOnce({
        ...defaultPlan,
        chapters: [
          {
            ...defaultPlan.chapters[0]!,
            id: newTask.chapters[0]!.id,
            url: newTask.chapters[0]!.url,
            title: newTask.chapters[0]!.title,
            chapterNumber: newTask.chapters[0]!.chapterNumber,
          },
        ],
      })

      mockGlobalState.downloadQueue = [existingTask, newTask]

      await startDownloadTask(
        mockQueueRepository,
        "task-2",
        mockEnsureOffscreenReady
      )

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-2" })
      )
      expect(mockEnsureOffscreenReady).toHaveBeenCalled()
      expect(mockQueueRepository.beginChapterDispatch).toHaveBeenCalled()
    })

    it("should start queued task regardless of tab origin", async () => {
      const task = makeTask({ id: "task-1" })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockQueueRepository,
        "task-1",
        mockEnsureOffscreenReady
      )

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1" })
      )
      expect(mockEnsureOffscreenReady).toHaveBeenCalled()
      expect(
        mockQueueRepository.applyNativeOutputSettlement
      ).not.toHaveBeenCalled()
      expect(mockGlobalState.downloadQueue[0]).toMatchObject({
        status: "downloading",
        chapters: [expect.objectContaining({ status: "downloading" })],
      })
    })

    it("should handle task not found error", async () => {
      mockGlobalState.downloadQueue = []

      await startDownloadTask(
        mockQueueRepository,
        "non-existent",
        mockEnsureOffscreenReady
      )

      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
    })

    it("does not dispatch a chapter when cancellation wins the atomic start update", async () => {
      const task = makeTask({ id: "task-cancel-race" })
      mockGlobalState.downloadQueue = [task]
      vi.mocked(mockQueueRepository.beginChapterDispatch).mockResolvedValueOnce(
        {
          outcome: "rejected",
          reason: "task-not-active",
          currentStatus: "canceled",
        }
      )

      await startDownloadTask(
        mockQueueRepository,
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
        mockQueueRepository,
        "task-1",
        mockEnsureOffscreenReady
      )

      expect(mockQueueRepository.interruptDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
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
        mockQueueRepository,
        "task-1",
        mockEnsureOffscreenReady
      )

      expect(mockQueueRepository.settleTaskChapter).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          status: "failed",
          chapterId: task.chapters[0]?.id,
          updates: expect.objectContaining({
            errorMessage: "Chapter title missing",
          }),
        })
      )
      expect(mockQueueRepository.recordTaskDispatchError).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          errorMessage: "Chapter title missing",
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
        mockQueueRepository,
        "task-date-macros",
        mockEnsureOffscreenReady
      )
      await settleAllAcceptedDispatches(task.id)

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
        mockQueueRepository,
        "task-index-test",
        mockEnsureOffscreenReady
      )
      await settleAllAcceptedDispatches(task.id)

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
        mockQueueRepository,
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

    it("dispatches chapters sequentially", async () => {
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
        async (message: DispatchMessage) => {
          if (message?.type !== "OFFSCREEN_DOWNLOAD_CHAPTER") {
            return { success: true }
          }

          const chapterId = message.payload.chapter.id
          dispatchOrder.push(`start:${chapterId}`)
          inFlightDispatches += 1
          maxInFlightDispatches = Math.max(
            maxInFlightDispatches,
            inFlightDispatches
          )

          await new Promise((resolve) => setTimeout(resolve, 5))

          inFlightDispatches -= 1
          dispatchOrder.push(`end:${chapterId}`)
          return dispatchAcknowledgement(message)
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
            chapter: { concurrency: 1, delayMs: 0 },
          },
        },
      })

      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockQueueRepository,
        "task-sequential-dispatch",
        mockEnsureOffscreenReady
      )
      await settleAllAcceptedDispatches(task.id)

      expect(maxInFlightDispatches).toBe(1)
      expect(
        dispatchOrder.filter((entry) => entry.startsWith("start:"))
      ).toHaveLength(3)
      expect(
        dispatchOrder.filter((entry) => entry.startsWith("end:"))
      ).toHaveLength(3)
    })

    it("rechecks provider enablement before dispatching each chapter", async () => {
      const { resolveDownloadPlan } =
        await import("@/entrypoints/background/queue-helpers")
      vi.mocked(resolveDownloadPlan).mockResolvedValue({
        format: "cbz",
        book: {
          siteId: "test-site",
          seriesId: "series-1",
          seriesTitle: "Provider Toggle Series",
          comicInfoBase: { Series: "Provider Toggle Series" },
        },
        chapters: [
          {
            id: "ch1",
            url: "https://example.com/ch1",
            title: "Chapter 1",
            chapterNumber: 1,
            resolvedPath: "Chapter 1.cbz",
            comicInfo: { Series: "Provider Toggle Series" },
          },
          {
            id: "ch2",
            url: "https://example.com/ch2",
            title: "Chapter 2",
            chapterNumber: 2,
            resolvedPath: "Chapter 2.cbz",
            comicInfo: { Series: "Provider Toggle Series" },
          },
        ],
      })

      let enablementReads = 0
      const readLocalStorage = vi
        .mocked(chrome.storage.local.get)
        .getMockImplementation() as (
        key: string | string[]
      ) => Promise<Record<string, unknown>>
      vi.mocked(chrome.storage.local.get).mockImplementation(async (key) => {
        if (key === "siteIntegrationEnablement") {
          const enabled = enablementReads++ < 2
          return { siteIntegrationEnablement: { "test-site": enabled } }
        }
        return await readLocalStorage(key as string | string[])
      })

      const task = makeTask({
        id: "task-provider-toggle",
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
      })
      mockGlobalState.downloadQueue = [task]

      await startDownloadTask(
        mockQueueRepository,
        task.id,
        mockEnsureOffscreenReady
      )
      await settleAcceptedDispatch(dispatchedChapters(task.id)[0]!)
      const chapterDispatches = mockRuntimeSendMessage.mock.calls.filter(
        (call) => call?.[0]?.type === "OFFSCREEN_DOWNLOAD_CHAPTER"
      )
      expect(chapterDispatches).toHaveLength(1)
      expect(chapterDispatches[0]?.[0]?.payload?.chapter?.id).toBe("ch1")
      expect(mockQueueRepository.beginChapterDispatch).toHaveBeenCalledTimes(1)
      expect(await mockQueueRepository.getActiveDispatchLease()).toBeNull()
      expect(enablementReads).toBe(3)
      expect(mockGlobalState.downloadQueue[0]).toMatchObject({
        status: "partial_success",
        chapters: [
          { id: "ch1", status: "completed" },
          { id: "ch2", status: "failed" },
        ],
      })
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
        mockQueueRepository,
        "task-durable-delay",
        mockEnsureOffscreenReady
      )
      await settleAcceptedDispatch(dispatchedChapters(task.id)[0]!)

      const dispatches = dispatchedChapters(task.id)
      expect(dispatches).toHaveLength(2)
      expect(dispatches[0]?.payload?.notBefore).toBeUndefined()
      expect(dispatches[1]?.payload?.notBefore).toBe(10_750)
      expect(mockQueueRepository.setNextChapterDispatchAt).toHaveBeenCalledWith(
        {
          taskId: "task-durable-delay",
          nextChapterDispatchAt: 10_750,
        }
      )
      expect(mockGlobalState.downloadQueue[0]?.nextChapterDispatchAt).toBe(
        10_750
      )
      await settleAcceptedDispatch(dispatches[1]!)
      expect(
        mockGlobalState.downloadQueue[0]?.nextChapterDispatchAt
      ).toBeUndefined()
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
            return { success: true }
          }

          // Simulate liveness recovery committing its terminal transition while
          // the sendMessage is pending.
          await mockQueueRepository.interruptDownloadTask({
            taskId: "task-liveness-race",
            errorMessage: "Download process unresponsive",
            now: Date.now(),
          })

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
        mockQueueRepository,
        "task-liveness-race",
        mockEnsureOffscreenReady
      )

      // The chapter should retain the liveness recovery error, not the
      // "message channel closed" sendMessage rejection.
      const chapterUpdateCalls = vi
        .mocked(mockQueueRepository.settleTaskChapter)
        .mock.calls.filter(([input]) => input.chapterId === "ch1")
      const failedChapterUpdates = chapterUpdateCalls.filter(
        ([input]) =>
          input.status === "failed" &&
          input.updates?.errorMessage ===
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
            return { success: true }
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
        mockQueueRepository,
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
      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1" })
      )
      expect(dispatchedChapters("task-1")).toHaveLength(1)
      expect(
        mockQueueRepository.applyNativeOutputSettlement
      ).not.toHaveBeenCalled()
      expect(mockGlobalState.downloadQueue).toMatchObject([
        { id: "task-1", status: "downloading" },
        { id: "task-2", status: "queued" },
      ])
    })

    it.each([
      "destination_action_required",
      "provider_network_policy_pending",
    ] as const)(
      "skips a queued task blocked by %s and starts the next runnable task",
      async (activeBlock) => {
        mockGlobalState.downloadQueue = [
          makeTask({
            id: "blocked-task",
            activeBlock,
          }),
          makeTask({
            id: "runnable-task",
            mangaId: "series-2",
          }),
        ]

        await processDownloadQueue(
          mockQueueRepository,
          mockEnsureOffscreenReady
        )

        expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
          expect.objectContaining({ taskId: "runnable-task" })
        )
        expect(
          vi
            .mocked(mockQueueRepository.startDownloadTask)
            .mock.calls.some(([input]) => input.taskId === "blocked-task")
        ).toBe(false)
      }
    )

    it("skips a head task that becomes destination-blocked during admission", async () => {
      const blockedTask = makeTask({
        id: "dynamic-blocked-task",
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(testSettings, "test-site"),
          destination: "file-system-access",
        },
      })
      const runnableTask = makeTask({
        id: "dynamic-runnable-task",
        mangaId: "series-2",
      })
      mockGlobalState.downloadQueue = [blockedTask, runnableTask]
      vi.mocked(mockDestinationService.preflight)
        .mockResolvedValueOnce({ ready: false, reason: "permission_prompt" })
        .mockResolvedValue({ ready: true })

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockGlobalState.downloadQueue).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: blockedTask.id,
            status: "queued",
            activeBlock: "destination_action_required",
          }),
          expect.objectContaining({
            id: runnableTask.id,
            status: "downloading",
          }),
        ])
      )
    })

    it("does not count a legacy blocked downloading task as the active slot", async () => {
      mockGlobalState.downloadQueue = [
        makeTask({
          id: "blocked-task",
          status: "downloading",
          activeBlock: "provider_network_policy_pending",
        }),
        makeTask({
          id: "runnable-task",
          mangaId: "series-2",
        }),
      ]

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "runnable-task" })
      )
    })

    it("waits for a native output task before starting the next task", async () => {
      mockGlobalState.downloadQueue = [
        makeTask({
          id: "native-output-task",
          status: "downloading",
        }),
        makeTask({
          id: "next-task",
          mangaId: "series-2",
        }),
      ]
      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).not.toHaveBeenCalled()
      expect(mockGlobalState.downloadQueue).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "native-output-task",
            status: "downloading",
          }),
          expect.objectContaining({
            id: "next-task",
            status: "queued",
          }),
        ])
      )
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
      await mockQueueRepository.beginChapterDispatch({
        taskId: "task-1",
        chapterId: tasks[0]!.chapters[0]!.id,
        expectedPreviousLease: null,
        lease: createDispatchLease({
          jobId: "active-job",
          attempt: 1,
          taskId: "task-1",
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

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1" })
      )
      const startedTaskIds = vi
        .mocked(mockQueueRepository.startDownloadTask)
        .mock.calls.map(([input]) => input.taskId)
      expect(startedTaskIds).not.toContain("task-2")
      expect(startedTaskIds).not.toContain("task-3")
    })

    it("should skip processing when no queued tasks", async () => {
      mockGlobalState.downloadQueue = [
        makeTask({ id: "task-1", status: "completed", completed: Date.now() }),
      ]

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).not.toHaveBeenCalled()
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

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockRateLimitService.resolveEffectivePolicy).not.toHaveBeenCalled()
      expect(
        mockRateLimitService.scheduleForIntegrationScope
      ).not.toHaveBeenCalled()

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-rate-limited" })
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

      vi.mocked(
        mockRateLimitService.scheduleForIntegrationScope
      ).mockImplementationOnce(() => new Promise(() => undefined))

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockRateLimitService.resolveEffectivePolicy).not.toHaveBeenCalled()
      expect(
        mockRateLimitService.scheduleForIntegrationScope
      ).not.toHaveBeenCalled()
      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "replacement-task" })
      )
    })

    it("rejects when the repository cannot read the durable queue", async () => {
      const storageError = new Error("queue storage unavailable")
      vi.mocked(mockQueueRepository.getQueue).mockRejectedValueOnce(
        storageError
      )

      await expect(
        processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)
      ).rejects.toBe(storageError)
    })
  })
}
