import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { recoverFromLivenessTimeout as recoverFromLivenessTimeoutCore } from "@/entrypoints/background/offscreen-lifecycle"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type {
  ActiveDispatchLease,
  OffscreenJobStage,
} from "@/src/domain/queue/state"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import type { DestinationService } from "@/entrypoints/background/destination"
import type { DownloadQueueFinalizationDependencies } from "@/entrypoints/background/download-queue-finalization"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"

const ACTIVE_JOB_STAGES: readonly OffscreenJobStage[] = [
  "dispatching",
  "accepted",
  "resolving",
  "downloading",
  "transforming",
  "archiving",
  "saving",
]

const FINGERPRINT = "a".repeat(64)
const DOCUMENT_INSTANCE_ID = "document-instance-1"

const mocks = vi.hoisted(() => ({
  getLease: vi.fn(),
  renewLease: vi.fn(),
  clearLease: vi.fn(),
  notifyTerminalTask: vi.fn(async () => undefined),
  runTaskSideEffectExclusive: vi.fn(
    async <T>(_taskId: string, operation: () => Promise<T>): Promise<T> =>
      await operation()
  ),
}))

vi.mock("@/entrypoints/background/download-queue-finalization", () => ({
  notifyTerminalDownloadTask: mocks.notifyTerminalTask,
}))

vi.mock("@/entrypoints/background/download-task-side-effect-gate", () => ({
  runTaskSideEffectExclusive: mocks.runTaskSideEffectExclusive,
}))

function createLease(overrides: Partial<ActiveDispatchLease> = {}) {
  return {
    jobId: "job-1",
    attempt: 1,
    taskId: "task-1",
    chapterId: "chapter-1",
    fingerprint: FINGERPRINT,
    documentInstanceId: DOCUMENT_INSTANCE_ID,
    saveMode: "fsa" as const,
    stage: "downloading" as const,
    sequence: 4,
    startedAt: 1_000,
    lastActivityAt: 2_000,
    leaseExpiresAt: Date.now() - 1,
    ...overrides,
  } satisfies ActiveDispatchLease
}

