import { describe, expect, it, vi } from "vitest"

import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import type { DestinationService } from "@/entrypoints/background/destination"
import type { DownloadQueueFinalizationDependencies } from "@/entrypoints/background/download-queue-finalization"
import type { DispatchLeaseAuthority } from "@/src/domain/queue/state"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"

describe("DownloadTaskCancellationCoordinator", () => {
  it("routes a native-output action-required cancellation through surrender without Undo", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    } as unknown as typeof chrome)
    const cancelDownloadTask = vi.fn(async () => ({
      outcome: "applied" as const,
      task: { id: "task-1", status: "canceled" },
      canceledLease: null,
      undo: null,
    }))
    const queueRepository = {
      cancelDownloadTask,
      getActiveDispatchLease: vi.fn(async () => null),
    } as unknown as QueueRepository
    const nativeOutputCoordinator = {
      cancelTask: vi.fn(async () => undefined),
    } as unknown as NativeOutputCoordinator
    const destinationService = {
      clearDestinationIssuesForTask: vi.fn(async () => undefined),
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
    const coordinator = new DownloadTaskCancellationCoordinator(
      queueRepository,
      nativeOutputCoordinator,
      destinationService,
      finalizationDependencies
    )

    await expect(coordinator.cancelTask("task-1")).resolves.toEqual({
      result: { kind: "active" },
      queueCanContinue: true,
    })
    expect(cancelDownloadTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1" })
    )
    // No Undo receipt is created, so the surrender path runs with the exact
    // identity the coordinator derived from the (absent) lease.
    expect(nativeOutputCoordinator.cancelTask).toHaveBeenCalledWith(
      "task-1",
      undefined
    )
  })

  it("converges a cancel replay when the task is already gone or terminal", async () => {
    const cancelDownloadTask = vi.fn(async () => ({
      outcome: "rejected" as const,
      reason: "task-not-found",
    }))
    const queueRepository = {
      cancelDownloadTask,
      getTask: vi.fn(async () => undefined),
      getActiveDispatchLease: vi.fn(async () => null),
    } as unknown as QueueRepository
    const nativeOutputCoordinator = {
      cancelTask: vi.fn(async () => undefined),
    } as unknown as NativeOutputCoordinator
    const destinationService = {
      clearDestinationIssuesForTask: vi.fn(async () => undefined),
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
    const coordinator = new DownloadTaskCancellationCoordinator(
      queueRepository,
      nativeOutputCoordinator,
      destinationService,
      finalizationDependencies
    )

    await expect(coordinator.cancelTask("task-1")).resolves.toEqual({
      result: { kind: "active" },
      queueCanContinue: true,
    })
    expect(nativeOutputCoordinator.cancelTask).not.toHaveBeenCalled()
  })

  it("quarantines an unbound lease instead of treating it as undispatched", async () => {
    const clearDispatchLease = vi.fn()
    const queueRepository = {
      clearDispatchLease,
    } as unknown as QueueRepository
    const nativeOutputCoordinator = {
      cancelTask: vi.fn(),
    } as unknown as NativeOutputCoordinator
    const destinationService = {
      clearDestinationIssuesForTask: vi.fn(async () => undefined),
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
    const coordinator = new DownloadTaskCancellationCoordinator(
      queueRepository,
      nativeOutputCoordinator,
      destinationService,
      finalizationDependencies
    )
    const ambiguousLease = {
      jobId: "job-1",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
      fingerprint: "a".repeat(64),
    } satisfies DispatchLeaseAuthority

    await expect(
      coordinator.cancelProducerAndClearLease(ambiguousLease)
    ).resolves.toBeUndefined()
    expect(clearDispatchLease).not.toHaveBeenCalled()
    expect(nativeOutputCoordinator.cancelTask).not.toHaveBeenCalled()
  })
})
