/**
 * Background-side offscreen lifecycle helpers.
 *
 * Responsible for creating, querying, and tearing down the single MV3
 * offscreen document used by the archive pipeline.
 */

import logger from "@/src/runtime/logger"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"
import type { NativeOutputJobIdentity } from "@/src/domain/native-output/state"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { OffscreenInitializationState } from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { notifyTerminalDownloadTask } from "@/entrypoints/background/download-queue-finalization"
import { clearActiveTaskProgress } from "@/entrypoints/background/active-task-progress-bus"
import { runTaskSideEffectExclusive } from "@/entrypoints/background/download-task-side-effect-gate"
import type { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import {
  isExecutingDownloadTask,
  isWatchdogEligibleTask,
} from "@/src/domain/queue/task-lifecycle"

// Coalesce ensure callers while serializing every create and close for the
// single targetless offscreen-document API.
let ensuringOffscreen: Promise<void> | null = null
let offscreenLifecycleTail: Promise<void> = Promise.resolve()
export const LIVENESS_ALARM_NAME = "offscreen-liveness"

export type CloseOffscreenDocumentResult = "closed" | "stale"

export type CloseOffscreenDocumentInput = {
  documentInstanceId: string
  browserDocumentId?: string
}

type RuntimeGetContexts = (params: {
  contextTypes: Array<"OFFSCREEN_DOCUMENT">
  documentUrls: string[]
}) => Promise<unknown[]>

export async function getOffscreenContexts(): Promise<unknown[]> {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html")
  const runtimeWithGetContexts = chrome.runtime as unknown as {
    getContexts?: RuntimeGetContexts
  }
  if (typeof runtimeWithGetContexts.getContexts !== "function") {
    throw new Error("chrome.runtime.getContexts is unavailable")
  }
  return await runtimeWithGetContexts.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  })
}

export async function hasOffscreenDocument(): Promise<boolean> {
  return await chrome.offscreen.hasDocument()
}

export async function terminateOffscreenDocumentForUnboundLease(): Promise<void> {
  await runOffscreenLifecycleOperation(async () => {
    if (!(await chrome.offscreen.hasDocument())) return
    await chrome.offscreen.closeDocument()
  })
}

function runOffscreenLifecycleOperation<T>(
  operation: () => Promise<T>
): Promise<T> {
  const result = offscreenLifecycleTail.then(operation)
  offscreenLifecycleTail = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

async function closeOffscreenDocumentIfCurrentInLifecycle(
  input: CloseOffscreenDocumentInput
): Promise<CloseOffscreenDocumentResult> {
  const status = await queryOffscreenStatus()
  if (!status || status.documentInstanceId !== input.documentInstanceId) {
    return "stale"
  }

  const contexts = await getOffscreenContexts()
  if (contexts.length === 0) return "stale"
  if (
    input.browserDocumentId !== undefined &&
    !contexts.some(
      (context) =>
        typeof context === "object" &&
        context !== null &&
        "documentId" in context &&
        (context as { documentId?: unknown }).documentId ===
          input.browserDocumentId
    )
  ) {
    return "stale"
  }

  await chrome.offscreen.closeDocument()
  return "closed"
}

export async function closeOffscreenDocumentIfCurrent(
  input: CloseOffscreenDocumentInput
): Promise<CloseOffscreenDocumentResult> {
  return await runOffscreenLifecycleOperation(async () =>
    closeOffscreenDocumentIfCurrentInLifecycle(input)
  )
}

export async function ensureLivenessAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(LIVENESS_ALARM_NAME)
  if (existing && existing.periodInMinutes === undefined) {
    return
  }
  if (existing) await chrome.alarms.clear(LIVENESS_ALARM_NAME)
  await chrome.alarms.create(LIVENESS_ALARM_NAME, {
    delayInMinutes: 0.5,
    persistAcrossSessions: true,
  })
}

export async function setLivenessAlarmArmed(shouldArm: boolean): Promise<void> {
  if (shouldArm) {
    await ensureLivenessAlarm()
    return
  }
  await chrome.alarms.clear(LIVENESS_ALARM_NAME)
}