function createNativeOutputCoordinator(
  overrides: Partial<NativeOutputCoordinator> = {}
): NativeOutputCoordinator {
  return {
    getLiveTaskIds: vi.fn(async () => []),
    getJobPhase: vi.fn(async () => null),
    hasLiveDependencies: vi.fn(async () => false),
    reconcile: vi.fn(async () => undefined),
    reconcileStartupOpenManifests: vi.fn(async () => ({
      observedJobSealed: false,
    })),
    cancelTask: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as NativeOutputCoordinator
}

const destinationService = {
  clearDestinationIssuesForTask: vi.fn(async () => undefined),
  recordDestinationRuntimeIssue: vi.fn(async () => undefined),
} as unknown as DestinationService

const finalizationDependencies = {
  settingsRepository: {
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
  },
  historyRepository: {
    markChapterAsDownloaded: vi.fn(async () => undefined),
    getDownloadedChapters: vi.fn(async () => []),
    restoreChapterFromCompletedTask: vi.fn(async () => true),
  },
} satisfies DownloadQueueFinalizationDependencies

async function recoverFromLivenessTimeout(
  stateManager: QueueRepository,
  nativeOutputCoordinator: NativeOutputCoordinator,
  onRecover: (activeTaskId?: string) => Promise<void>
): Promise<void> {
  const queueScheduler = {
    activate: async () => await onRecover(),
    resumeTask: async (taskId: string) => await onRecover(taskId),
    isTaskActive: () => false,
  } as unknown as QueueScheduler
  const terminalCoordinator = new OffscreenJobTerminalCoordinator(
    stateManager,
    nativeOutputCoordinator,
    queueScheduler,
    destinationService,
    finalizationDependencies
  )
  await recoverFromLivenessTimeoutCore(
    stateManager,
    nativeOutputCoordinator,
    terminalCoordinator,
    queueScheduler,
    finalizationDependencies.settingsRepository
  )
}

function createStateManager(
  active = true,
  activeBlock?:
    | "destination_action_required"
    | "provider_network_policy_pending"
    | "provider_network_policy_action_required"
) {
  const task = {
    id: "task-1",
    status: active ? ("downloading" as const) : ("failed" as const),
    activeBlock,
    chapters: [
      {
        id: "chapter-1",
        url: "https://example.com/chapter-1",
        title: "Chapter 1",
        index: 1,
        status: "downloading" as const,
        outputs: { requested: 1, committed: 0, failed: 0 },
        lastUpdated: 1,
      },
      {
        id: "chapter-2",
        url: "https://example.com/chapter-2",
        title: "Chapter 2",
        index: 2,
        status: "queued" as const,
        lastUpdated: 1,
      },
    ],
  }
  const interruptDownloadTask = vi.fn(
    async (input: {
      clearLease?: ActiveDispatchLease
    }): Promise<
      | {
          outcome: "applied"
          task: typeof task & { status: "failed" }
          clearedLease: ActiveDispatchLease | null
        }
      | {
          outcome: "rejected"
          reason: "task-not-active"
          currentStatus: "completed"
        }
    > => {
      const clearedLease = input.clearLease ? await mocks.getLease() : null
      if (input.clearLease) mocks.getLease.mockResolvedValue(null)
      return {
        outcome: "applied",
        task: { ...task, status: "failed" },
        clearedLease,
      }
    }
  )
  const settleTaskChapter = vi.fn(async () => ({
    outcome: "applied" as const,
    task: { ...task, status: "downloading" as const },
    chapter: task.chapters[0]!,
  }))
  return {
    manager: {
      getQueue: vi.fn(async () => [task]),
      getTask: vi.fn(async (taskId: string) =>
        taskId === task.id ? task : null
      ),
      getActiveDispatchLease: mocks.getLease,
      renewDispatchLease: mocks.renewLease,
      clearDispatchLease: mocks.clearLease,
      interruptDownloadTask,
      settleTaskChapter,
    } as unknown as QueueRepository,
    interruptDownloadTask,
  }
}

describe("recoverFromLivenessTimeout", () => {
  const closeDocument = vi.fn(async () => undefined)
  const hasDocument = vi.fn(async () => true)
  const sendMessage = vi.fn<
    (message: {
      type: string
      payload?: { requestId?: string; jobId?: string; attempt?: number }
    }) => Promise<unknown>
  >(async (message) => {
    if (message.type === "OFFSCREEN_QUERY_JOB") {
      return {
        success: true,
        requestId: message.payload?.requestId,
        job: null,
      }
    }
    if (message.type === "OFFSCREEN_STATUS") {
      return {
        success: true,
        initializationState: "ready",
        documentInstanceId: DOCUMENT_INSTANCE_ID,
        activeJobCount: 0,
        activeSeriesResolutionCount: 0,
        activeTaskIds: [],
      }
    }
    return {
      success: true,
      canceled: true,
      jobId: message.payload?.jobId,
      attempt: message.payload?.attempt,
      taskId: "task-1",
      chapterId: "chapter-1",
      fingerprint: FINGERPRINT,
      documentInstanceId: DOCUMENT_INSTANCE_ID,
      status: "canceled",
      lastSequence: 0,
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLease.mockResolvedValue(null)
    mocks.renewLease.mockResolvedValue({
      outcome: "applied",
      lease: {} as never,
    })
    mocks.clearLease.mockImplementation(async () => {
      mocks.getLease.mockResolvedValue(null)
      return { outcome: "applied", lease: {} as never }
    })
    hasDocument.mockResolvedValue(true)
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
      },
      offscreen: { hasDocument, closeDocument },
      runtime: {
        getURL: vi.fn(() => "chrome-extension://test/offscreen.html"),
        getContexts: vi.fn(async () => [{ documentId: "offscreen-document" }]),
        sendMessage,
      },
      alarms: {
        get: vi.fn(async () => undefined),
        clear: vi.fn(async () => true),
        create: vi.fn(async () => undefined),
      },
    } as unknown as typeof chrome)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("continues queued work when there is no active task or lease", async () => {
    const { manager } = createStateManager(false)
    const onRecover = vi.fn(async () => undefined)

    await recoverFromLivenessTimeout(
      manager,
      createNativeOutputCoordinator(),
      onRecover
    )

    expect(mocks.getLease).toHaveBeenCalledOnce()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(onRecover).toHaveBeenCalledOnce()
  })

  it("stops and atomically clears an expired unbound dispatch lease", async () => {
    const lease = createLease({ documentInstanceId: undefined })
    const { manager, interruptDownloadTask } = createStateManager()
    mocks.getLease.mockResolvedValue(lease)
    const onRecover = vi.fn(async () => undefined)

    await recoverFromLivenessTimeout(
      manager,
      createNativeOutputCoordinator(),
      onRecover
    )

    expect(closeDocument).toHaveBeenCalledOnce()
    expect(interruptDownloadTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: lease.taskId,
        clearLease: lease,
      })
    )
    expect(sendMessage).not.toHaveBeenCalled()
    expect(onRecover).toHaveBeenCalledOnce()
  })

  it.each([
    "provider_network_policy_pending",
    "provider_network_policy_action_required",
    "destination_action_required",
  ] as const)("does not watchdog a task blocked by %s", async (activeBlock) => {
    const { manager, interruptDownloadTask } = createStateManager(
      true,
      activeBlock
    )

    await recoverFromLivenessTimeout(
      manager,
      createNativeOutputCoordinator(),
      vi.fn()
    )

    expect(mocks.getLease).toHaveBeenCalledOnce()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(interruptDownloadTask).not.toHaveBeenCalled()
  })

  it("does not query or recover an unexpired dispatch lease", async () => {
    const { manager, interruptDownloadTask } = createStateManager()
    mocks.getLease.mockResolvedValue(
      createLease({ leaseExpiresAt: Date.now() + 30_000 })
    )

    await recoverFromLivenessTimeout(
      manager,
      createNativeOutputCoordinator(),
      vi.fn()
    )

    expect(sendMessage).not.toHaveBeenCalled()
    expect(interruptDownloadTask).not.toHaveBeenCalled()
  })

  it("recovers a stale lease whose owner is no longer watchdog-eligible", async () => {
    const lease = createLease()
    const { manager, interruptDownloadTask } = createStateManager(false)
    mocks.getLease.mockResolvedValue(lease)
    const onRecover = vi.fn(async () => undefined)

    await recoverFromLivenessTimeout(
      manager,
      createNativeOutputCoordinator(),
      onRecover
    )

    expect(interruptDownloadTask).not.toHaveBeenCalled()
    expect(mocks.clearLease).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
      })
    )
    expect(closeDocument).toHaveBeenCalledOnce()
    expect(onRecover).toHaveBeenCalledOnce()
  })

  it.each(ACTIVE_JOB_STAGES)(
    "renews a matching active job after a worker interruption during %s",
    async (stage) => {
      const lease = createLease({ stage })
      const { manager, interruptDownloadTask } = createStateManager()
      mocks.getLease.mockResolvedValue(lease)
      sendMessage.mockImplementationOnce(async (message) => ({
        success: true,
        requestId: message.payload?.requestId,
        job: {
          jobId: lease.jobId,
          attempt: lease.attempt,
          taskId: lease.taskId,
          chapterId: lease.chapterId,
          fingerprint: lease.fingerprint,
          documentInstanceId: lease.documentInstanceId,
          status: "active",
          stage,
          lastSequence: 8,
        },
      }))
      const onRecover = vi.fn(async () => undefined)

      await recoverFromLivenessTimeout(
        manager,
        createNativeOutputCoordinator(),
        onRecover
      )

      expect(mocks.renewLease).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job-1", sequence: 8 })
      )
      expect(interruptDownloadTask).not.toHaveBeenCalled()
      expect(onRecover).not.toHaveBeenCalled()
      expect(closeDocument).not.toHaveBeenCalled()
    }
  )

  it("preserves an expired native-output lease for its exact active open producer", async () => {
    const lease = createLease()
    const { manager, interruptDownloadTask } = createStateManager()
    mocks.getLease.mockResolvedValue(lease)
    sendMessage.mockImplementationOnce(async (message) => ({
      success: true,
      requestId: message.payload?.requestId,
      job: {
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        fingerprint: lease.fingerprint,
        documentInstanceId: lease.documentInstanceId,
        status: "active",
        stage: "saving",
        lastSequence: lease.sequence + 1,
      },
    }))
    const coordinator = createNativeOutputCoordinator({
      getLiveTaskIds: vi.fn(async () => [lease.taskId]),
      getJobPhase: vi.fn<NativeOutputCoordinator["getJobPhase"]>(
        async () => "open"
      ),
    })

    await recoverFromLivenessTimeout(manager, coordinator, vi.fn())

    expect(mocks.renewLease).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        requireSequenceAdvance: true,
      })
    )
    expect(mocks.clearLease).not.toHaveBeenCalled()
    expect(interruptDownloadTask).not.toHaveBeenCalled()
  })

  it("preserves an expired open native-output lease when the producer query fails", async () => {
    const lease = createLease()
    const { manager, interruptDownloadTask } = createStateManager()
    mocks.getLease.mockResolvedValue(lease)
    sendMessage.mockRejectedValueOnce(new Error("query unavailable"))
    const coordinator = createNativeOutputCoordinator({
      getLiveTaskIds: vi.fn(async () => [lease.taskId]),
      getJobPhase: vi.fn<NativeOutputCoordinator["getJobPhase"]>(
        async () => "open"
      ),
    })

    await recoverFromLivenessTimeout(manager, coordinator, vi.fn())

    expect(mocks.clearLease).not.toHaveBeenCalled()
    expect(interruptDownloadTask).not.toHaveBeenCalled()
    expect(coordinator.reconcileStartupOpenManifests).not.toHaveBeenCalled()
  })

  it("seals an exact terminal open manifest before clearing its expired lease", async () => {
    const lease = createLease()
    const { manager, interruptDownloadTask } = createStateManager()
    mocks.getLease.mockResolvedValue(lease)
    sendMessage.mockImplementationOnce(async (message) => ({
      success: true,
      requestId: message.payload?.requestId,
      job: {
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        fingerprint: lease.fingerprint,
        documentInstanceId: lease.documentInstanceId,
        status: "terminal",
        stage: "saving",
        lastSequence: lease.sequence + 1,
        outcome: {
          status: "failed",
          outputsRequested: 0,
          outputsCommitted: 0,
          outputsFailedBeforeHandoff: 0,
        },
      },
    }))
    const getJobPhase = vi
      .fn<NativeOutputCoordinator["getJobPhase"]>()
      .mockResolvedValueOnce("open")
      .mockResolvedValue("sealed")
    const coordinator = createNativeOutputCoordinator({ getJobPhase })
    const onRecover = vi.fn(async () => undefined)

    await recoverFromLivenessTimeout(manager, coordinator, onRecover)

    expect(coordinator.reconcileStartupOpenManifests).toHaveBeenCalledWith({
      offscreenJob: expect.objectContaining({
        jobId: lease.jobId,
        status: "terminal",
      }),
      activeLease: {
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        fingerprint: lease.fingerprint,
        documentInstanceId: lease.documentInstanceId,
      },
    })
    expect(mocks.clearLease).toHaveBeenCalledWith(lease)
    expect(coordinator.reconcile).toHaveBeenCalledOnce()
    expect(interruptDownloadTask).not.toHaveBeenCalled()
    expect(onRecover).toHaveBeenCalledOnce()
  })

  it("does not let an unchanged active-job sequence renew an expired lease forever", async () => {
    const lease = createLease()
    const { manager, interruptDownloadTask } = createStateManager()
    mocks.getLease.mockResolvedValue(lease)
    mocks.renewLease.mockResolvedValue({
      outcome: "rejected",
      reason: "stale-sequence",
    })
    sendMessage.mockImplementationOnce(async (message) => ({
      success: true,
      requestId: message.payload?.requestId,
      job: {
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        fingerprint: lease.fingerprint,
        documentInstanceId: lease.documentInstanceId,
        status: "active",
        stage: lease.stage,
        lastSequence: lease.sequence,
      },
    }))

    await recoverFromLivenessTimeout(
      manager,
      createNativeOutputCoordinator(),
      vi.fn(async () => undefined)
    )

    expect(mocks.renewLease).toHaveBeenCalledWith(
      expect.objectContaining({ requireSequenceAdvance: true })
    )
    expect(interruptDownloadTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        errorMessage: "Download process unresponsive",
        now: expect.any(Number),
        clearLease: expect.objectContaining({
          jobId: lease.jobId,
          attempt: lease.attempt,
          taskId: lease.taskId,
          chapterId: lease.chapterId,
        }),
      })
    )
    const cancelCall = sendMessage.mock.calls.findIndex(
      ([message]) => message.type === "OFFSCREEN_CANCEL_JOB"
    )
    expect(cancelCall).toBeGreaterThanOrEqual(0)
    expect(sendMessage.mock.calls[cancelCall]?.[0]).toEqual({
      target: "offscreen",
      type: "OFFSCREEN_CANCEL_JOB",
      payload: {
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        fingerprint: lease.fingerprint,
        documentInstanceId: lease.documentInstanceId,
      },
    })
    const cancelOrder = sendMessage.mock.invocationCallOrder[cancelCall]
    const transitionOrder = interruptDownloadTask.mock.invocationCallOrder[0]
    expect(cancelOrder).toBeLessThan(transitionOrder)
  })

  it.each(["terminal", "absent"] as const)(
    "accepts an exact %s cancel acknowledgement as stopped producer evidence",
    async (status) => {
      const lease = createLease()
      const { manager, interruptDownloadTask } = createStateManager()
      mocks.getLease.mockResolvedValue(lease)
      mocks.renewLease.mockResolvedValue({
        outcome: "rejected",
        reason: "stale-sequence",
      })
      sendMessage
        .mockImplementationOnce(async (message) => ({
          success: true,
          requestId: message.payload?.requestId,
          job: {
            jobId: lease.jobId,
            attempt: lease.attempt,
            taskId: lease.taskId,
            chapterId: lease.chapterId,
            fingerprint: lease.fingerprint,
            documentInstanceId: lease.documentInstanceId,
            status: "active",
            stage: lease.stage,
            lastSequence: lease.sequence,
          },
        }))
        .mockImplementationOnce(async () => ({
          success: true,
          canceled: false,
          jobId: lease.jobId,
          attempt: lease.attempt,
          taskId: lease.taskId,
          chapterId: lease.chapterId,
          fingerprint: lease.fingerprint,
          documentInstanceId: lease.documentInstanceId,
          status,
          lastSequence: lease.sequence,
        }))

      await recoverFromLivenessTimeout(
        manager,
        createNativeOutputCoordinator(),
        vi.fn(async () => undefined)
      )

      expect(interruptDownloadTask).toHaveBeenCalledWith(
        expect.objectContaining({ clearLease: lease })
      )
    }
  )

  it("releases an exact terminal FSA lease after cancellation won the task race", async () => {
    const lease = createLease()
    const { manager, interruptDownloadTask } = createStateManager()
    const canceledTask = {
      ...(await manager.getTask(lease.taskId))!,
      status: "canceled" as const,
      chapters: [
        {
          ...(await manager.getTask(lease.taskId))!.chapters[0]!,
          status: "failed" as const,
        },
      ],
    }
    vi.mocked(manager.getQueue).mockResolvedValue([canceledTask])
    vi.mocked(manager.getTask).mockResolvedValue(canceledTask)
    mocks.getLease.mockResolvedValue(lease)
    sendMessage.mockImplementationOnce(async (message) => ({
      success: true,
      requestId: message.payload?.requestId,
      job: {
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        fingerprint: lease.fingerprint,
        documentInstanceId: lease.documentInstanceId,
        status: "terminal",
        stage: "saving",
        lastSequence: lease.sequence + 1,
        outcome: {
          status: "completed",
          outputsRequested: 1,
          outputsCommitted: 1,
          outputsFailedBeforeHandoff: 0,
        },
      },
    }))
    const onRecover = vi.fn(async () => undefined)

    await recoverFromLivenessTimeout(
      manager,
      createNativeOutputCoordinator(),
      onRecover
    )

    expect(interruptDownloadTask).not.toHaveBeenCalled()
    expect(manager.settleTaskChapter).not.toHaveBeenCalled()
    expect(mocks.clearLease).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: lease.jobId,
        taskId: lease.taskId,
        fingerprint: lease.fingerprint,
      })
    )
    expect(onRecover).toHaveBeenCalledWith()
  })

  it("re-enters the runner for a matching terminal job without closing offscreen", async () => {
    const lease = createLease()
    const { manager } = createStateManager()
    mocks.getLease.mockResolvedValue(lease)
    sendMessage.mockImplementationOnce(async (message) => ({
      success: true,
      requestId: message.payload?.requestId,
      job: {
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        fingerprint: lease.fingerprint,
        documentInstanceId: lease.documentInstanceId,
        status: "terminal",
        stage: "saving",
        lastSequence: 9,
        outcome: {
          status: "completed",
          outputsRequested: 1,
          outputsCommitted: 1,
          outputsFailedBeforeHandoff: 0,
        },
      },
    }))
    const onRecover = vi.fn(async () => undefined)

    await recoverFromLivenessTimeout(
      manager,
      createNativeOutputCoordinator(),
      onRecover
    )

    expect(onRecover).toHaveBeenCalledWith("task-1")
    expect(closeDocument).not.toHaveBeenCalled()
  })

  it("clears an expired offscreen lease without interrupting a native-owned task", async () => {
    const { manager, interruptDownloadTask } = createStateManager()
    const lease = createLease()
    mocks.getLease.mockResolvedValue(lease)
    const coordinator = createNativeOutputCoordinator({
      getLiveTaskIds: vi.fn(async () => [lease.taskId]),
      getJobPhase: vi.fn<NativeOutputCoordinator["getJobPhase"]>(
        async () => "sealed"
      ),
    })
    const onRecover = vi.fn(async () => undefined)

    await recoverFromLivenessTimeout(manager, coordinator, onRecover)

    expect(interruptDownloadTask).not.toHaveBeenCalled()
    expect(mocks.clearLease).toHaveBeenCalledWith(lease)
    expect(coordinator.reconcile).toHaveBeenCalledOnce()
    expect(onRecover).toHaveBeenCalledOnce()
    expect(closeDocument).not.toHaveBeenCalled()
  })

  it("fails unreconciled work only after exact producer absence is proven", async () => {
    const { manager, interruptDownloadTask } = createStateManager()
    mocks.getLease.mockResolvedValue(createLease())
    const onRecover = vi.fn(async () => undefined)

    await recoverFromLivenessTimeout(
      manager,
      createNativeOutputCoordinator(),
      onRecover
    )

    expect(interruptDownloadTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        errorMessage: "Download process unresponsive",
        now: expect.any(Number),
        clearLease: expect.objectContaining({
          jobId: "job-1",
          attempt: 1,
          taskId: "task-1",
          chapterId: "chapter-1",
        }),
      })
    )
    expect(mocks.clearLease).not.toHaveBeenCalled()
    expect(closeDocument).toHaveBeenCalledTimes(1)
    expect(onRecover).toHaveBeenCalledTimes(1)
    expect(mocks.runTaskSideEffectExclusive).toHaveBeenCalledWith(
      "task-1",
      expect.any(Function)
    )
    expect(
      sendMessage.mock.calls.some(
        ([message]) => message.type === "OFFSCREEN_CANCEL_JOB"
      )
    ).toBe(false)
    const queryCall = sendMessage.mock.calls.findIndex(
      ([message]) => message.type === "OFFSCREEN_QUERY_JOB"
    )
    expect(queryCall).toBeGreaterThanOrEqual(0)
    const queryOrder = sendMessage.mock.invocationCallOrder[queryCall]
    const transitionOrder = interruptDownloadTask.mock.invocationCallOrder[0]
    expect(queryOrder).toBeLessThan(transitionOrder)
  })

  it("does not cancel or clear a lease when the durable transition is rejected", async () => {
    const { manager, interruptDownloadTask } = createStateManager()
    interruptDownloadTask.mockResolvedValueOnce({
      outcome: "rejected",
      reason: "task-not-active",
      currentStatus: "completed",
    })
    mocks.getLease.mockResolvedValue(createLease())

    await recoverFromLivenessTimeout(
      manager,
      createNativeOutputCoordinator(),
      vi.fn(async () => undefined)
    )

    expect(mocks.clearLease).not.toHaveBeenCalled()
    expect(
      sendMessage.mock.calls.some(
        ([message]) => message.type === "OFFSCREEN_CANCEL_JOB"
      )
    ).toBe(false)
  })
})
