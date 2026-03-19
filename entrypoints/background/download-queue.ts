/**
 * Download Queue Manager - Background Service Worker Only
 * 
 * Handles download task orchestration and processing.
 * CRITICAL: This should ONLY be used in the Service Worker.
 */

import logger from '@/src/runtime/logger';
import { CentralizedStateManager } from '@/src/runtime/centralized-state';
export {
  processDownloadQueue,
  startDownloadTask,
} from './download-queue-runner'
export {
  enqueueStartDownloadTask,
  type StartDownloadPayload,
} from './download-queue-enqueue'
export {
  clearAllHistory,
  moveTaskToTop,
  restartTask,
  retryFailedChapters,
} from './download-queue-history-actions'

/**
 * Handle download task completion
 */
export async function completeDownloadTask(
  stateManager: CentralizedStateManager,
  taskId: string
): Promise<void> {
  try {
    await stateManager.updateDownloadTask(taskId, {
      status: 'completed',
      completed: Date.now()
    });

    logger.info('[Queue]', {
      event: 'COMPLETED',
      taskId,
    });

  } catch (error) {
    logger.error('[Queue]', {
      event: 'FAILED',
      taskId,
      reason: 'INTERNAL_ERROR',
      error,
    });
  }
}

/**
 * Handle download task failure
 */
export async function failDownloadTask(
  stateManager: CentralizedStateManager,
  taskId: string,
  errorMessage: string
): Promise<void> {
  try {
    await stateManager.updateDownloadTask(taskId, {
      status: 'failed',
      errorMessage,
      completed: Date.now()
    });

    logger.error('[Queue]', {
      event: 'FAILED',
      taskId,
      reason: 'TASK_FAILED',
      errorMessage,
    });

  } catch (error) {
    logger.error('[Queue]', {
      event: 'FAILED',
      taskId,
      reason: 'INTERNAL_ERROR',
      error,
    });
  }
}