export async function refreshLivenessAlarmForDurableWork(
  stateManager: QueueRepository,
  nativeOutputCoordinator: NativeOutputCoordinator
): Promise<void> {
  const [queue, lease, nativeOutputTaskIds, hasNativeOutputDependencies] =
    await Promise.all([
      stateManager.getQueue(),
      stateManager.getActiveDispatchLease(),
      nativeOutputCoordinator.getLiveTaskIds(),
      nativeOutputCoordinator.hasReconcilableLiveDependencies(),
    ])
  const nativeTaskIds = new Set(nativeOutputTaskIds)
  const hasOffscreenExecutingTask = queue.some(
    (task) => isExecutingDownloadTask(task) && !nativeTaskIds.has(task.id)
  )
  await setLivenessAlarmArmed(
    hasOffscreenExecutingTask || lease !== null || hasNativeOutputDependencies
  )
}

export async function queryOffscreenJob(
  identity: NativeOutputJobIdentity
): Promise<OffscreenJobState | null> {
  if (!(await hasOffscreenDocument())) return null
  const requestId = crypto.randomUUID()
  const response = await sendRuntimeMessage({
    target: "offscreen",
    type: "OFFSCREEN_QUERY_JOB",
    payload: { requestId, identity },
  })
  if (!response.success || response.requestId !== requestId) {
    throw new Error("Invalid offscreen job-state response")
  }
  return response.job
}

async function cancelOffscreenJob(
  input: NativeOutputJobIdentity
): Promise<boolean> {
  try {
    const response = await sendRuntimeMessage({
      target: "offscreen",
      type: "OFFSCREEN_CANCEL_JOB",
      payload: input,
    })
    const exactIdentity =
      response.success &&
      response.jobId === input.jobId &&
      response.attempt === input.attempt &&
      response.taskId === input.taskId &&
      response.chapterId === input.chapterId &&
      response.fingerprint === input.fingerprint &&
      response.documentInstanceId === input.documentInstanceId
    return (
      exactIdentity &&
      ((response.canceled && response.status === "canceled") ||
        (!response.canceled &&
          (response.status === "terminal" || response.status === "absent")))
    )
  } catch (error) {
    logger.debug("Cooperative offscreen cancellation failed", error)
    return false
  }
}

