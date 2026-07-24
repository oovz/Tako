/**
 * Background-side offscreen lifecycle helpers.
 *
 * Responsible for creating, querying, and tearing down the single MV3
 * offscreen document used by the archive pipeline.
 */

import logger from "@/src/runtime/logger"
import { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type {
  OffscreenStatusResponse,
  OffscreenStatusMessage,
  OffscreenJobState,
  OffscreenQueryJobMessage,
  OffscreenQueryJobResponse,
  OffscreenCancelJobMessage,
  OffscreenCancelJobResponse,
} from "@/src/types/offscreen-messages"
import type { PendingDownloadsStore } from "@/entrypoints/background/pending-downloads"
import { notifyTerminalDownloadTask } from "@/entrypoints/background/download-queue-finalization"
import { activeDispatchLeaseStore } from "@/src/runtime/active-dispatch-lease"
import { isDownloadTaskRunnerActive } from "@/entrypoints/background/download-task-runner-registry"
import { clearActiveTaskProgress } from "@/entrypoints/background/active-task-progress-bus"
import { normalizeInterruptedTask } from "@/entrypoints/background/task-lifecycle"

// Global state for offscreen document creation
let creatingOffscreen: Promise<void> | null = null
export const LIVENESS_ALARM_NAME = "offscreen-liveness"

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

async function closeOffscreenDocumentSafe(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument()
  } catch (error) {
    logger.debug("Offscreen close skipped (likely already closed):", error)
  }
}

export async function ensureLivenessAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(LIVENESS_ALARM_NAME)
  if (
    existing?.periodInMinutes === 0.5 &&
    existing.persistAcrossSessions === true
  ) {
    return
  }
  if (existing) await chrome.alarms.clear(LIVENESS_ALARM_NAME)
  await chrome.alarms.create(LIVENESS_ALARM_NAME, {
    periodInMinutes: 0.5,
    persistAcrossSessions: true,
  })
}

export async function queryOffscreenJob(): Promise<OffscreenJobState | null> {
  if (!(await hasOffscreenDocument())) return null
  const requestId = crypto.randomUUID()
  const response = (await chrome.runtime.sendMessage<OffscreenQueryJobMessage>({
    type: "OFFSCREEN_QUERY_JOB",
    payload: { requestId },
  })) as OffscreenQueryJobResponse
  if (!response.success || response.requestId !== requestId) {
    throw new Error("Invalid offscreen job-state response")
  }
  return response.job
}

async function cancelOffscreenJob(input: {
  jobId: string
  attempt: number
  taskId: string
  chapterId: string
}): Promise<boolean> {
  try {
    const response =
      (await chrome.runtime.sendMessage<OffscreenCancelJobMessage>({
        type: "OFFSCREEN_CANCEL_JOB",
        payload: input,
      })) as OffscreenCancelJobResponse
    return response.success && response.canceled
  } catch (error) {
    logger.debug("Cooperative offscreen cancellation failed", error)
    return false
  }
}

