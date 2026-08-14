import { beforeEach, describe, expect, it, vi } from "vitest"

import { initializeFromStorage } from "@/entrypoints/background/initialize-from-storage"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
} from "@/src/domain/queue/state"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"
import type { DownloadQueueFinalizationDependencies } from "@/entrypoints/background/download-queue-finalization"

const mocks = vi.hoisted(() => ({
  notifyTerminalDownloadTask: vi.fn(async () => undefined),
}))

vi.mock("@/entrypoints/background/download-queue-finalization", () => ({
  notifyTerminalDownloadTask: mocks.notifyTerminalDownloadTask,
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function task(
  status: DownloadTaskState["status"],
  id = `task-${status}`
): DownloadTaskState {
  return {
    id,
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [
      {
        id: "chapter-1",
        url: "https://example.test/chapter-1",
        title: "Chapter 1",
        index: 0,
        status:
          status === "queued"
            ? "queued"
            : status === "downloading"
              ? "downloading"
              : "failed",
        lastUpdated: 1,
      },
    ],
    status,
    created: 1,
    settingsSnapshot: {} as DownloadTaskState["settingsSnapshot"],
  }
}

function activeLease(taskId = "active-task"): ActiveDispatchLease {
  return {
    jobId: "job-1",
    attempt: 1,
    taskId,
    chapterId: "chapter-1",
    fingerprint: "a".repeat(64),
    documentInstanceId: "document-1",
    saveMode: "downloads-api",
    stage: "saving",
    sequence: 4,
    startedAt: 1,
    lastActivityAt: 2,
    leaseExpiresAt: 3,
  }
}

function createHarness(queue: DownloadTaskState[] = []) {
  const getQueue = vi.fn(async () => queue)
  const getActiveDispatchLease = vi.fn<
    QueueRepository["getActiveDispatchLease"]
  >(async () => null)
  const recoverQueueAfterStartup = vi.fn<
    QueueRepository["recoverQueueAfterStartup"]
  >(async () => ({
    outcome: "unchanged" as const,
    queue,
    recoveredTaskIds: [],
    interruptedTaskIds: [],
    leaseCleared: false,
  }))
  const clearDispatchLease = vi.fn<QueueRepository["clearDispatchLease"]>(
    async () => ({
      outcome: "applied" as const,
      lease: activeLease(),
    })
  )
  const queueRepository = {
    getQueue,
    getActiveDispatchLease,
    recoverQueueAfterStartup,
    clearDispatchLease,
  } as unknown as QueueRepository
  const nativeOutputCoordinator = {
    getLiveTaskIds: vi.fn(async () => [] as string[]),
    reconcileStartupOpenManifests: vi.fn(async () => ({
      observedJobSealed: false,
    })),
    reconcile: vi.fn(async () => undefined),
    hasLiveDependencies: vi.fn(async () => false),
    hasReconcilableLiveDependencies: vi.fn(async () => false),
    sealManifest: vi.fn(async () => undefined),
  } as unknown as NativeOutputCoordinator
  const writeSession = vi.fn(async () => undefined)
  const setLivenessAlarmArmed = vi.fn(async () => undefined)
  const settingsRepository = {
    getSettings: vi.fn(async () => ({})),
  }
  const terminalCoordinator = new OffscreenJobTerminalCoordinator(
    queueRepository,
    nativeOutputCoordinator,
    {} as QueueScheduler,
    {} as never,
    {
      settingsRepository: settingsRepository as never,
      historyRepository: {} as never,
    } satisfies DownloadQueueFinalizationDependencies
  )
  return {
    queueRepository,
    nativeOutputCoordinator,
    getQueue,
    getActiveDispatchLease,
    recoverQueueAfterStartup,
    clearDispatchLease,
    writeSession,
    setLivenessAlarmArmed,
    dependencies: {
      queueRepository,
      nativeOutputCoordinator,
      terminalCoordinator,
      settingsRepository: settingsRepository as never,
      writeSession,
      getOffscreenActiveTaskIds: vi.fn(async () => [] as string[]),
      hasOffscreenDocument: vi.fn(async () => false),
      terminateOffscreenDocumentForUnboundLease: vi.fn(async () => undefined),
      getOffscreenJobState: vi.fn<() => Promise<OffscreenJobState | null>>(
        async () => null
      ),
      setLivenessAlarmArmed,
    },
  }
}

describe("initializeFromStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("stops an unbound producer and passes its exact lease to recovery", async () => {
    const activeTask = task("downloading", "active-task")
    const harness = createHarness([activeTask])
    const lease = { ...activeLease(), documentInstanceId: undefined }
    vi.mocked(harness.getActiveDispatchLease).mockResolvedValue(lease)
    vi.mocked(harness.dependencies.hasOffscreenDocument).mockResolvedValue(true)

    await initializeFromStorage(harness.dependencies)

    expect(
      harness.dependencies.terminateOffscreenDocumentForUnboundLease
    ).toHaveBeenCalledOnce()
    expect(harness.dependencies.getOffscreenJobState).not.toHaveBeenCalled()
    expect(harness.recoverQueueAfterStartup).toHaveBeenCalledWith(
      expect.objectContaining({
        observedLease: expect.objectContaining({
          jobId: lease.jobId,
          fingerprint: lease.fingerprint,
          documentInstanceId: undefined,
        }),
        offscreenJob: null,
      })
    )
  })

  it("passes native-output ownership into recovery and reconciles before liveness projection", async () => {
    const nativeTask = task("downloading", "native-task")
    const harness = createHarness([nativeTask])
    vi.mocked(harness.nativeOutputCoordinator.getLiveTaskIds).mockResolvedValue(
      [nativeTask.id]
    )
    vi.mocked(
      harness.nativeOutputCoordinator.hasLiveDependencies
    ).mockResolvedValue(true)
    vi.mocked(
      harness.nativeOutputCoordinator.hasReconcilableLiveDependencies
    ).mockResolvedValue(true)

    const result = await initializeFromStorage(harness.dependencies)

    expect(harness.recoverQueueAfterStartup).toHaveBeenCalledWith(
      expect.objectContaining({
        observedLease: null,
        offscreenJob: null,
        nativeOutputTaskIds: [nativeTask.id],
      })
    )
    expect(
      harness.nativeOutputCoordinator.reconcileStartupOpenManifests
    ).toHaveBeenCalledWith({ offscreenJob: null, activeLease: null })
    expect(
      vi.mocked(harness.nativeOutputCoordinator.reconcileStartupOpenManifests)
        .mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(harness.nativeOutputCoordinator.getLiveTaskIds).mock
        .invocationCallOrder[0]!
    )
    expect(harness.nativeOutputCoordinator.reconcile).toHaveBeenCalledOnce()
    expect(harness.setLivenessAlarmArmed).toHaveBeenCalledWith(true)
    expect(result).toEqual({ queue: [nativeTask], queueActivation: undefined })
  })

  it("activates the next queued task only after recovery leaves no live owner", async () => {
    const queuedTask = task("queued")
    const harness = createHarness([queuedTask])

    await expect(initializeFromStorage(harness.dependencies)).resolves.toEqual({
      queue: [queuedTask],
      queueActivation: { kind: "process-queue" },
    })
    expect(harness.setLivenessAlarmArmed).toHaveBeenCalledWith(false)
  })

  it("prefers exact recovered task resumption over queue activation", async () => {
    const activeTask = task("downloading", "active-task")
    const harness = createHarness([activeTask])
    harness.recoverQueueAfterStartup.mockResolvedValueOnce({
      outcome: "applied",
      queue: [activeTask],
      recoveredTaskIds: [activeTask.id],
      interruptedTaskIds: [],
      leaseCleared: false,
      resumeTaskId: activeTask.id,
    })

    await expect(initializeFromStorage(harness.dependencies)).resolves.toEqual({
      queue: [activeTask],
      queueActivation: { kind: "resume-task", taskId: activeTask.id },
    })
  })

  it("settles an exactly queried terminal native job before startup recovery", async () => {
    const activeTask = task("downloading", "active-task")
    const harness = createHarness([activeTask])
    const lease = activeLease(activeTask.id)
    harness.getActiveDispatchLease
      .mockResolvedValueOnce(lease)
      .mockResolvedValueOnce(lease)
      .mockResolvedValue(null)
    harness.dependencies.hasOffscreenDocument.mockResolvedValue(true)
    harness.dependencies.getOffscreenJobState.mockResolvedValue({
      jobId: lease.jobId,
      attempt: lease.attempt,
      taskId: lease.taskId,
      chapterId: lease.chapterId,
      fingerprint: lease.fingerprint,
      documentInstanceId: lease.documentInstanceId!,
      status: "terminal",
      stage: "saving",
      lastSequence: lease.sequence,
      outcome: {
        status: "failed",
        outputsRequested: 0,
        outputsFailedBeforeHandoff: 0,
        outputsCommitted: 0,
      },
    })
    await initializeFromStorage(harness.dependencies)

    expect(harness.nativeOutputCoordinator.sealManifest).toHaveBeenCalledWith({
      jobId: lease.jobId,
      attempt: lease.attempt,
      taskId: lease.taskId,
      chapterId: lease.chapterId,
      fingerprint: lease.fingerprint,
      documentInstanceId: lease.documentInstanceId,
      outputsRequested: 0,
      outputsFailedBeforeHandoff: 0,
    })
    expect(harness.clearDispatchLease).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        fingerprint: lease.fingerprint,
        documentInstanceId: lease.documentInstanceId,
      })
    )
    expect(harness.recoverQueueAfterStartup).toHaveBeenCalledWith(
      expect.objectContaining({
        observedLease: null,
        offscreenJob: null,
      })
    )
    expect(
      vi.mocked(harness.nativeOutputCoordinator.reconcile).mock
        .invocationCallOrder[0]
    ).toBeGreaterThan(
      harness.recoverQueueAfterStartup.mock.invocationCallOrder[0]!
    )
  })

  it("fails startup when the dispatch lease changes during recovery", async () => {
    const harness = createHarness()
    harness.recoverQueueAfterStartup.mockResolvedValueOnce({
      outcome: "rejected",
      reason: "lease-conflict",
    })

    await expect(initializeFromStorage(harness.dependencies)).rejects.toThrow(
      "Startup dispatch lease changed during recovery"
    )
    expect(harness.nativeOutputCoordinator.reconcile).not.toHaveBeenCalled()
  })

  it("notifies each task interrupted by recovery and clears active progress", async () => {
    const failedTask = task("failed", "failed-task")
    const harness = createHarness([failedTask])
    harness.recoverQueueAfterStartup.mockResolvedValueOnce({
      outcome: "applied",
      queue: [failedTask],
      recoveredTaskIds: [failedTask.id],
      interruptedTaskIds: [failedTask.id],
      leaseCleared: true,
    })

    await initializeFromStorage(harness.dependencies)

    expect(mocks.notifyTerminalDownloadTask).toHaveBeenCalledWith({
      task: failedTask,
      finalStatus: "failed",
      completedCount: 0,
      totalChapters: 1,
      settingsRepository: harness.dependencies.settingsRepository,
    })
    expect(harness.writeSession).toHaveBeenCalledWith({
      [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
    })
  })

  it("keeps startup successful when the disposable session projection fails", async () => {
    const harness = createHarness()
    harness.writeSession.mockRejectedValue(new Error("session unavailable"))

    await expect(initializeFromStorage(harness.dependencies)).resolves.toEqual({
      queue: [],
      queueActivation: undefined,
    })
  })

  it("keeps recovery deferred when the exact offscreen job query fails", async () => {
    const activeTask = task("downloading", "active-task")
    const harness = createHarness([activeTask])
    harness.getActiveDispatchLease.mockResolvedValue(activeLease(activeTask.id))
    harness.dependencies.hasOffscreenDocument.mockResolvedValueOnce(true)
    harness.dependencies.getOffscreenJobState.mockRejectedValueOnce(
      new Error("offscreen query transport failed")
    )

    await expect(initializeFromStorage(harness.dependencies)).resolves.toEqual({
      queue: [activeTask],
    })

    expect(
      harness.nativeOutputCoordinator.reconcileStartupOpenManifests
    ).not.toHaveBeenCalled()
    expect(harness.recoverQueueAfterStartup).not.toHaveBeenCalled()
    expect(harness.setLivenessAlarmArmed).toHaveBeenCalledWith(true)
  })
})