export async function recoverFromLivenessTimeout(
  stateManager: QueueRepository,
  nativeOutputCoordinator: NativeOutputCoordinator,
  terminalCoordinator: OffscreenJobTerminalCoordinator,
  queueScheduler: QueueScheduler,
  settingsRepository: Pick<SettingsRepository, "getSettings">
): Promise<void> {
  const nativeOutputTaskIds = new Set(
    await nativeOutputCoordinator.getLiveTaskIds()
  )
  const queue = await stateManager.getQueue()
  const activeTasks = queue.filter(
    (task) => isWatchdogEligibleTask(task) && !nativeOutputTaskIds.has(task.id)
  )
  const lease = await stateManager.getActiveDispatchLease()
  if (activeTasks.length === 0 && !lease) {
    await queueScheduler.activate()
    return
  }
  if (lease && Date.now() <= lease.leaseExpiresAt) {
    return
  }

  if (lease && !lease.documentInstanceId) {
    let interruptedTask: DownloadTaskState | undefined
    await runTaskSideEffectExclusive(lease.taskId, async () => {
      const currentLease = await stateManager.getActiveDispatchLease()
      if (
        !currentLease ||
        currentLease.documentInstanceId !== undefined ||
        currentLease.jobId !== lease.jobId ||
        currentLease.attempt !== lease.attempt ||
        currentLease.taskId !== lease.taskId ||
        currentLease.chapterId !== lease.chapterId ||
        currentLease.fingerprint !== lease.fingerprint ||
        Date.now() <= currentLease.leaseExpiresAt
      ) {
        return
      }
      await terminateOffscreenDocumentForUnboundLease()
      const task = await stateManager.getTask(currentLease.taskId)
      if (task?.status === "queued" || task?.status === "downloading") {
        const interruption = await stateManager.interruptDownloadTask({
          taskId: currentLease.taskId,
          errorMessage: "Download interrupted before offscreen acceptance",
          now: Date.now(),
          clearLease: currentLease,
        })
        if (interruption.outcome === "applied") {
          interruptedTask = interruption.task
        }
        return
      }
      await stateManager.clearDispatchLease(currentLease)
    })
    if (interruptedTask) {
      await notifyTerminalDownloadTask({
        task: interruptedTask,
        finalStatus: interruptedTask.status,
        completedCount: interruptedTask.chapters.filter(
          (chapter) => chapter.status === "completed"
        ).length,
        totalChapters: interruptedTask.chapters.length,
        settingsRepository,
      })
    }
    await clearActiveTaskProgress()
    await queueScheduler.activate()
    return
  }

  let queriedJob: OffscreenJobState | null = null
  let jobQuerySucceeded = false
  try {
    if (!lease?.documentInstanceId) return
    queriedJob = await queryOffscreenJob({
      jobId: lease.jobId,
      attempt: lease.attempt,
      taskId: lease.taskId,
      chapterId: lease.chapterId,
      fingerprint: lease.fingerprint,
      documentInstanceId: lease.documentInstanceId,
    })
    jobQuerySucceeded = true
  } catch (error) {
    logger.warn("Unable to query an expired offscreen job lease", error)
  }

  if (lease && !jobQuerySucceeded) {
    await ensureLivenessAlarm()
    return
  }

  const exactQueriedJob =
    lease &&
    queriedJob &&
    queriedJob.jobId === lease.jobId &&
    queriedJob.attempt === lease.attempt &&
    queriedJob.taskId === lease.taskId &&
    queriedJob.chapterId === lease.chapterId
      ? queriedJob
      : null
  if (lease && queriedJob !== null && exactQueriedJob === null) {
    await ensureLivenessAlarm()
    return
  }
  let nativeOutputPhase = lease
    ? await nativeOutputCoordinator.getJobPhase(lease.jobId)
    : null

  const leaseOwnerAcceptsEvents =
    lease !== null &&
    queue.some(
      (task) =>
        task.id === lease.taskId &&
        task.status === "downloading" &&
        task.chapters.some(
          (chapter) =>
            chapter.id === lease.chapterId && chapter.status === "downloading"
        )
    )
  if (
    lease &&
    leaseOwnerAcceptsEvents &&
    exactQueriedJob?.status === "active"
  ) {
    const renewal = await stateManager.renewDispatchLease({
      jobId: exactQueriedJob.jobId,
      taskId: exactQueriedJob.taskId,
      chapterId: exactQueriedJob.chapterId,
      attempt: exactQueriedJob.attempt,
      stage: exactQueriedJob.stage,
      sequence: exactQueriedJob.lastSequence,
      fingerprint: exactQueriedJob.fingerprint,
      documentInstanceId: exactQueriedJob.documentInstanceId,
      eventSignature: JSON.stringify(exactQueriedJob),
      activityAt: Date.now(),
      requireSequenceAdvance: true,
    })
    if (renewal.outcome !== "rejected") return
    if (nativeOutputPhase !== null) return
  }

  if (
    lease &&
    nativeOutputPhase === "open" &&
    jobQuerySucceeded &&
    (queriedJob === null ||
      (exactQueriedJob !== null && exactQueriedJob.status !== "active"))
  ) {
    await nativeOutputCoordinator.reconcileStartupOpenManifests({
      offscreenJob: queriedJob,
      activeLease: lease.documentInstanceId
        ? {
            jobId: lease.jobId,
            attempt: lease.attempt,
            taskId: lease.taskId,
            chapterId: lease.chapterId,
            fingerprint: lease.fingerprint,
            documentInstanceId: lease.documentInstanceId,
          }
        : null,
    })
    nativeOutputPhase = await nativeOutputCoordinator.getJobPhase(lease.jobId)
  }

  if (lease && nativeOutputPhase === "sealed") {
    const clearing = await stateManager.clearDispatchLease(lease)
    if (clearing.outcome === "applied") {
      await nativeOutputCoordinator.reconcile()
      await queueScheduler.activate()
    }
    return
  }

  if (nativeOutputPhase === "open") return

  if (lease && exactQueriedJob?.status === "terminal") {
    const outcome = exactQueriedJob.outcome
    if (!outcome) throw new Error("Terminal offscreen job has no outcome")
    const settlement = await runTaskSideEffectExclusive(
      exactQueriedJob.taskId,
      async () =>
        await terminalCoordinator.settle({
          jobId: exactQueriedJob.jobId,
          attempt: exactQueriedJob.attempt,
          taskId: exactQueriedJob.taskId,
          chapterId: exactQueriedJob.chapterId,
          fingerprint: exactQueriedJob.fingerprint,
          documentInstanceId: exactQueriedJob.documentInstanceId,
          stage: exactQueriedJob.stage,
          sequence: exactQueriedJob.lastSequence,
          terminalAt: Date.now(),
          outcome,
        })
    )
    if (settlement === "native-output-pending") {
      await terminalCoordinator.afterSettlement(
        exactQueriedJob.taskId,
        settlement
      )
    } else if (settlement === "terminal-owner-released") {
      await queueScheduler.activate()
    } else if (
      settlement === "chapter-settled" &&
      !queueScheduler.isTaskActive(exactQueriedJob.taskId)
    ) {
      await queueScheduler.resumeTask(exactQueriedJob.taskId)
    }
    return
  }

  const recoveredAt = Date.now()

  let clearedCapturedLease = lease === null
  const leaseOwnerIsActive =
    lease !== null && activeTasks.some((task) => task.id === lease.taskId)
  for (const activeTask of activeTasks) {
    await runTaskSideEffectExclusive(activeTask.id, async () => {
      logger.warn(`Liveness timeout for task ${activeTask.id}`)

      const successfulChapters = activeTask.chapters.filter(
        (chapter) => chapter.status === "completed"
      ).length
      const ownsLease = lease?.taskId === activeTask.id
      const producerStopped = ownsLease
        ? queriedJob === null ||
          (await cancelOffscreenJob({
            jobId: lease.jobId,
            attempt: lease.attempt,
            taskId: lease.taskId,
            chapterId: lease.chapterId,
            fingerprint: lease.fingerprint,
            documentInstanceId: lease.documentInstanceId!,
          }))
        : true
      const interruption = await stateManager.interruptDownloadTask({
        taskId: activeTask.id,
        errorMessage: "Download process unresponsive",
        now: recoveredAt,
        clearLease: ownsLease && producerStopped ? lease : undefined,
      })
      if (interruption.outcome !== "applied") {
        return
      }

      if (ownsLease && producerStopped) {
        clearedCapturedLease = interruption.clearedLease !== null
      }
      if (!ownsLease || producerStopped) {
        await nativeOutputCoordinator.cancelTask(activeTask.id)
      }

      try {
        await notifyTerminalDownloadTask({
          task: interruption.task,
          finalStatus: interruption.task.status,
          completedCount: successfulChapters,
          totalChapters: activeTask.chapters.length,
          settingsRepository,
        })
      } catch (error) {
        logger.warn("Unable to publish watchdog terminal notification", {
          taskId: activeTask.id,
          error,
        })
      }
    })
  }

  if (lease && !leaseOwnerIsActive) {
    await runTaskSideEffectExclusive(lease.taskId, async () => {
      const producerStopped =
        queriedJob === null ||
        (await cancelOffscreenJob({
          jobId: lease.jobId,
          attempt: lease.attempt,
          taskId: lease.taskId,
          chapterId: lease.chapterId,
          fingerprint: lease.fingerprint,
          documentInstanceId: lease.documentInstanceId!,
        }))
      if (!producerStopped) {
        await ensureLivenessAlarm()
        return
      }
      const clearing = await stateManager.clearDispatchLease(lease)
      clearedCapturedLease = clearing.outcome === "applied"
      if (clearedCapturedLease) {
        await nativeOutputCoordinator.cancelTask(lease.taskId)
      }
    })
  }

  try {
    await clearActiveTaskProgress()
  } catch (error) {
    logger.warn("Unable to clear watchdog progress projection", error)
  }
  const currentLease = await stateManager.getActiveDispatchLease()
  if (
    clearedCapturedLease &&
    !currentLease &&
    !(await nativeOutputCoordinator.hasLiveDependencies()) &&
    lease?.documentInstanceId
  ) {
    await closeOffscreenDocumentIfCurrent({
      documentInstanceId: lease.documentInstanceId,
    })
  }
  await queueScheduler.activate()
}

