/**
 * Download Task Action Handlers
 * 
 * Handlers for download task lifecycle (create, update, remove).
 */

import {
  CentralizedStateManager,
} from '@/src/runtime/centralized-state';
import type {
  UpdateDownloadTaskPayload,
  RemoveDownloadTaskPayload,
  CancelDownloadTaskPayload
} from '@/src/types/state-action-download-payloads';
import logger from '@/src/runtime/logger';

async function logQueueEvent(
  stateManager: CentralizedStateManager,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  data?: unknown,
): Promise<void> {
  if (level === 'error' || level === 'warn') {
    logger[level](message, data);
    return;
  }

  try {
    const globalState = await stateManager.getGlobalState();
    const isDebugLevel = globalState.settings?.advanced?.logLevel === 'debug';
    if (!isDebugLevel) return;
  } catch {
    return;
  }

  logger[level](message, data);
}

/**
 * Update an existing download task's state
 * 
 * **User Stories**: 3.1 (Single Chapter Download), 3.2 (Batch Chapter Download)
 * 
 * @param stateManager - State manager instance
 * @param payload - Contains taskId and updates object
 * @returns Success confirmation
 */
export async function handleUpdateDownloadTask(
  stateManager: CentralizedStateManager,
  payload: unknown
): Promise<{ success: boolean }> {
  const typedPayload = payload as UpdateDownloadTaskPayload;
  const { taskId, updates } = typedPayload;
  await stateManager.updateDownloadTask(taskId, updates);
  await logQueueEvent(stateManager, 'info', '[Queue] TASK_UPDATED', {
    event: 'TASK_UPDATED',
    taskId,
    updates,
  });
  return { success: true };
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
  payload: unknown
): Promise<{ success: boolean }> {
  const typedPayload = payload as RemoveDownloadTaskPayload;
  const { taskId } = typedPayload;
  await stateManager.removeDownloadTask(taskId);
  await logQueueEvent(stateManager, 'info', '[Queue] REMOVED', {
    event: 'REMOVED',
    taskId,
  });
  return { success: true };
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
  payload: unknown
): Promise<{ success: boolean }> {
  const typedPayload = payload as CancelDownloadTaskPayload;
  const { taskId } = typedPayload;

  await logQueueEvent(stateManager, 'info', '[Queue] CANCELED', {
    event: 'CANCELED',
    taskId,
  });

  logger.debug(`🔴 [HANDLER] Cancelling download task: ${taskId}`);

  await stateManager.updateDownloadTask(taskId, {
    status: 'canceled',
    completed: Date.now()
  });
  
  logger.debug(`💾 [HANDLER] Task ${taskId} status updated to 'canceled' in state`);

  // Send explicit cancellation message to offscreen document (Manifest V3 compliant)
  // Offscreen documents CANNOT use chrome.storage.* APIs, must use runtime messaging
  try {
    await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_CONTROL',
      payload: {
        taskId,
        action: 'cancel',
      },
    });
  } catch (error) {
    // Offscreen may not be running or already terminated - this is non-fatal
    logger.debug('⚠️ [HANDLER] Could not send cancellation to offscreen (may not be running):', error);
  }

  logger.debug(`✅ [HANDLER] handleCancelDownloadTask completed for ${taskId}`);
  return { success: true };
}

