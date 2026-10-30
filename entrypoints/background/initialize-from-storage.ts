import logger from "@/src/runtime/logger"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { notifyTerminalDownloadTask } from "@/entrypoints/background/download-queue-finalization"
import {
  isTerminalDownloadTask,
  isExecutingDownloadTask,
} from "@/src/domain/queue/task-lifecycle"
import type { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import {
  planStartupQueueActivation,
  type StartupQueueActivation,
} from "@/src/domain/queue/scheduler-policy"

interface InitializeFromStorageDependencies {
  settingsRepository: Pick<SettingsRepository, "getSettings">
  queueRepository: QueueRepository
  nativeOutputCoordinator: NativeOutputCoordinator
  terminalCoordinator: OffscreenJobTerminalCoordinator
  writeSession: (values: Record<string, unknown>) => Promise<void>
  getOffscreenActiveTaskIds: () => Promise<string[]>
  hasOffscreenDocument: () => Promise<boolean>
  terminateOffscreenDocumentForUnboundLease: () => Promise<void>
  cancelOffscreenJob: (
    identity: import("@/src/domain/native-output/state").NativeOutputJobIdentity
  ) => Promise<boolean>
  getOffscreenJobState: (identity: {
    jobId: string
    attempt: number
    taskId: string
    chapterId: string
    fingerprint: string
    documentInstanceId: string
  }) => Promise<OffscreenJobState | null>
  setLivenessAlarmArmed: (shouldArm: boolean) => Promise<void>
}

export interface InitializeFromStorageResult {
  queue: DownloadTaskState[]
  queueActivation?: StartupQueueActivation
}

class StartupRecovery {
  private initialQueue: DownloadTaskState[] = []
  private activeLease: Awaited<
    ReturnType<QueueRepository["getActiveDispatchLease"]>
  > = null
  private offscreenAlive = false
  private exactJobState: OffscreenJobState | null = null
  constructor(
    private readonly dependencies: InitializeFromStorageDependencies
  ) {}
  private async writeSessionProjection(
    values: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.dependencies.writeSession(values)
    } catch (error) {
      logger.warn("Unable to publish startup session projection", error)
    }
  }

  private async inspectProducer(): Promise<boolean> {
    this.initialQueue = await this.dependencies.queueRepository.getQueue()
    this.activeLease =
      await this.dependencies.queueRepository.getActiveDispatchLease()
    this.offscreenAlive = await this.dependencies.hasOffscreenDocument()

    if (this.activeLease && !this.activeLease.documentInstanceId) {
      await this.dependencies.terminateOffscreenDocumentForUnboundLease()
      this.offscreenAlive = false
    }
    if (!(await this.queryProducer())) return false
    if (!(await this.cancelTerminalTaskProducer())) return false
    await this.settleTerminalProducer()
    return true
  }
  private async queryProducer(): Promise<boolean> {
    if (this.offscreenAlive && this.activeLease?.documentInstanceId) {
      try {
        this.exactJobState = await this.dependencies.getOffscreenJobState({
          jobId: this.activeLease.jobId,
          attempt: this.activeLease.attempt,
          taskId: this.activeLease.taskId,
          chapterId: this.activeLease.chapterId,
          fingerprint: this.activeLease.fingerprint,
          documentInstanceId: this.activeLease.documentInstanceId,
        })
      } catch (error) {
        logger.warn("Unable to query the exact startup offscreen job", error)
        await this.dependencies.setLivenessAlarmArmed(true)
        return false
      }
    }
    return true
  }
  private async cancelTerminalTaskProducer(): Promise<boolean> {
    if (
      this.activeLease &&
      this.exactJobState?.status === "active" &&
      this.initialQueue.some(
        (task) =>
          task.id === this.activeLease?.taskId && isTerminalDownloadTask(task)
      )
    ) {
      const stopped = await this.dependencies.cancelOffscreenJob({
        jobId: this.exactJobState.jobId,
        attempt: this.exactJobState.attempt,
        taskId: this.exactJobState.taskId,
        chapterId: this.exactJobState.chapterId,
        fingerprint: this.exactJobState.fingerprint,
        documentInstanceId: this.exactJobState.documentInstanceId,
      })
      if (!stopped) {
        await this.dependencies.setLivenessAlarmArmed(true)
        return false
      }
      const cleared =
        await this.dependencies.queueRepository.clearDispatchLease(
          this.activeLease
        )
      if (cleared.outcome !== "applied")
        throw new Error(
          "Terminal task producer lease changed during startup cancellation"
        )
      this.activeLease = null
      this.exactJobState = null
    }
    return true
  }
  private async settleTerminalProducer(): Promise<void> {
    if (this.activeLease && this.exactJobState?.status === "terminal") {
      if (!this.exactJobState.outcome) {
        throw new Error("Terminal startup offscreen job has no outcome")
      }
      await this.dependencies.terminalCoordinator.settle({
        jobId: this.exactJobState.jobId,
        attempt: this.exactJobState.attempt,
        taskId: this.exactJobState.taskId,
        chapterId: this.exactJobState.chapterId,
        fingerprint: this.exactJobState.fingerprint,
        documentInstanceId: this.exactJobState.documentInstanceId,
        stage: this.exactJobState.stage,
        sequence: this.exactJobState.lastSequence,
        terminalAt: Date.now(),
        outcome: this.exactJobState.outcome,
      })
      this.activeLease =
        await this.dependencies.queueRepository.getActiveDispatchLease()
      this.exactJobState = null
    }
  }
  private async producerFacts() {
    const offscreenActiveTaskIds =
      this.exactJobState?.status === "active"
        ? [this.exactJobState.taskId]
        : this.offscreenAlive
          ? [
              ...new Set(await this.dependencies.getOffscreenActiveTaskIds()),
            ].sort((left, right) => left.localeCompare(right))
          : []

    const observedLease = this.activeLease
      ? {
          jobId: this.activeLease.jobId,
          attempt: this.activeLease.attempt,
          taskId: this.activeLease.taskId,
          chapterId: this.activeLease.chapterId,
          fingerprint: this.activeLease.fingerprint,
          documentInstanceId: this.activeLease.documentInstanceId,
        }
      : null
    const observedBoundLease = this.activeLease?.documentInstanceId
      ? {
          jobId: this.activeLease.jobId,
          attempt: this.activeLease.attempt,
          taskId: this.activeLease.taskId,
          chapterId: this.activeLease.chapterId,
          fingerprint: this.activeLease.fingerprint,
          documentInstanceId: this.activeLease.documentInstanceId,
        }
      : null
    const offscreenJob = this.exactJobState
      ? {
          jobId: this.exactJobState.jobId,
          attempt: this.exactJobState.attempt,
          taskId: this.exactJobState.taskId,
          chapterId: this.exactJobState.chapterId,
          fingerprint: this.exactJobState.fingerprint,
          documentInstanceId: this.exactJobState.documentInstanceId,
          status: this.exactJobState.status,
        }
      : null

    return {
      offscreenActiveTaskIds,
      observedLease,
      observedBoundLease,
      offscreenJob,
    }
  }
  private async publishRecovery(
    normalizedQueue: DownloadTaskState[],
    interruptedIds: string[]
  ): Promise<void> {
    const interruptedTaskIds = new Set(interruptedIds)
    if (interruptedTaskIds.size > 0) {
      await this.writeSessionProjection({
        [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
      })
      logger.warn("Startup recovery normalized an unreconciled job", {
        persistedTaskIds: interruptedIds,
        lease: this.activeLease,
        offscreenJob: this.exactJobState,
      })
    }

    for (const task of normalizedQueue) {
      if (!interruptedTaskIds.has(task.id)) continue
      await notifyTerminalDownloadTask({
        task,
        finalStatus: task.status,
        completedCount: task.chapters.filter(
          (chapter) => chapter.status === "completed"
        ).length,
        totalChapters: task.chapters.length,
        settingsRepository: this.dependencies.settingsRepository,
      })
    }

    await this.writeSessionProjection({
      [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
    })
  }
  private async armRecoveryAlarm(
    normalizedQueue: DownloadTaskState[],
    offscreenActiveTaskIds: string[]
  ) {
    const nativeTaskIds = new Set(
      await this.dependencies.nativeOutputCoordinator.getLiveTaskIds()
    )
    const currentLease =
      await this.dependencies.queueRepository.getActiveDispatchLease()
    const hasOffscreenExecutingTask = normalizedQueue.some(
      (task) => isExecutingDownloadTask(task) && !nativeTaskIds.has(task.id)
    )
    const hasNativeOutputDependencies =
      await this.dependencies.nativeOutputCoordinator.hasLiveDependencies()
    const hasDurableActiveWork =
      hasOffscreenExecutingTask ||
      currentLease !== null ||
      offscreenActiveTaskIds.length > 0 ||
      hasNativeOutputDependencies
    await this.dependencies.setLivenessAlarmArmed(hasDurableActiveWork)

    return currentLease
  }
  async run(): Promise<InitializeFromStorageResult> {
    if (!(await this.inspectProducer())) return { queue: this.initialQueue }
    const {
      offscreenActiveTaskIds,
      observedLease,
      observedBoundLease,
      offscreenJob,
    } = await this.producerFacts()
    const startupNativeOutput =
      await this.dependencies.nativeOutputCoordinator.reconcileStartupOpenManifests(
        {
          offscreenJob: this.exactJobState,
          activeLease: observedBoundLease,
        }
      )
    const nativeOutputTaskIds =
      await this.dependencies.nativeOutputCoordinator.getLiveTaskIds()
    const recoveryFacts = {
      normalizationTime: Date.now(),
      interruptedAt: Date.now(),
      observedLease,
      offscreenJob: startupNativeOutput.observedJobSealed ? null : offscreenJob,
      nativeOutputTaskIds,
    } satisfies Parameters<QueueRepository["recoverQueueAfterStartup"]>[0]

    const recovery =
      await this.dependencies.queueRepository.recoverQueueAfterStartup(
        recoveryFacts
      )
    if (recovery.outcome === "rejected") {
      throw new Error("Startup dispatch lease changed during recovery")
    }

    const nativeSettlementEffects = [
      ...startupNativeOutput.effects,
      ...(await this.dependencies.nativeOutputCoordinator.reconcile()),
    ]
    await this.dependencies.terminalCoordinator.continueAfterNativeOutputSettlement(
      nativeSettlementEffects
    )
    const normalizedQueue = await this.dependencies.queueRepository.getQueue()
    await this.publishRecovery(normalizedQueue, recovery.interruptedTaskIds)
    const currentLease = await this.armRecoveryAlarm(
      normalizedQueue,
      offscreenActiveTaskIds
    )
    const queueActivation = planStartupQueueActivation({
      queue: normalizedQueue,
      resumeTaskId: recovery.resumeTaskId,
      activeLease: currentLease,
      offscreenActiveTaskIds,
    })

    return {
      queue: normalizedQueue,
      queueActivation,
    }
  }
}
export async function initializeFromStorage(
  dependencies: InitializeFromStorageDependencies
): Promise<InitializeFromStorageResult> {
  return new StartupRecovery(dependencies).run()
}
