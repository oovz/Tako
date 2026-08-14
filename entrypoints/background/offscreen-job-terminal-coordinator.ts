import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import { progressTimingEstimator } from "@/src/runtime/progress-timing-estimates"
import type { QueueRepository } from "@/src/storage/queue-repository"
import {
  isTerminalChapterStatus,
  isTerminalDownloadTask,
} from "@/src/domain/queue/task-lifecycle"

import type { NativeOutputCoordinator } from "./native-output-coordinator"
import type { QueueScheduler } from "./queue-scheduler"
import {
  clearActiveTaskProgress,
  settleActiveTaskProgressChapter,
} from "./active-task-progress-bus"
import type { DestinationService } from "./destination"
import {
  finalizeDownloadTaskAfterDispatch,
  notifyDownloadTaskCompletion,
  notifyTerminalDownloadTask,
  type DownloadQueueFinalizationDependencies,
} from "./download-queue-finalization"

type OffscreenTerminalPayload =
  RuntimeMessageRequest<"OFFSCREEN_JOB_TERMINAL">["payload"]
export type OffscreenTerminalSettlement =
  "native-output-pending" | "chapter-settled" | "destination-blocked"

export class OffscreenJobTerminalCoordinator {
  constructor(
    private readonly queueRepository: QueueRepository,
    private readonly nativeOutputCoordinator: NativeOutputCoordinator,
    private readonly queueScheduler: QueueScheduler,
    private readonly destinationService: DestinationService,
    private readonly finalizationDependencies: DownloadQueueFinalizationDependencies
  ) {}

  async handle(payload: OffscreenTerminalPayload): Promise<void> {
    const settlement = await this.settle(payload)
    await this.afterSettlement(payload.taskId, settlement)
  }

  async afterSettlement(
    taskId: string,
    settlement: OffscreenTerminalSettlement
  ): Promise<void> {
    if (settlement === "native-output-pending") {
      await this.nativeOutputCoordinator.reconcile()
      return
    }
    if (settlement === "chapter-settled") {
      await this.continueTask(taskId)
    }
  }

  async settle(
    payload: OffscreenTerminalPayload
  ): Promise<OffscreenTerminalSettlement> {
    const lease = await this.queueRepository.getActiveDispatchLease()
    if (
      !lease ||
      lease.jobId !== payload.jobId ||
      lease.attempt !== payload.attempt ||
      lease.taskId !== payload.taskId ||
      lease.chapterId !== payload.chapterId ||
      lease.fingerprint !== payload.fingerprint ||
      lease.documentInstanceId !== payload.documentInstanceId
    ) {
      throw new Error("Terminal event no longer owns the dispatch lease")
    }

    if (lease.saveMode === "downloads-api") {
      await this.nativeOutputCoordinator.sealManifest({
        jobId: payload.jobId,
        attempt: payload.attempt,
        taskId: payload.taskId,
        chapterId: payload.chapterId,
        fingerprint: payload.fingerprint,
        documentInstanceId: payload.documentInstanceId,
        outputsRequested: payload.outcome.outputsRequested,
        outputsFailedBeforeHandoff: payload.outcome.outputsFailedBeforeHandoff,
      })
      const clearing = await this.queueRepository.clearDispatchLease(payload)
      if (clearing.outcome !== "applied") {
        throw new Error("Native output terminal lease clear was rejected")
      }
      await progressTimingEstimator.finish(payload.jobId)
      return "native-output-pending"
    }

    const requested = payload.outcome.outputsRequested
    const committed = payload.outcome.outputsCommitted
    const failed = Math.max(
      payload.outcome.outputsFailedBeforeHandoff,
      requested - committed
    )
    const destinationIssueKind =
      payload.outcome.errorCategory === "folder_permission_required"
        ? "fsa_permission_required"
        : payload.outcome.errorCategory === "folder_unavailable"
          ? "fsa_folder_missing"
          : payload.outcome.errorCategory === "disk_full"
            ? "disk_full"
            : payload.outcome.errorCategory === "folder_write_failed"
              ? "fsa_write_failed"
              : null
    if (destinationIssueKind) {
      const task = await this.queueRepository.getTask(payload.taskId)
      const transition = await this.queueRepository.blockTaskForDestination({
        taskId: payload.taskId,
        now: Date.now(),
        errorMessage: payload.outcome.errorMessage,
        errorCategory: payload.outcome.errorCategory,
        chapter: {
          chapterId: payload.chapterId,
          lease: payload,
          imagesFailed: payload.outcome.imagesFailed,
          outputs: { requested, committed, failed },
        },
      })
      if (transition.outcome === "applied" && task) {
        await this.destinationService.recordDestinationRuntimeIssue(
          {
            taskId: payload.taskId,
            chapterId: payload.chapterId,
            destination: task.settingsSnapshot.destination,
            destinationOverride: task.destinationOverride,
          },
          destinationIssueKind
        )
      }
      if (transition.outcome === "rejected") {
        throw new Error("Destination-block terminal settlement was rejected")
      }
      const clearing = await this.queueRepository.clearDispatchLease(payload)
      if (clearing.outcome !== "applied") {
        throw new Error("Destination-block terminal lease clear was rejected")
      }
      await clearActiveTaskProgress()
      await progressTimingEstimator.finish(payload.jobId)
      return "destination-blocked"
    }

    const settlement = await this.queueRepository.settleTaskChapter({
      taskId: payload.taskId,
      chapterId: payload.chapterId,
      status: payload.outcome.status,
      lease: payload,
      now: payload.terminalAt,
      updates: {
        errorMessage: payload.outcome.errorMessage,
        errorCategory: payload.outcome.errorCategory,
        imagesFailed: payload.outcome.imagesFailed,
        outputs: { requested, committed, failed },
      },
    })
    if (settlement.outcome === "rejected") {
      throw new Error("Terminal chapter settlement was rejected")
    }
    const clearing = await this.queueRepository.clearDispatchLease(payload)
    if (clearing.outcome !== "applied") {
      throw new Error("Terminal dispatch lease clear was rejected")
    }
    const task = await this.queueRepository.getTask(payload.taskId)
    if (task) {
      await settleActiveTaskProgressChapter({
        taskId: payload.taskId,
        chapterId: payload.chapterId,
        chapters: task.chapters,
        destinationCommitted:
          requested > 0 && committed === requested && failed === 0,
      })
    }
    await progressTimingEstimator.finish(payload.jobId)
    return "chapter-settled"
  }

