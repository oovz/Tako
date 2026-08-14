import logger from "@/src/runtime/logger"
import type {
  DispatchLeaseAuthority,
  PendingUndoReceipt,
} from "@/src/domain/queue/state"
import type { NativeOutputJobIdentity } from "@/src/domain/native-output/state"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import { progressTimingEstimator } from "@/src/runtime/progress-timing-estimates"
import { isTerminalDownloadTask } from "@/src/domain/queue/task-lifecycle"

import type { NativeOutputCoordinator } from "./native-output-coordinator"
import { runTaskSideEffectExclusive } from "./download-task-side-effect-gate"
import { schedulePendingUndoAction } from "./pending-undo-coordinator"
import type { DestinationService } from "./destination"
import { clearActiveTaskProgress } from "./active-task-progress-bus"
import {
  notifyTerminalDownloadTask,
  type DownloadQueueFinalizationDependencies,
} from "./download-queue-finalization"

export type CancelTaskResult =
  { kind: "queued"; undo: PendingUndoReceipt } | { kind: "active" }

export type TaskInterruptionOutcome = "settled" | "quarantined" | "not-applied"

export class DownloadTaskCancellationCoordinator {
  constructor(
    private readonly queueRepository: QueueRepository,
    private readonly nativeOutputCoordinator: NativeOutputCoordinator,
    private readonly destinationService: DestinationService,
    private readonly finalizationDependencies: DownloadQueueFinalizationDependencies
  ) {}

  async cancelTask(
    taskId: string,
    commandId: string
  ): Promise<{
    result: CancelTaskResult
    queueCanContinue: boolean
  }> {
    return await runTaskSideEffectExclusive(taskId, async () => {
      const transition = await this.queueRepository.cancelDownloadTask({
        taskId,
        commandId,
        now: Date.now(),
      })
      if (transition.outcome === "unchanged" && transition.undo) {
        await schedulePendingUndoAction(
          this.queueRepository,
          transition.undo,
          this.destinationService
        )
        return {
          result: { kind: "queued", undo: transition.undo },
          queueCanContinue: false,
        }
      }
      if (transition.outcome === "rejected") {
        // Replay of an already-applied cancel: the task is gone or already
        // terminal, which IS the durable result of this command.
        const task = await this.queueRepository.getTask(taskId)
        if (task?.activeCancel && task.activeCancel.commandId !== commandId) {
          throw new Error(
            "Download task was already canceled by another command."
          )
        }
        if (!task || isTerminalDownloadTask(task)) {
          return { result: { kind: "active" }, queueCanContinue: true }
        }
        throw new Error(
          transition.reason === "task-not-found"
            ? "Download task not found."
            : "Only queued or downloading tasks can be canceled."
        )
      }

      if (transition.undo) {
        await schedulePendingUndoAction(
          this.queueRepository,
          transition.undo,
          this.destinationService
        )
        return {
          result: { kind: "queued", undo: transition.undo },
          queueCanContinue: false,
        }
      }

      try {
        await this.destinationService.clearDestinationIssuesForTask(taskId)
      } catch (error) {
        logger.warn(
          "[Queue] Destination diagnostic cleanup failed after cancellation",
          error
        )
      }
      await clearActiveTaskProgress()
      if (transition.canceledLease) {
        await progressTimingEstimator.finish(transition.canceledLease.jobId)
      }

      const canceledJob = transition.canceledLease
        ? await this.cancelProducerAndClearLease(transition.canceledLease)
        : undefined
      if (transition.canceledLease && !canceledJob) {
        return { result: { kind: "active" }, queueCanContinue: false }
      }

      try {
        await this.nativeOutputCoordinator.cancelTask(taskId, canceledJob)
      } catch (error) {
        logger.warn("Native output cleanup failed after durable cancellation", {
          taskId,
          error,
        })
      }
      return { result: { kind: "active" }, queueCanContinue: true }
    })
  }

