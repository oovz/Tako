import { beforeEach, describe, expect, it, vi } from "vitest"

import { QueueApplicationCommands } from "@/entrypoints/background/queue-application-commands"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import type { DestinationService } from "@/entrypoints/background/destination"
import type { DownloadQueueFinalizationDependencies } from "@/entrypoints/background/download-queue-finalization"
import type { StartDownloadSettingsDependencies } from "@/entrypoints/background/download-queue-enqueue"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
  PendingUndoAction,
} from "@/src/domain/queue/state"

const mocks = vi.hoisted(() => ({
  loadStartDownloadSettingsInputs: vi.fn(),
  buildStartDownloadTask: vi.fn(),
  processDownloadQueue: vi.fn(async () => undefined),
  clearDestinationIssuesForTask: vi.fn(async () => undefined),
  schedulePendingUndoAction: vi.fn(async () => undefined),
  restorePendingUndoAndCleanup: vi.fn(),
}))

vi.mock("@/entrypoints/background/download-queue-enqueue", () => ({
  loadStartDownloadSettingsInputs: mocks.loadStartDownloadSettingsInputs,
  buildStartDownloadTask: mocks.buildStartDownloadTask,
}))

vi.mock("@/entrypoints/background/destination", () => ({
  clearDestinationIssuesForTask: mocks.clearDestinationIssuesForTask,
}))

vi.mock("@/entrypoints/background/pending-undo-coordinator", () => ({
  schedulePendingUndoAction: mocks.schedulePendingUndoAction,
  restorePendingUndoAndCleanup: mocks.restorePendingUndoAndCleanup,
}))

