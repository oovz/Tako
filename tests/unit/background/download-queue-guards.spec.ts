/**
 * Adversarial Tests: Download Queue Guards
 *
 * Covers:
 *  - Guard 1: MAX_CONCURRENT_QUEUED_TASKS (queue overload protection)
 *    Source: src/domain/queue/scheduler-policy.ts
 *    Enforcement: entrypoints/background/queue-scheduler.ts
 *  - Guard 4: Chapter delay enforcement
 *    Source: persisted task settings
 *    Enforcement: entrypoints/background/download-task-executor.ts
 */
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { QueueRepository } from "@/src/storage/queue-repository"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  continueDownloadTaskAfterChapterSettlement,
  createChapter,
  failDisabledProviderTasks,
  handleOffscreenJobTerminal,
  makeTask,
  mockEnsureOffscreenReady,
  mockGlobalState,
  mockNativeOutputCoordinator,
  mockRunOffscreenDocumentAdmissionExclusive,
  mockRuntimeSendMessage,
  mockQueueRepository,
  mockDestinationService,
  mockSiteIntegrationEnablementService,
  processDownloadQueue,
  resetDownloadQueueTestEnvironment,
  startDownloadTask,
  testSettings,
} from "./download-queue-test-setup"

type StartDownloadTaskResult = Awaited<
  ReturnType<QueueRepository["startDownloadTask"]>
>
type DispatchMessage = RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">
type TerminalOutcome =
  RuntimeMessageRequest<"OFFSCREEN_JOB_TERMINAL">["payload"]["outcome"]