  async interruptTask(input: {
    taskId: string
    errorMessage: string
    preserveNativeOutput?: boolean
  }): Promise<TaskInterruptionOutcome> {
    return await runTaskSideEffectExclusive(input.taskId, async () => {
      if (
        input.preserveNativeOutput &&
        (await this.nativeOutputCoordinator.getLiveTaskIds()).includes(
          input.taskId
        )
      ) {
        return "not-applied"
      }
      const [task, activeLease] = await Promise.all([
        this.queueRepository.getTask(input.taskId),
        this.queueRepository.getActiveDispatchLease(),
      ])
      if (
        !task ||
        (task.status !== "queued" && task.status !== "downloading")
      ) {
        if (activeLease?.taskId === input.taskId) {
          await this.nativeOutputCoordinator.armLiveness()
          return "quarantined"
        }
        return "not-applied"
      }

      const ownedLease =
        activeLease?.taskId === input.taskId ? activeLease : undefined
      const interruption = await this.queueRepository.interruptDownloadTask({
        taskId: input.taskId,
        errorMessage: input.errorMessage,
        now: Date.now(),
      })
      if (interruption.outcome !== "applied") {
        if (ownedLease) await this.nativeOutputCoordinator.armLiveness()
        return ownedLease ? "quarantined" : "not-applied"
      }

      if (ownedLease) {
        const canceledJob = await this.cancelProducerAndClearLease(ownedLease)
        if (!canceledJob) {
          await this.nativeOutputCoordinator.armLiveness()
          return "quarantined"
        }
        await this.nativeOutputCoordinator.cancelTask(input.taskId, canceledJob)
      }

      await clearActiveTaskProgress()
      await notifyTerminalDownloadTask({
        task: interruption.task,
        finalStatus: interruption.task.status,
        completedCount: interruption.task.chapters.filter(
          (chapter) => chapter.status === "completed"
        ).length,
        totalChapters: interruption.task.chapters.length,
        settingsRepository: this.finalizationDependencies.settingsRepository,
      })
      return "settled"
    })
  }

  async cancelProducerAndClearLease(
    lease: DispatchLeaseAuthority
  ): Promise<NativeOutputJobIdentity | undefined> {
    const documentInstanceId = lease.documentInstanceId
    if (!documentInstanceId) {
      logger.warn("Offscreen cancellation is awaiting incarnation binding", {
        taskId: lease.taskId,
        jobId: lease.jobId,
      })
      return undefined
    }

    const identity: NativeOutputJobIdentity = {
      jobId: lease.jobId,
      attempt: lease.attempt,
      taskId: lease.taskId,
      chapterId: lease.chapterId,
      fingerprint: lease.fingerprint,
      documentInstanceId,
    }
    try {
      const response = await sendRuntimeMessage({
        target: "offscreen",
        type: "OFFSCREEN_CANCEL_JOB",
        payload: identity,
      })
      const exactIdentity =
        response.success &&
        response.jobId === identity.jobId &&
        response.attempt === identity.attempt &&
        response.taskId === identity.taskId &&
        response.chapterId === identity.chapterId &&
        response.fingerprint === identity.fingerprint &&
        response.documentInstanceId === identity.documentInstanceId
      const converged =
        exactIdentity &&
        ((response.canceled && response.status === "canceled") ||
          (!response.canceled &&
            (response.status === "absent" || response.status === "terminal")))
      if (!converged) {
        logger.warn("Offscreen cancellation acknowledgement did not match", {
          taskId: lease.taskId,
          response,
        })
        return undefined
      }

      const clearing = await this.queueRepository.clearDispatchLease(lease)
      return clearing.outcome === "applied" ? identity : undefined
    } catch (error) {
      logger.warn("Offscreen cancellation was not delivered", {
        taskId: lease.taskId,
        error,
      })
      return undefined
    }
  }
}