export async function recoverFromLivenessTimeout(
  stateManager: CentralizedStateManager,
  pendingDownloadsStore: PendingDownloadsStore,
  onRecover: (activeTaskId?: string) => Promise<void>
): Promise<void> {
  const globalState = await stateManager.getGlobalState()
  const activeTasks = globalState.downloadQueue.filter(
    (task) => task.status === "downloading"
  )
  if (activeTasks.length === 0) {
    return
  }

  const lease = await activeDispatchLeaseStore.get()
  if (lease && Date.now() <= lease.leaseExpiresAt) {
    return
  }

  let queriedJob: OffscreenJobState | null = null
  try {
    queriedJob = await queryOffscreenJob()
  } catch (error) {
    logger.warn("Unable to query an expired offscreen job lease", error)
  }

  if (
    lease &&
    queriedJob &&
    queriedJob.jobId === lease.jobId &&
    queriedJob.attempt === lease.attempt &&
    queriedJob.taskId === lease.taskId &&
    queriedJob.chapterId === lease.chapterId
  ) {
    const renewed = await activeDispatchLeaseStore.renew({
      jobId: queriedJob.jobId,
      attempt: queriedJob.attempt,
      stage: queriedJob.stage,
      sequence: queriedJob.sequence,
      activityAt: Date.now(),
      requireSequenceAdvance: queriedJob.status === "active",
    })
    if (queriedJob.status === "active" && renewed) return

    // A terminal result can outlive the service worker that originally awaited
    // it. Re-enter the queue runner with the same lease; the offscreen job
    // registry returns the cached result instead of executing twice.
    if (queriedJob.status === "terminal" && renewed) {
      if (!isDownloadTaskRunnerActive(queriedJob.taskId)) {
        await onRecover(queriedJob.taskId)
      }
      return
    }
  }

  // Never destroy the document that owns Blob URLs still being consumed by
  // Chrome. Native completion events will settle these records and a later
  // alarm can finish recovery safely.
  if (pendingDownloadsStore.hasBlobDependencies()) {
    logger.warn("Deferring watchdog recovery while native outputs are pending")
    return
  }

  const recoveredAt = Date.now()

  if (lease) {
    await cancelOffscreenJob({
      jobId: lease.jobId,
      attempt: lease.attempt,
      taskId: lease.taskId,
      chapterId: lease.chapterId,
    })
  }

  for (const activeTask of activeTasks) {
    logger.warn(`Liveness timeout for task ${activeTask.id}`)

    const interruptedTask = normalizeInterruptedTask(
      activeTask,
      "Download process unresponsive",
      recoveredAt
    )
    const successfulChapters = interruptedTask.chapters.filter(
      (chapter) => chapter.status === "completed"
    ).length
    const transition = await stateManager.transitionDownloadTask(
      activeTask.id,
      ["downloading"],
      {
        status: interruptedTask.status,
        chapters: interruptedTask.chapters,
        errorMessage: interruptedTask.errorMessage,
        errorCategory: interruptedTask.errorCategory,
        completed: interruptedTask.completed,
      }
    )
    if (!transition.success) {
      continue
    }

    await notifyTerminalDownloadTask({
      task: transition.task,
      finalStatus: transition.task.status,
      completedCount: successfulChapters,
      totalChapters: activeTask.chapters.length,
    })
  }

  await clearActiveTaskProgress()

  await activeDispatchLeaseStore.clear()
  if (await hasOffscreenDocument()) await closeOffscreenDocumentSafe()
  await onRecover()
}

/**
 * Ensure the offscreen document exists before work is dispatched.
 */
export async function ensureOffscreenDocumentReady(): Promise<void> {
  if (await hasOffscreenDocument()) {
    logger.info("Offscreen document already present")
    return
  }

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [
        chrome.offscreen.Reason.BLOBS,
        chrome.offscreen.Reason.WORKERS,
        chrome.offscreen.Reason.DOM_PARSER,
        chrome.offscreen.Reason.DOM_SCRAPING,
      ],
      justification:
        "Create archives in a Web Worker (fflate), handle Blob-based downloads, and parse fetched series page HTML with DOMParser when no content script is available",
    })
  }

  try {
    await creatingOffscreen
    logger.info("Offscreen document created")
  } finally {
    creatingOffscreen = null
  }
}

/**
 * Query whether the offscreen document is ready and how much work it is doing.
 */
export async function queryOffscreenStatus(): Promise<{
  ready: boolean
  activeJobCount: number
  activeTaskIds: string[]
} | null> {
  try {
    if (!(await hasOffscreenDocument())) {
      return null
    }

    const response = (await chrome.runtime.sendMessage<OffscreenStatusMessage>({
      type: "OFFSCREEN_STATUS",
    })) as OffscreenStatusResponse

    if (
      response &&
      response.success &&
      Array.isArray(response.activeTaskIds) &&
      response.activeTaskIds.every(
        (taskId) => typeof taskId === "string" && taskId.length > 0
      )
    ) {
      const activeTaskIds = [...new Set(response.activeTaskIds)].sort(
        (left, right) => left.localeCompare(right)
      )
      const activeJobCount =
        typeof response.activeJobCount === "number"
          ? response.activeJobCount
          : activeTaskIds.length
      if (activeJobCount !== activeTaskIds.length) {
        return null
      }
      return {
        ready: response.isInitialized === true || response.ready === true,
        activeJobCount,
        activeTaskIds,
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
  pendingDownloadsStore: PendingDownloadsStore
): Promise<void> {
  try {
    const status = await queryOffscreenStatus()
    if (!status || !status.ready) {
      return // Not ready or not responding
    }

    const activeLease = await activeDispatchLeaseStore.get()
    if (
      status.activeJobCount === 0 &&
      activeLease === null &&
      !pendingDownloadsStore.hasBlobDependencies()
    ) {
      await closeOffscreenDocumentSafe()
      logger.info("Offscreen document closed due to inactivity")
    }
  } catch (error) {
    logger.error("Error scheduling offscreen close:", error)
  }
}