const DOCUMENT_INSTANCE_ID = "queue-guards-document-1"

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
    if (!message) {
      throw new Error(`Missing acknowledged chapter dispatch ${index + 1}`)
    }
    await settleAcceptedDispatch(message)
  }
}

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
vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  getBackgroundSiteAdapterById: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/src/site-integrations/catalog", () => ({
  getDefinition: () => ({
    runtimes: { dispatchContext: { mode: "none" } },
  }),
  isEnabled: (id: string, enablement: Record<string, boolean> = {}): boolean =>
    enablement[id] ?? id !== "mangadex",
}))
describe("Download Queue Guards", () => {
  beforeEach(async () => {
    await resetDownloadQueueTestEnvironment()
    mockSiteIntegrationEnablementService.getAll.mockResolvedValue({})
    installDispatchAcknowledgementResponder()
  })

  describe("MAX_CONCURRENT_QUEUED_TASKS (queue overload protection)", () => {
    it("does not dispatch when the queued-to-downloading transition loses a cancellation race", async () => {
      const queuedTask = makeTask({
        id: "canceled-before-start",
        status: "queued",
      })
      mockGlobalState.downloadQueue = [queuedTask]
      vi.mocked(mockQueueRepository.startDownloadTask).mockResolvedValueOnce({
        outcome: "rejected",
        reason: "task-not-runnable",
        currentStatus: "canceled",
      })

      await startDownloadTask(
        mockQueueRepository,
        queuedTask.id,
        mockEnsureOffscreenReady
      )

      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
    })

    it("awaits the durable start commit before admission or offscreen effects", async () => {
      const queuedTask = makeTask({ id: "durable-start" })
      mockGlobalState.downloadQueue = [queuedTask]
      let resolveStart!: (result: StartDownloadTaskResult) => void
      const startCommit = new Promise<StartDownloadTaskResult>((resolve) => {
        resolveStart = resolve
      })
      vi.mocked(mockQueueRepository.startDownloadTask).mockReturnValueOnce(
        startCommit
      )

      const run = startDownloadTask(
        mockQueueRepository,
        queuedTask.id,
        mockEnsureOffscreenReady
      )
      await vi.waitFor(() =>
        expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledOnce()
      )

      expect(mockSiteIntegrationEnablementService.getAll).not.toHaveBeenCalled()
      expect(mockDestinationService.preflight).not.toHaveBeenCalled()
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()

      const startedTask = {
        ...queuedTask,
        status: "downloading" as const,
        started: Date.now(),
      }
      mockGlobalState.downloadQueue = [startedTask]
      resolveStart({ outcome: "applied", task: startedTask })
      await run

      expect(mockSiteIntegrationEnablementService.getAll).toHaveBeenCalled()
      expect(mockEnsureOffscreenReady).toHaveBeenCalled()
    })

    it("fails a disabled queued task before offscreen execution", async () => {
      const queuedTask = makeTask({
        id: "disabled-before-start",
        siteIntegrationId: "mangadex",
        status: "queued",
      })
      mockGlobalState.downloadQueue = [queuedTask]
      mockSiteIntegrationEnablementService.getAll.mockResolvedValue({
        mangadex: false,
      })

      await startDownloadTask(
        mockQueueRepository,
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

    it("applies the manifest default when an enablement override is absent", async () => {
      const queuedTask = makeTask({
        id: "default-disabled-before-start",
        siteIntegrationId: "mangadex",
        status: "queued",
      })
      mockGlobalState.downloadQueue = [queuedTask]
      mockSiteIntegrationEnablementService.getAll.mockResolvedValue({})

      await startDownloadTask(
        mockQueueRepository,
        queuedTask.id,
        mockEnsureOffscreenReady
      )

      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({
          status: "failed",
          errorMessage: "Integration disabled",
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
      mockSiteIntegrationEnablementService.getAll.mockResolvedValue({
        mangadex: false,
      })

      await startDownloadTask(
        mockQueueRepository,
        resumedTask.id,
        mockEnsureOffscreenReady,
        true
      )

      expect(mockQueueRepository.interruptDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: resumedTask.id,
          errorMessage: "Integration disabled",
        })
      )
      expect(mockGlobalState.downloadQueue[0]).toEqual(
        expect.objectContaining({ status: "failed" })
      )
      expect(mockEnsureOffscreenReady).not.toHaveBeenCalled()
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
    })

    it("orders an internal interruption before exact producer and native cleanup", async () => {
      const task = makeTask({
        id: "internal-interruption-with-lease",
        status: "downloading",
        started: Date.now() - 5_000,
      })
      mockGlobalState.downloadQueue = [task]
      const lease = createDispatchLease({
        jobId: "internal-job",
        attempt: 1,
        taskId: task.id,
        chapterId: task.chapters[0]!.id,
        fingerprint: "c".repeat(64),
        saveMode: "downloads-api",
        now: Date.now(),
      })
      await mockQueueRepository.beginChapterDispatch({
        taskId: task.id,
        chapterId: task.chapters[0]!.id,
        expectedPreviousLease: null,
        lease,
        now: Date.now(),
      })
      await mockQueueRepository.bindDispatchLeaseIncarnation({
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        fingerprint: lease.fingerprint,
        documentInstanceId: DOCUMENT_INSTANCE_ID,
      })
      mockSiteIntegrationEnablementService.getAll.mockRejectedValueOnce(
        new Error("enablement storage unavailable")
      )
      mockRuntimeSendMessage.mockImplementation(async (message) => {
        if (message?.type === "OFFSCREEN_CANCEL_JOB") {
          return {
            success: true,
            canceled: true,
            ...message.payload,
            status: "canceled",
            lastSequence: 1,
          }
        }
        return { success: true }
      })

      await startDownloadTask(
        mockQueueRepository,
        task.id,
        mockEnsureOffscreenReady,
        true
      )

      expect(mockQueueRepository.interruptDownloadTask).toHaveBeenCalledWith({
        taskId: task.id,
        errorMessage: "enablement storage unavailable",
        now: expect.any(Number),
      })
      const cancellationCall = mockRuntimeSendMessage.mock.calls.find(
        ([message]) => message?.type === "OFFSCREEN_CANCEL_JOB"
      )
      expect(cancellationCall?.[0]).toEqual({
        target: "offscreen",
        type: "OFFSCREEN_CANCEL_JOB",
        payload: {
          jobId: lease.jobId,
          attempt: lease.attempt,
          taskId: lease.taskId,
          chapterId: lease.chapterId,
          fingerprint: lease.fingerprint,
          documentInstanceId: DOCUMENT_INSTANCE_ID,
        },
      })
      expect(mockQueueRepository.clearDispatchLease).toHaveBeenCalledWith(
        expect.objectContaining({
          ...lease,
          documentInstanceId: DOCUMENT_INSTANCE_ID,
        })
      )
      expect(mockNativeOutputCoordinator.cancelTask).toHaveBeenCalledWith(
        task.id,
        {
          jobId: lease.jobId,
          attempt: lease.attempt,
          taskId: lease.taskId,
          chapterId: lease.chapterId,
          fingerprint: lease.fingerprint,
          documentInstanceId: DOCUMENT_INSTANCE_ID,
        }
      )
      expect(
        vi
          .mocked(mockQueueRepository.interruptDownloadTask)
          .mock.invocationCallOrder.at(-1)
      ).toBeLessThan(
        mockRuntimeSendMessage.mock.invocationCallOrder.find(
          (_, index) =>
            mockRuntimeSendMessage.mock.calls[index]?.[0]?.type ===
            "OFFSCREEN_CANCEL_JOB"
        )!
      )
    })

    it("serializes a terminal interruption read before chapter admission authority", async () => {
      const { resolveDownloadPlan } =
        await import("@/entrypoints/background/queue-helpers")
      const task = makeTask({ id: "interruption-admission-race" })
      mockGlobalState.downloadQueue = [task]

      let signalPlanRead!: () => void
      let releasePlan!: () => void
      const planRead = new Promise<void>((resolve) => {
        signalPlanRead = resolve
      })
      const planRelease = new Promise<void>((resolve) => {
        releasePlan = resolve
      })
      const resolvedPlan = await vi.mocked(resolveDownloadPlan)(task)
      vi.mocked(resolveDownloadPlan).mockImplementationOnce(async () => {
        signalPlanRead()
        await planRelease
        return resolvedPlan
      })

      let signalInterruptionRead!: () => void
      let releaseTerminalCommit!: () => void
      const interruptionRead = new Promise<void>((resolve) => {
        signalInterruptionRead = resolve
      })
      const terminalCommitRelease = new Promise<void>((resolve) => {
        releaseTerminalCommit = resolve
      })
      vi.mocked(
        mockQueueRepository.interruptDownloadTask
      ).mockImplementationOnce(async (input) => {
        signalInterruptionRead()
        await terminalCommitRelease
        return await QueueRepository.prototype.interruptDownloadTask.call(
          mockQueueRepository,
          input
        )
      })

      const start = startDownloadTask(
        mockQueueRepository,
        task.id,
        mockEnsureOffscreenReady
      )
      await planRead
      const interruption = failDisabledProviderTasks(
        mockQueueRepository,
        mockNativeOutputCoordinator,
        { "test-site": false },
        mockEnsureOffscreenReady
      )
      await interruptionRead

      releasePlan()
      for (let turn = 0; turn < 20; turn += 1) {
        await Promise.resolve()
      }
      releaseTerminalCommit()
      await interruption
      await start

      expect(mockQueueRepository.beginChapterDispatch).not.toHaveBeenCalled()
      expect(mockRunOffscreenDocumentAdmissionExclusive).not.toHaveBeenCalled()
      expect(dispatchedChapters(task.id)).toEqual([])
      expect(mockNativeOutputCoordinator.cancelTask).not.toHaveBeenCalled()
      expect(mockNativeOutputCoordinator.armLiveness).not.toHaveBeenCalled()
      expect(await mockQueueRepository.getActiveDispatchLease()).toBeNull()
      expect(await mockQueueRepository.getTask(task.id)).toMatchObject({
        status: "failed",
        errorMessage: "Integration disabled",
      })
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
      mockSiteIntegrationEnablementService.getAll.mockResolvedValue({
        mangadex: false,
      })
      vi.mocked(mockDestinationService.preflight).mockResolvedValue({
        ready: false,
        reason: "permission_prompt",
      })

      await startDownloadTask(
        mockQueueRepository,
        resumedTask.id,
        mockEnsureOffscreenReady,
        true
      )

      expect(mockDestinationService.preflight).not.toHaveBeenCalled()
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

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      // The already-downloading task must not be re-started, and the queued
      // task must not be started while a download is in flight.
      expect(mockQueueRepository.startDownloadTask).not.toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "queued-task" })
      )
      expect(mockRuntimeSendMessage).not.toHaveBeenCalled()
    })

    it("waits while a task is still owned by native output", async () => {
      mockGlobalState.downloadQueue = [
        makeTask({
          id: "native-output-task",
          status: "downloading",
          started: Date.now() - 1000,
        }),
        makeTask({ id: "queued-task-1", mangaId: "series-2" }),
        makeTask({ id: "queued-task-2", mangaId: "series-3" }),
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
            id: "queued-task-1",
            status: "queued",
          }),
          expect.objectContaining({
            id: "queued-task-2",
            status: "queued",
          }),
        ])
      )
      expect(dispatchedChapters("queued-task-1")).toEqual([])
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

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "second-task" })
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

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      // Only one task may transition to downloading in a single processing pass.
      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledTimes(1)
      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-0" })
      )
    })

    it("does not start any task when the active slot is occupied by a downloading task", async () => {
      mockGlobalState.downloadQueue = [
        makeTask({ id: "running", status: "downloading", started: Date.now() }),
        makeTask({ id: "waiting-1" }),
        makeTask({ id: "waiting-2" }),
      ]

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).not.toHaveBeenCalled()
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

      await processDownloadQueue(mockQueueRepository, mockEnsureOffscreenReady)

      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledTimes(1)
      expect(mockQueueRepository.startDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-a" })
      )
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
              return dispatchAcknowledgement(message as DispatchMessage)
            }
            return { success: true }
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
          mockQueueRepository,
          "task-delay",
          mockEnsureOffscreenReady
        )
        await vi.runAllTicks()
        await taskPromise
        await settleAllAcceptedDispatches(task.id)

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
              return dispatchAcknowledgement(message as DispatchMessage)
            }
            return { success: true }
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
          mockQueueRepository,
          "task-no-delay",
          mockEnsureOffscreenReady
        )
        await vi.advanceTimersByTimeAsync(100)
        await taskPromise
        await settleAllAcceptedDispatches(task.id)

        expect(dispatchTimes).toHaveLength(2)
        // No delay: both dispatches happen at the same logical instant.
        expect(dispatchTimes[1]! - dispatchTimes[0]!).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it("forwards the maximum supported chapterDelayMs without blocking the service worker", async () => {
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
              return dispatchAcknowledgement(message as DispatchMessage)
            }
            return { success: true }
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
              chapter: { concurrency: 1, delayMs: 5_000 },
            },
          },
        })

        mockGlobalState.downloadQueue = [task]

        const taskPromise = startDownloadTask(
          mockQueueRepository,
          "task-huge-delay",
          mockEnsureOffscreenReady
        )
        await vi.runAllTicks()
        await taskPromise
        await settleAllAcceptedDispatches(task.id)

        expect(dispatchDeadlines).toHaveLength(2)
        expect(dispatchDeadlines[0]).toBeUndefined()
        expect(dispatchDeadlines[1]).toBeGreaterThanOrEqual(Date.now() + 5_000)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