async function ensureOffscreenDocumentAdmission(): Promise<void> {
  if (await hasOffscreenDocument()) {
    const status = await queryOffscreenStatus()
    if (!status) {
      throw new Error("Existing offscreen document status is unavailable")
    }
    if (status.initializationState !== "failed") {
      logger.info("Offscreen document already present")
      return
    }
    const closeResult = await closeOffscreenDocumentIfCurrentInLifecycle({
      documentInstanceId: status.documentInstanceId,
    })
    if (closeResult !== "closed") {
      throw new Error(
        "Offscreen document changed during failed-document replacement"
      )
    }
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [
      chrome.offscreen.Reason.BLOBS,
      chrome.offscreen.Reason.WORKERS,
      chrome.offscreen.Reason.DOM_PARSER,
    ],
    justification:
      "Create archives in a Web Worker (fflate), handle Blob-based downloads, and parse fetched series page HTML with DOMParser when no content script is available",
  })
  logger.info("Offscreen document created")
}

/**
 * Ensure the offscreen document exists before work is dispatched.
 */
export async function ensureOffscreenDocumentReady(): Promise<void> {
  await ensureLivenessAlarm()
  const admission =
    ensuringOffscreen ??
    (ensuringOffscreen = runOffscreenLifecycleOperation(
      ensureOffscreenDocumentAdmission
    ))

  try {
    await admission
  } finally {
    if (ensuringOffscreen === admission) ensuringOffscreen = null
  }
}

