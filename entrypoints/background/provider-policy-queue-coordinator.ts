import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"
import logger from "@/src/runtime/logger"
import { isEnabled } from "@/src/site-integrations/catalog"
import type { ProviderNetworkPolicyContinuationCoordinator } from "@/src/site-integrations/provider-network-policy-continuation"
import { isRunnableQueuedTask } from "@/src/domain/queue/task-lifecycle"
import type { QueueRepository } from "@/src/storage/queue-repository"

import type { NativeOutputCoordinator } from "./native-output-coordinator"
import type { DownloadTaskCancellationCoordinator } from "./download-task-cancellation-coordinator"

export class ProviderPolicyQueueCoordinator {
  private continuationRevisionAwaitingAdmission: number | null = null

  constructor(
    private readonly queueRepository: QueueRepository,
    private readonly nativeOutputCoordinator: NativeOutputCoordinator,
    private readonly cancellationCoordinator: DownloadTaskCancellationCoordinator,
    private readonly continuation: ProviderNetworkPolicyContinuationCoordinator
  ) {}

  async acknowledgeAfterAdmission(): Promise<void> {
    const revision = this.continuationRevisionAwaitingAdmission
    if (revision === null) return
    try {
      await this.continuation.clearContinuation(revision)
      this.continuationRevisionAwaitingAdmission = null
    } catch (error) {
      logger.warn(
        "Provider policy acknowledgement will be retried without failing the admitted task",
        error
      )
      try {
        await this.nativeOutputCoordinator.armLiveness()
      } catch (alarmError) {
        logger.warn("Unable to arm provider policy acknowledgement recovery", {
          revision,
          error: alarmError,
        })
      }
    }
  }

  async resumeBlockedQueue(): Promise<boolean> {
    const continuation = await this.continuation.readContinuation()
    if (
      !continuation ||
      !this.continuation.isContinuationCurrent(continuation.revision)
    ) {
      return false
    }
    if (continuation.consumed) {
      await this.continuation.clearContinuation(continuation.revision)
      return false
    }

    await this.queueRepository.releaseProviderPolicyBlocks()
    this.continuationRevisionAwaitingAdmission = continuation.revision
    const queue = await this.queueRepository.getQueue()
    if (queue.some(isRunnableQueuedTask)) return true

    this.continuationRevisionAwaitingAdmission = null
    await this.continuation.clearContinuation(continuation.revision)
    return false
  }

  async failDisabledTasks(
    enablement: SiteIntegrationEnablementMap
  ): Promise<boolean> {
    const nativeOutputTaskIds = new Set(
      await this.nativeOutputCoordinator.getLiveTaskIds()
    )
    const disabledTasks = (await this.queueRepository.getQueue()).filter(
      (task) =>
        (task.status === "queued" || task.status === "downloading") &&
        !nativeOutputTaskIds.has(task.id) &&
        !isEnabled(task.siteIntegrationId, enablement)
    )

    let transitioned = false
    for (const task of disabledTasks) {
      const outcome = await this.cancellationCoordinator.interruptTask({
        taskId: task.id,
        errorMessage: "Integration disabled",
        preserveNativeOutput: true,
      })
      if (outcome === "quarantined") return false
      if (outcome === "settled") transitioned = true
    }
    return transitioned
  }
}
