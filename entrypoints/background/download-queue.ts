/**
 * Download Queue Manager - Background Service Worker Only
 *
 * Re-exports download task orchestration primitives from their owning modules
 * so callers can import from a single stable entry point.
 * CRITICAL: This should ONLY be used in the Service Worker.
 */

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
