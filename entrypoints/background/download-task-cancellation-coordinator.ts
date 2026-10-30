import type { DownloadErrorCategory } from "@/src/shared/download-contract"
import logger from "@/src/runtime/logger"
import type {
  DispatchLeaseAuthority,
  DownloadTaskState,
  PendingUndoReceipt,
} from "@/src/domain/queue/state"
import type { NativeOutputJobIdentity } from "@/src/domain/native-output/state"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { RuntimeMessageResponse } from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import { progressTimingEstimatesRepository as progressTimingEstimator } from "@/src/storage/progress-timing-estimates-repository"
import { isTerminalDownloadTask } from "@/src/domain/queue/task-lifecycle"

import type { NativeOutputCoordinator } from "./native-output-coordinator"
import { runTaskSideEffectExclusive } from "./download-task-side-effect-gate"
import { schedulePendingUndoAction } from "./pending-undo-coordinator"
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
      if (transition.outcome === "rejected") {
        return await this.resolveRejectedCancellation(
          taskId,
          commandId,
          transition.reason
        )
      }

      if (transition.undo) {
        await schedulePendingUndoAction(this.queueRepository, transition.undo)
        return {
          result: { kind: "queued", undo: transition.undo },
          queueCanContinue: false,
        }
      }

      return await this.finishActiveCancellation(
        taskId,
        transition.canceledLease
      )
    })
  }

  private async resolveRejectedCancellation(
    taskId: string,
    commandId: string,
    reason: string
  ): Promise<{ result: CancelTaskResult; queueCanContinue: boolean }> {
    // A missing or terminal task already satisfies this cancellation.
    const task = await this.queueRepository.getTask(taskId)
    if (task?.activeCancel && task.activeCancel.commandId !== commandId) {
      throw new Error("Download task was already canceled by another command.")
    }
    if (!task || isTerminalDownloadTask(task)) {
      return { result: { kind: "active" }, queueCanContinue: true }
    }
    throw new Error(
      reason === "task-not-found"
        ? "Download task not found."
        : "Only queued or downloading tasks can be canceled."
    )
  }

  private async finishActiveCancellation(
    taskId: string,
    lease: DispatchLeaseAuthority | null | undefined
  ): Promise<{ result: CancelTaskResult; queueCanContinue: boolean }> {
    await clearActiveTaskProgress()
    if (lease) {
      await progressTimingEstimator.finish(lease.jobId)
    }

    const canceledJob = lease
      ? await this.cancelProducerAndClearLease(lease)
      : undefined
    if (lease && !canceledJob) {
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
  }

  async failTaskForSave(input: {
    taskId: string
    chapterId?: string
    errorMessage: string
    errorCategory: DownloadErrorCategory
  }): Promise<TaskInterruptionOutcome> {
    return runTaskSideEffectExclusive(input.taskId, async () => {
      const activeLease = await this.queueRepository.getActiveDispatchLease()
      const ownedLease = getOwnedLease(activeLease, input.taskId)
      const failure = await this.queueRepository.failTaskForSave({
        ...input,
        now: Date.now(),
      })
      if (failure.outcome !== "applied") return "not-applied"
      if (ownedLease && !(await this.cancelProducerAndClearLease(ownedLease))) {
        await this.nativeOutputCoordinator.armLiveness()
        return "quarantined"
      }
      await clearProgressAfterSaveFailure()
      await this.notifyTerminalTask(failure.task)
      return "settled"
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
      const ownedLease = getOwnedLease(activeLease, input.taskId)
      if (
        !task ||
        (task.status !== "queued" && task.status !== "downloading")
      ) {
        return await this.preserveTerminalLease(ownedLease)
      }

      const interruption = await this.queueRepository.interruptDownloadTask({
        taskId: input.taskId,
        errorMessage: input.errorMessage,
        now: Date.now(),
      })
      if (interruption.outcome !== "applied") {
        return await this.preserveTerminalLease(ownedLease)
      }
      return await this.finishInterruption(interruption.task, ownedLease)
    })
  }

  private async preserveTerminalLease(
    lease: DispatchLeaseAuthority | undefined
  ): Promise<TaskInterruptionOutcome> {
    if (!lease) return "not-applied"
    await this.nativeOutputCoordinator.armLiveness()
    return "quarantined"
  }

  private async finishInterruption(
    task: DownloadTaskState,
    lease: DispatchLeaseAuthority | undefined
  ): Promise<TaskInterruptionOutcome> {
    if (lease) {
      const canceledJob = await this.cancelProducerAndClearLease(lease)
      if (!canceledJob) return await this.preserveTerminalLease(lease)
      await this.nativeOutputCoordinator.cancelTask(task.id, canceledJob)
    }
    await clearActiveTaskProgress()
    await this.notifyTerminalTask(task)
    return "settled"
  }

  private async notifyTerminalTask(task: DownloadTaskState): Promise<void> {
    await notifyTerminalDownloadTask({
      task,
      finalStatus: task.status,
      completedCount: task.chapters.filter(
        (chapter) => chapter.status === "completed"
      ).length,
      totalChapters: task.chapters.length,
      settingsRepository: this.finalizationDependencies.settingsRepository,
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
      if (!isCancellationConverged(response, identity)) {
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

function getOwnedLease(
  lease: DispatchLeaseAuthority | null,
  taskId: string
): DispatchLeaseAuthority | undefined {
  return lease?.taskId === taskId ? lease : undefined
}

function matchesCancellationIdentity(
  response: Extract<
    RuntimeMessageResponse<"OFFSCREEN_CANCEL_JOB">,
    { success: true }
  >,
  identity: NativeOutputJobIdentity
): boolean {
  return (
    response.jobId === identity.jobId &&
    response.attempt === identity.attempt &&
    response.taskId === identity.taskId &&
    response.chapterId === identity.chapterId &&
    response.fingerprint === identity.fingerprint &&
    response.documentInstanceId === identity.documentInstanceId
  )
}

function isCancellationConverged(
  response: RuntimeMessageResponse<"OFFSCREEN_CANCEL_JOB">,
  identity: NativeOutputJobIdentity
): boolean {
  if (!response.success || !matchesCancellationIdentity(response, identity))
    return false
  return (
    (response.canceled && response.status === "canceled") ||
    (!response.canceled &&
      (response.status === "absent" || response.status === "terminal"))
  )
}

async function clearProgressAfterSaveFailure(): Promise<void> {
  try {
    await clearActiveTaskProgress()
  } catch (error) {
    logger.warn("Could not clear progress after terminal save failure", error)
  }
}
