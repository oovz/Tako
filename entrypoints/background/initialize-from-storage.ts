import logger from "@/src/runtime/logger"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { notifyTerminalDownloadTask } from "@/entrypoints/background/download-queue-finalization"
import { isExecutingDownloadTask } from "@/src/domain/queue/task-lifecycle"
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

export async function initializeFromStorage(
  dependencies: InitializeFromStorageDependencies
): Promise<InitializeFromStorageResult> {
  const { writeSession, getOffscreenActiveTaskIds } = dependencies
  const writeSessionProjection = async (
    values: Record<string, unknown>
  ): Promise<void> => {
    try {
      await writeSession(values)
    } catch (error) {
      logger.warn("Unable to publish startup session projection", error)
    }
  }
  const initialQueue = await dependencies.queueRepository.getQueue()
  let activeLease = await dependencies.queueRepository.getActiveDispatchLease()
  let offscreenAlive = await dependencies.hasOffscreenDocument()
  let exactJobState: OffscreenJobState | null = null
  if (activeLease && !activeLease.documentInstanceId) {
    await dependencies.terminateOffscreenDocumentForUnboundLease()
    offscreenAlive = false
  }
  if (offscreenAlive && activeLease?.documentInstanceId) {
    try {
      exactJobState = await dependencies.getOffscreenJobState({
        jobId: activeLease.jobId,
        attempt: activeLease.attempt,
        taskId: activeLease.taskId,
        chapterId: activeLease.chapterId,
        fingerprint: activeLease.fingerprint,
        documentInstanceId: activeLease.documentInstanceId,
      })
    } catch (error) {
      logger.warn("Unable to query the exact startup offscreen job", error)
      await dependencies.setLivenessAlarmArmed(true)
      return { queue: initialQueue }
    }
  }
  if (activeLease && exactJobState?.status === "terminal") {
    if (!exactJobState.outcome) {
      throw new Error("Terminal startup offscreen job has no outcome")
    }
    await dependencies.terminalCoordinator.settle({
      jobId: exactJobState.jobId,
      attempt: exactJobState.attempt,
      taskId: exactJobState.taskId,
      chapterId: exactJobState.chapterId,
      fingerprint: exactJobState.fingerprint,
      documentInstanceId: exactJobState.documentInstanceId,
      stage: exactJobState.stage,
      sequence: exactJobState.lastSequence,
      terminalAt: Date.now(),
      outcome: exactJobState.outcome,
    })
    activeLease = await dependencies.queueRepository.getActiveDispatchLease()
    exactJobState = null
  }
  const offscreenActiveTaskIds =
    exactJobState?.status === "active"
      ? [exactJobState.taskId]
      : offscreenAlive
        ? [...new Set(await getOffscreenActiveTaskIds())].sort((left, right) =>
            left.localeCompare(right)
          )
        : []

  const observedLease = activeLease
    ? {
        jobId: activeLease.jobId,
        attempt: activeLease.attempt,
        taskId: activeLease.taskId,
        chapterId: activeLease.chapterId,
        fingerprint: activeLease.fingerprint,
        documentInstanceId: activeLease.documentInstanceId,
      }
    : null
  const observedBoundLease = activeLease?.documentInstanceId
    ? {
        jobId: activeLease.jobId,
        attempt: activeLease.attempt,
        taskId: activeLease.taskId,
        chapterId: activeLease.chapterId,
        fingerprint: activeLease.fingerprint,
        documentInstanceId: activeLease.documentInstanceId,
      }
    : null
  const offscreenJob = exactJobState
    ? {
        jobId: exactJobState.jobId,
        attempt: exactJobState.attempt,
        taskId: exactJobState.taskId,
        chapterId: exactJobState.chapterId,
        fingerprint: exactJobState.fingerprint,
        documentInstanceId: exactJobState.documentInstanceId,
        status: exactJobState.status,
      }
    : null

  const startupNativeOutput =
    await dependencies.nativeOutputCoordinator.reconcileStartupOpenManifests({
      offscreenJob: exactJobState,
      activeLease: observedBoundLease,
    })
  const nativeOutputTaskIds =
    await dependencies.nativeOutputCoordinator.getLiveTaskIds()
  const recoveryFacts = {
    normalizationTime: Date.now(),
    interruptedAt: Date.now(),
    observedLease,
    offscreenJob: startupNativeOutput.observedJobSealed ? null : offscreenJob,
    nativeOutputTaskIds,
  } satisfies Parameters<QueueRepository["recoverQueueAfterStartup"]>[0]

  const recovery =
    await dependencies.queueRepository.recoverQueueAfterStartup(recoveryFacts)
  if (recovery.outcome === "rejected") {
    throw new Error("Startup dispatch lease changed during recovery")
  }

  await dependencies.nativeOutputCoordinator.reconcile()
  const normalizedQueue = await dependencies.queueRepository.getQueue()
  const interruptedTaskIds = new Set(recovery.interruptedTaskIds)
  if (interruptedTaskIds.size > 0) {
    await writeSessionProjection({
      [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
    })
    logger.warn("Startup recovery normalized an unreconciled job", {
      persistedTaskIds: recovery.interruptedTaskIds,
      lease: activeLease,
      offscreenJob: exactJobState,
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
      settingsRepository: dependencies.settingsRepository,
    })
  }

  await writeSessionProjection({
    [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
  })

  const nativeTaskIds = new Set(
    await dependencies.nativeOutputCoordinator.getLiveTaskIds()
  )
  const currentLease =
    await dependencies.queueRepository.getActiveDispatchLease()
  const hasOffscreenExecutingTask = normalizedQueue.some(
    (task) => isExecutingDownloadTask(task) && !nativeTaskIds.has(task.id)
  )
  const hasNativeOutputDependencies =
    await dependencies.nativeOutputCoordinator.hasReconcilableLiveDependencies()
  const hasDurableActiveWork =
    hasOffscreenExecutingTask ||
    currentLease !== null ||
    offscreenActiveTaskIds.length > 0 ||
    hasNativeOutputDependencies
  await dependencies.setLivenessAlarmArmed(hasDurableActiveWork)

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