vi.mock("@/entrypoints/background/download-task-side-effect-gate", () => ({
  runTaskSideEffectExclusive: async <T>(
    _taskId: string,
    operation: () => Promise<T>
  ) => await operation(),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const queuedUndo = {
  token: "undo-queued",
  type: "cancel_queued" as const,
  expiresAt: 10_000,
}
const historyUndo = {
  token: "undo-history",
  type: "remove_history" as const,
  expiresAt: 10_000,
}

const startDownloadSettings = {
  settingsRepository: {
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
  },
  siteOverridesService: {
    getAll: vi.fn(async () => ({})),
  },
  siteIntegrationSettingsService: {
    getForSite: vi.fn(async () => ({})),
  },
} satisfies StartDownloadSettingsDependencies

const destinationService = {
  clearDestinationIssuesForTask: mocks.clearDestinationIssuesForTask,
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

const startPayload = {
  sourceWindowId: 1,
  sourceTabId: 3,
  sourceUrl: "https://mangadex.org/title/series-1",
  siteIntegrationId: "mangadex",
  seriesId: "series-1",
  seriesRevision: 4,
  selectedChapterIds: ["chapter-1"],
}

const currentSeriesContext = {
  windowId: 1,
  revision: 4,
  context: {
    sourceUrl: startPayload.sourceUrl,
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [
      {
        id: "chapter-1",
        title: "One",
        url: "https://mangadex.org/chapter/chapter-1",
        index: 1,
        status: "queued" as const,
        lastUpdated: 1,
      },
    ],
    volumes: [],
    lastUpdated: 1,
  },
}

function task(id: string): DownloadTaskState {
  return {
    id,
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [],
    status: "queued",
    created: 1,
    settingsSnapshot: {},
  } as unknown as DownloadTaskState
}

function pendingAction(type: PendingUndoAction["type"]): PendingUndoAction {
  return {
    token: `undo-${type}`,
    type,
    taskSnapshot: task("task-1"),
    previousQueuePosition: 0,
    createdAt: 1,
    expiresAt: 10_000,
  }
}

function activeLease(
  overrides: Partial<ActiveDispatchLease> = {}
): ActiveDispatchLease {
  return {
    jobId: "job-1",
    attempt: 2,
    taskId: "task-1",
    chapterId: "chapter-1",
    fingerprint: "a".repeat(64),
    documentInstanceId: "document-1",
    saveMode: "downloads-api",
    stage: "downloading",
    startedAt: 1,
    lastActivityAt: 1,
    leaseExpiresAt: 2,
    sequence: 1,
    ...overrides,
  }
}

function canceledJobIdentity(lease: ActiveDispatchLease) {
  return {
    jobId: lease.jobId,
    attempt: lease.attempt,
    taskId: lease.taskId,
    chapterId: lease.chapterId,
    fingerprint: lease.fingerprint,
    documentInstanceId: lease.documentInstanceId!,
  }
}

describe("QueueApplicationCommands", () => {
  const queueRepository = {
    enqueueDownloadTask: vi.fn(),
    retryFailedChapters: vi.fn(),
    restartDownloadTask: vi.fn(),
    moveQueuedTaskToTop: vi.fn(),
    clearTerminalHistory: vi.fn(),
    removeTerminalDownloadTask: vi.fn(),
    cancelDownloadTask: vi.fn(),
    clearDispatchLease: vi.fn(),
    resumeDestinationTask: vi.fn(),
  } as unknown as QueueRepository
  const nativeOutputCoordinator = {
    cancelTask: vi.fn(async () => undefined),
  } as unknown as NativeOutputCoordinator
  const getCurrentSeriesContext = vi.fn(async () => currentSeriesContext)
  const sendMessage = vi.fn(async (): Promise<unknown> => ({
    success: true,
    canceled: true,
    jobId: "job-1",
    attempt: 2,
    taskId: "task-1",
    chapterId: "chapter-1",
    fingerprint: "a".repeat(64),
    documentInstanceId: "document-1",
    status: "canceled" as const,
    lastSequence: 2,
  }))
  let commands: QueueApplicationCommands

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadStartDownloadSettingsInputs.mockResolvedValue({})
    mocks.buildStartDownloadTask.mockImplementation(
      ({ taskId }: { taskId: string }) => task(taskId)
    )
    vi.mocked(queueRepository.enqueueDownloadTask).mockImplementation(
      async (downloadTask) => ({ outcome: "applied", task: downloadTask })
    )
    vi.mocked(queueRepository.retryFailedChapters).mockResolvedValue({
      outcome: "applied",
      originalTask: task("source"),
      retryTask: task("retry-task"),
    })
    vi.mocked(queueRepository.restartDownloadTask).mockResolvedValue({
      outcome: "applied",
      originalTask: task("source"),
      restartTask: task("restart-task"),
    })
    vi.mocked(queueRepository.moveQueuedTaskToTop).mockResolvedValue({
      outcome: "applied",
      task: task("task-1"),
      position: 0,
    })
    vi.mocked(queueRepository.clearTerminalHistory).mockResolvedValue({
      outcome: "applied",
      removedTaskIds: ["one", "two"],
    })
    vi.mocked(queueRepository.removeTerminalDownloadTask).mockResolvedValue({
      outcome: "applied",
      task: task("task-1"),
      undo: historyUndo,
    })
    vi.mocked(queueRepository.cancelDownloadTask).mockResolvedValue({
      outcome: "applied",
      task: task("task-1"),
      canceledLease: null,
      undo: queuedUndo,
    })
    vi.mocked(queueRepository.clearDispatchLease).mockResolvedValue({
      outcome: "applied",
      lease: activeLease(),
    })
    vi.mocked(queueRepository.resumeDestinationTask).mockResolvedValue({
      outcome: "applied",
      task: task("task-1"),
    })
    mocks.restorePendingUndoAndCleanup.mockResolvedValue({
      outcome: "applied",
      action: pendingAction("remove_history"),
      restored: true,
    })
    ;(globalThis as { chrome: typeof chrome }).chrome = {
      runtime: { sendMessage },
      permissions: { contains: vi.fn(async () => true) },
    } as unknown as typeof chrome
    commands = new QueueApplicationCommands({
      startDownloadSettings,
      queueRepository,
      nativeOutputCoordinator,
      cancellationCoordinator: new DownloadTaskCancellationCoordinator(
        queueRepository,
        nativeOutputCoordinator,
        destinationService,
        finalizationDependencies
      ),
      queueScheduler: {
        activate: mocks.processDownloadQueue,
      } as unknown as QueueScheduler,
      destinationService,
      siteIntegrationEnablementService: {
        getAll: vi.fn(async () => ({ mangadex: true })),
      },
      getCurrentSeriesContext,
    })
  })

  it("returns the fixed workflow results and activates only start, retry, and restart", async () => {
    await expect(
      commands.startDownload(startPayload, "command-start")
    ).resolves.toEqual({
      taskId: expect.any(String),
    })
    await expect(
      commands.retryFailedChapters("source", "command-retry")
    ).resolves.toEqual({
      newTaskId: "retry-task",
    })
    await expect(
      commands.restartTask("source", "command-restart")
    ).resolves.toEqual({
      newTaskId: "restart-task",
    })
    await expect(commands.moveTaskToTop("task-1")).resolves.toBeUndefined()
    await expect(commands.clearTerminalHistory()).resolves.toEqual({
      removedCount: 2,
    })

    expect(mocks.processDownloadQueue).toHaveBeenCalledTimes(3)
    expect(mocks.processDownloadQueue).toHaveBeenCalledWith()
  })

  it("converges a remove replay after the task is already gone", async () => {
    vi.mocked(queueRepository.removeTerminalDownloadTask).mockResolvedValue({
      outcome: "rejected",
      reason: "task-not-found",
    } as never)

    await expect(commands.removeTask("task-1")).resolves.toBeUndefined()
    expect(mocks.schedulePendingUndoAction).not.toHaveBeenCalled()
  })

  it("commits remove and queued cancel before scheduling Undo without activation", async () => {
    const events: string[] = []
    vi.mocked(queueRepository.removeTerminalDownloadTask).mockImplementation(
      async () => {
        events.push("remove-commit")
        return {
          outcome: "applied",
          task: task("task-1"),
          undo: historyUndo,
        }
      }
    )
    vi.mocked(queueRepository.cancelDownloadTask).mockImplementation(
      async () => {
        events.push("cancel-commit")
        return {
          outcome: "applied",
          task: task("task-1"),
          canceledLease: null,
          undo: queuedUndo,
        }
      }
    )
    mocks.schedulePendingUndoAction.mockImplementation(async () => {
      events.push("schedule-undo")
    })

    await expect(commands.removeTask("task-1")).resolves.toEqual(historyUndo)
    await expect(commands.cancelTask("task-1")).resolves.toEqual({
      kind: "queued",
      undo: queuedUndo,
    })

    expect(events).toEqual([
      "remove-commit",
      "schedule-undo",
      "cancel-commit",
      "schedule-undo",
    ])
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
  })

  it("orders active cancellation effects after commit and tolerates only diagnostic cleanup failure", async () => {
    const events: string[] = []
    const lease = activeLease()
    vi.mocked(queueRepository.cancelDownloadTask).mockImplementation(
      async () => {
        events.push("commit")
        return {
          outcome: "applied",
          task: task("task-1"),
          canceledLease: lease,
          undo: null,
        }
      }
    )
    mocks.clearDestinationIssuesForTask.mockImplementation(async () => {
      events.push("destination")
      throw new Error("diagnostic write failed")
    })
    sendMessage.mockImplementation(async () => {
      events.push("offscreen")
      return {
        success: true,
        canceled: true,
        ...canceledJobIdentity(lease),
        status: "canceled" as const,
        lastSequence: 2,
      }
    })
    vi.mocked(queueRepository.clearDispatchLease).mockImplementation(
      async () => {
        events.push("clear-lease")
        return { outcome: "applied", lease }
      }
    )
    vi.mocked(nativeOutputCoordinator.cancelTask).mockImplementation(
      async () => {
        events.push("pending-output")
      }
    )
    mocks.processDownloadQueue.mockImplementation(async () => {
      events.push("activate")
    })

    await expect(commands.cancelTask("task-1")).resolves.toEqual({
      kind: "active",
    })

    expect(events).toEqual([
      "commit",
      "destination",
      "offscreen",
      "clear-lease",
      "pending-output",
      "activate",
    ])
    expect(sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "OFFSCREEN_CANCEL_JOB",
      payload: {
        jobId: "job-1",
        attempt: 2,
        taskId: "task-1",
        chapterId: "chapter-1",
        fingerprint: lease.fingerprint,
        documentInstanceId: lease.documentInstanceId,
      },
    })
    expect(queueRepository.clearDispatchLease).toHaveBeenCalledWith(lease)
    expect(nativeOutputCoordinator.cancelTask).toHaveBeenCalledWith(
      "task-1",
      canceledJobIdentity(lease)
    )
  })

  it("retains the durable lease when offscreen cancellation delivery fails", async () => {
    const lease = activeLease()
    vi.mocked(queueRepository.cancelDownloadTask).mockResolvedValue({
      outcome: "applied",
      task: task("task-1"),
      canceledLease: lease,
      undo: null,
    })
    sendMessage.mockRejectedValueOnce(new Error("offscreen unavailable"))

    await expect(commands.cancelTask("task-1")).resolves.toEqual({
      kind: "active",
    })
    expect(queueRepository.clearDispatchLease).not.toHaveBeenCalled()
    expect(nativeOutputCoordinator.cancelTask).not.toHaveBeenCalled()
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
  })

  it.each([
    {
      caseName: "the worker reports canceled false",
      response: {
        success: true,
        canceled: false,
        jobId: "job-1",
        attempt: 2,
        taskId: "task-1",
        chapterId: "chapter-1",
        fingerprint: "a".repeat(64),
        documentInstanceId: "document-1",
        status: "active" as const,
        lastSequence: 1,
      },
    },
    {
      caseName: "the acknowledged job differs",
      response: {
        success: true,
        canceled: true,
        jobId: "other-job",
        attempt: 2,
        taskId: "task-1",
        chapterId: "chapter-1",
        fingerprint: "a".repeat(64),
        documentInstanceId: "document-1",
        status: "canceled" as const,
        lastSequence: 2,
      },
    },
    {
      caseName: "the acknowledged attempt differs",
      response: {
        success: true,
        canceled: true,
        jobId: "job-1",
        attempt: 3,
        taskId: "task-1",
        chapterId: "chapter-1",
        fingerprint: "a".repeat(64),
        documentInstanceId: "document-1",
        status: "canceled" as const,
        lastSequence: 2,
      },
    },
    {
      caseName: "the acknowledged fingerprint differs",
      response: {
        success: true,
        canceled: true,
        jobId: "job-1",
        attempt: 2,
        taskId: "task-1",
        chapterId: "chapter-1",
        fingerprint: "b".repeat(64),
        documentInstanceId: "document-1",
        status: "canceled" as const,
        lastSequence: 2,
      },
    },
    {
      caseName: "the acknowledged document incarnation differs",
      response: {
        success: true,
        canceled: true,
        jobId: "job-1",
        attempt: 2,
        taskId: "task-1",
        chapterId: "chapter-1",
        fingerprint: "a".repeat(64),
        documentInstanceId: "document-2",
        status: "canceled" as const,
        lastSequence: 2,
      },
    },
  ])("defers cleanup and activation when $caseName", async ({ response }) => {
    const lease = activeLease()
    vi.mocked(queueRepository.cancelDownloadTask).mockResolvedValue({
      outcome: "applied",
      task: task("task-1"),
      canceledLease: lease,
      undo: null,
    })
    sendMessage.mockResolvedValueOnce(response)

    await expect(commands.cancelTask("task-1")).resolves.toEqual({
      kind: "active",
    })
    expect(queueRepository.clearDispatchLease).not.toHaveBeenCalled()
    expect(nativeOutputCoordinator.cancelTask).not.toHaveBeenCalled()
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
  })

  it("activates the queue after committed-cancel native cleanup fails", async () => {
    vi.mocked(queueRepository.cancelDownloadTask).mockResolvedValueOnce({
      outcome: "applied",
      task: task("task-1"),
      canceledLease: null,
      undo: null,
    })
    vi.mocked(nativeOutputCoordinator.cancelTask).mockRejectedValueOnce(
      new Error("native storage unavailable")
    )

    await expect(commands.cancelTask("task-1")).resolves.toEqual({
      kind: "active",
    })

    expect(mocks.processDownloadQueue).toHaveBeenCalledOnce()
  })

  it("preserves activation failure after committed-cancel cleanup also fails", async () => {
    vi.mocked(queueRepository.cancelDownloadTask).mockResolvedValueOnce({
      outcome: "applied",
      task: task("task-1"),
      canceledLease: null,
      undo: null,
    })
    vi.mocked(nativeOutputCoordinator.cancelTask).mockRejectedValueOnce(
      new Error("native storage unavailable")
    )
    mocks.processDownloadQueue.mockRejectedValueOnce(
      new Error("queue activation failed")
    )

    await expect(commands.cancelTask("task-1")).rejects.toThrow(
      "queue activation failed"
    )
  })

  it("requires destination cleanup before activation", async () => {
    mocks.clearDestinationIssuesForTask.mockRejectedValueOnce(
      new Error("destination cleanup failed")
    )

    await expect(commands.retryDestination("task-1")).rejects.toThrow(
      "destination cleanup failed"
    )
    expect(queueRepository.resumeDestinationTask).toHaveBeenCalled()
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
  })

  it("activates after Undo only when a queued task was restored", async () => {
    mocks.restorePendingUndoAndCleanup
      .mockResolvedValueOnce({
        outcome: "applied",
        action: pendingAction("remove_history"),
        restored: true,
      })
      .mockResolvedValueOnce({
        outcome: "applied",
        action: pendingAction("cancel_queued"),
        restored: true,
      })

    await expect(commands.undoQueueAction("history")).resolves.toEqual({
      restoredQueuedTask: false,
    })
    await expect(commands.undoQueueAction("queued")).resolves.toEqual({
      restoredQueuedTask: true,
    })
    expect(mocks.processDownloadQueue).toHaveBeenCalledTimes(1)
  })
})
