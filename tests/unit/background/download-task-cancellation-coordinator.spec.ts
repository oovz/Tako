import { describe, expect, it, vi } from "vitest"

import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import type { DestinationService } from "@/entrypoints/background/destination"
import type { DownloadQueueFinalizationDependencies } from "@/entrypoints/background/download-queue-finalization"
import type { DispatchLeaseAuthority } from "@/src/domain/queue/state"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"

describe("DownloadTaskCancellationCoordinator", () => {
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