  async continueTask(taskId: string): Promise<void> {
    const task = await this.queueRepository.getTask(taskId)
    if (!task) return
    if (isTerminalDownloadTask(task)) {
      await notifyTerminalDownloadTask({
        task,
        finalStatus: task.status,
        completedCount: task.chapters.filter(
          (chapter) => chapter.status === "completed"
        ).length,
        totalChapters: task.chapters.length,
        settingsRepository: this.finalizationDependencies.settingsRepository,
      })
      this.queueScheduler.requestContinuation()
      return
    }
    if (task.status !== "downloading") return
    if (
      task.chapters.every((chapter) => isTerminalChapterStatus(chapter.status))
    ) {
      const outcomes = task.chapters.map((chapter) => ({
        chapterId: chapter.id,
        status: chapter.status as "completed" | "partial_success" | "failed",
        errorMessage: chapter.errorMessage,
        errorCategory: chapter.errorCategory,
        imagesFailed: chapter.imagesFailed,
      }))
      const finalization = await finalizeDownloadTaskAfterDispatch({
        stateManager: this.queueRepository,
        taskId,
        chapterOutcomesByIndex: outcomes,
        settingsSnapshot: task.settingsSnapshot,
        finalizationDependencies: this.finalizationDependencies,
      })
      if (finalization.finalized) {
        await notifyDownloadTaskCompletion({
          stateManager: this.queueRepository,
          taskId,
          finalStatus: finalization.finalStatus,
          completedCount: finalization.completedCount,
          totalChapters: finalization.chapterOutcomes.length,
          settingsRepository: this.finalizationDependencies.settingsRepository,
        })
        this.queueScheduler.requestContinuation()
      }
      return
    }

    const chapterDelayMs = Math.max(
      0,
      task.settingsSnapshot.rateLimitSettings.chapter.delayMs
    )
    const delayUpdate = await this.queueRepository.setNextChapterDispatchAt({
      taskId,
      nextChapterDispatchAt:
        chapterDelayMs > 0 ? Date.now() + chapterDelayMs : undefined,
    })
    if (delayUpdate.outcome === "rejected") {
      throw new Error("Next chapter dispatch deadline was rejected")
    }
    await this.queueScheduler.resumeTask(taskId)
  }
}