/**
 * Admit immediate offscreen work while holding the same lifecycle chain that
 * owns document creation and closure.
 */
export async function runOffscreenDocumentAdmissionExclusive<T>(
  operation: () => Promise<T>
): Promise<T> {
  await ensureLivenessAlarm()
  return await runOffscreenLifecycleOperation(async () => {
    await ensureOffscreenDocumentAdmission()
    return await operation()
  })
}

/**
 * Query whether the offscreen document is ready and how much work it is doing.
 */
export async function queryOffscreenStatus(): Promise<{
  initializationState: OffscreenInitializationState
  activeJobCount: number
  activeSeriesResolutionCount: number
  activeTaskIds: string[]
  documentInstanceId: string
} | null> {
  try {
    if (!(await hasOffscreenDocument())) {
      return null
    }

    const response = await sendRuntimeMessage({
      target: "offscreen",
      type: "OFFSCREEN_STATUS",
    })

    if (response.success) {
      const activeTaskIds = [...new Set(response.activeTaskIds)].sort(
        (left, right) => left.localeCompare(right)
      )
      const activeJobCount = response.activeJobCount
      const activeSeriesResolutionCount = response.activeSeriesResolutionCount
      if (activeJobCount !== activeTaskIds.length) {
        return null
      }
      return {
        initializationState: response.initializationState,
        activeJobCount,
        activeSeriesResolutionCount,
        activeTaskIds,
        documentInstanceId: response.documentInstanceId,
      }
    }

    return null
  } catch (error) {
    logger.error("Error querying offscreen status:", error)
    return null
  }
}

/**
 * Close the offscreen document when it is idle and no native downloads remain.
 */
export async function scheduleOffscreenCloseIfIdle(
  queueRepository: QueueRepository,
  nativeOutputCoordinator: NativeOutputCoordinator
): Promise<void> {
  try {
    await runOffscreenLifecycleOperation(async () => {
      const candidateStatus = await queryOffscreenStatus()
      if (
        !candidateStatus ||
        candidateStatus.initializationState !== "ready" ||
        candidateStatus.activeJobCount !== 0 ||
        candidateStatus.activeSeriesResolutionCount !== 0
      ) {
        return
      }

      const candidateContexts = await getOffscreenContexts()
      if (candidateContexts.length === 0) return
      const browserDocumentId = candidateContexts.find(
        (context) =>
          typeof context === "object" &&
          context !== null &&
          "documentId" in context &&
          typeof (context as { documentId?: unknown }).documentId === "string"
      ) as { documentId: string } | undefined

      const currentContexts = browserDocumentId
        ? await getOffscreenContexts()
        : candidateContexts
      const browserDocumentIsCurrent =
        browserDocumentId === undefined ||
        currentContexts.some(
          (context) =>
            typeof context === "object" &&
            context !== null &&
            "documentId" in context &&
            (context as { documentId?: unknown }).documentId ===
              browserDocumentId.documentId
        )
      const [activeLease, hasBlobDependencies] = await Promise.all([
        queueRepository.getActiveDispatchLease(),
        nativeOutputCoordinator.hasLiveDependencies(),
      ])
      const currentStatus = await queryOffscreenStatus()
      if (
        !browserDocumentIsCurrent ||
        activeLease !== null ||
        hasBlobDependencies ||
        !currentStatus ||
        currentStatus.initializationState !== "ready" ||
        currentStatus.documentInstanceId !==
          candidateStatus.documentInstanceId ||
        currentStatus.activeJobCount !== 0 ||
        currentStatus.activeSeriesResolutionCount !== 0
      ) {
        return
      }

      await chrome.offscreen.closeDocument()
      logger.info("Offscreen document closed due to inactivity")
    })
  } catch (error) {
    logger.error("Error scheduling offscreen close:", error)
  }
}
