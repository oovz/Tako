/**
 * Download Task Action Handlers
 *
 * Handlers for download task lifecycle (remove, cancel).
 */

import { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type {
  RemoveDownloadTaskPayload,
  CancelDownloadTaskPayload,
  ResumeDestinationTaskPayload,
  UndoPendingActionPayload,
} from "@/src/types/state-action-download-payloads"
import logger from "@/src/runtime/logger"
import { clearDestinationIssuesForTask } from "../destination"
import {
  restorePendingUndoAndCleanup,
  schedulePendingUndoAction,
} from "../pending-undo-coordinator"

async function logQueueEvent(
  stateManager: CentralizedStateManager,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  data?: unknown
): Promise<void> {
  if (level === "error" || level === "warn") {
    logger[level](message, data)
    return
  }

  try {
    const globalState = await stateManager.getGlobalState()
    const isDebugLevel = globalState.settings?.advanced?.logLevel === "debug"
    if (!isDebugLevel) return
  } catch {
    return
  }

  logger[level](message, data)
}

/**
 * Remove a completed or failed download task from the queue
 *
 * **User Stories**: 3.1 (Single Chapter Download), 3.2 (Batch Chapter Download)
 *
 * @param stateManager - State manager instance
 * @param payload - Contains taskId to remove
 * @returns Success confirmation
 */
export async function handleRemoveDownloadTask(
  stateManager: CentralizedStateManager,
  payload: RemoveDownloadTaskPayload
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { taskId } = payload
  const result = await stateManager.removeTerminalDownloadTask(taskId)
  if (!result.success) {
    return {
      success: false,
      error:
        result.reason === "not-found"
          ? "Download task not found."
          : "Only completed, failed, partial-success, or canceled tasks can be removed.",
    }
  }
  await logQueueEvent(stateManager, "info", "[Queue] REMOVED", {
    event: "REMOVED",
    taskId,
  })
  await schedulePendingUndoAction(stateManager, result.undo)
  return { success: true, data: { undo: result.undo } }
}

/**
 * Cancel a download task
 *
 * Cancel Downloads
 *
 * Updates task status to 'canceled' and sends explicit cancellation message to offscreen document.
 *
 * **Critical Fix (October 2025)**: Offscreen documents can ONLY use chrome.runtime API,
 * NOT chrome.storage. They cannot detect status changes via storage listeners.
 * Must send explicit OFFSCREEN_CONTROL message to trigger job.controller.abort().
 *
 * @param stateManager - State manager instance
 * @param payload - Contains taskId to cancel
 * @returns Success confirmation
 */
export async function handleCancelDownloadTask(
  stateManager: CentralizedStateManager,
  payload: CancelDownloadTaskPayload
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { taskId } = payload

  logger.debug(`🔴 [HANDLER] Cancelling download task: ${taskId}`)

  const transition = await stateManager.cancelDownloadTaskAtomically(taskId)

  if (!transition.success) {
    const error =
      transition.reason === "not-found"
        ? "Download task not found."
        : "Only queued or downloading tasks can be canceled."
    await logQueueEvent(stateManager, "warn", "[Queue] CANCEL_REJECTED", {
      event: "CANCEL_REJECTED",
      taskId,
      reason: transition.reason,
      currentStatus:
        transition.reason === "invalid-status"
          ? transition.currentStatus
          : undefined,
    })
    return { success: false, error }
  }

  if (transition.undo) {
    await schedulePendingUndoAction(stateManager, transition.undo)
    await logQueueEvent(stateManager, "info", "[Queue] CANCEL_PENDING_UNDO", {
      event: "CANCEL_PENDING_UNDO",
      taskId,
      expiresAt: transition.undo.expiresAt,
    })
    return { success: true, data: { undo: transition.undo } }
  }

  await clearDestinationIssuesForTask(taskId)

  await logQueueEvent(stateManager, "info", "[Queue] CANCELED", {
    event: "CANCELED",
    taskId,
  })

  logger.debug(
    `💾 [HANDLER] Task ${taskId} status updated to 'canceled' in state`
  )

  // Already accepted Chrome downloads are intentionally left running. Only
  // the exact uncommitted offscreen job receives cooperative cancellation.
  try {
    const lease = transition.canceledLease
    if (lease) {
      await chrome.runtime.sendMessage({
        type: "OFFSCREEN_CANCEL_JOB",
        payload: {
          jobId: lease.jobId,
          attempt: lease.attempt,
          taskId: lease.taskId,
          chapterId: lease.chapterId,
        },
      })
    }
  } catch (error) {
    // Offscreen may not be running or already terminated - this is non-fatal
    logger.debug(
      "⚠️ [HANDLER] Could not send cancellation to offscreen (may not be running):",
      error
    )
  }

  logger.debug(`✅ [HANDLER] handleCancelDownloadTask completed for ${taskId}`)
  return { success: true }
}

async function resumeDestinationTask(
  stateManager: CentralizedStateManager,
  payload: ResumeDestinationTaskPayload,
  destinationOverride: "downloads-api" | undefined
): Promise<{ success: boolean; error?: string }> {
  const { taskId } = payload
  const result = await stateManager.updateDownloadQueueAtomically((queue) => {
    const taskIndex = queue.findIndex((task) => task.id === taskId)
    if (taskIndex === -1) {
      return { queue: [...queue], result: "not-found" as const }
    }
    const task = queue[taskIndex]
    if (
      task.activeBlock !== "destination_action_required" ||
      (task.status !== "queued" && task.status !== "downloading")
    ) {
      return { queue: [...queue], result: "not-blocked" as const }
    }

    const nextQueue = [...queue]
    nextQueue[taskIndex] = {
      ...task,
      status: "queued",
      activeBlock: undefined,
      destinationOverride,
      errorMessage: undefined,
      errorCategory: undefined,
      chapters: task.chapters.map((chapter) =>
        chapter.status === "queued" || chapter.status === "downloading"
          ? {
              ...chapter,
              status: "queued",
              errorMessage: undefined,
              lastUpdated: Date.now(),
            }
          : chapter
      ),
    }
    return { queue: nextQueue, result: "resumed" as const }
  })

  if (result === "not-found") {
    return { success: false, error: "Download task not found." }
  }
  if (result === "not-blocked") {
    return {
      success: false,
      error: "This task is not waiting for download-folder action.",
    }
  }

  await clearDestinationIssuesForTask(taskId)
  return { success: true }
}

export async function handleRetryDestinationTask(
  stateManager: CentralizedStateManager,
  payload: ResumeDestinationTaskPayload
): Promise<{ success: boolean; error?: string }> {
  return await resumeDestinationTask(stateManager, payload, undefined)
}

export async function handleContinueTaskInDownloads(
  stateManager: CentralizedStateManager,
  payload: ResumeDestinationTaskPayload
): Promise<{ success: boolean; error?: string }> {
  return await resumeDestinationTask(stateManager, payload, "downloads-api")
}

export async function handleUndoPendingAction(
  stateManager: CentralizedStateManager,
  payload: UndoPendingActionPayload
): Promise<{ success: boolean; error?: string }> {
  const result = await restorePendingUndoAndCleanup(stateManager, payload.token)
  if (result.success) return { success: true }

  return {
    success: false,
    error:
      result.reason === "expired"
        ? "The Undo period has ended."
        : "This action can no longer be undone.",
  }
}
