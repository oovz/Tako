import logger from '@/src/runtime/logger'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { DownloadTaskState } from '@/src/types/queue-state'

/**
 * Create a new download task containing only the failed chapters of an existing task.
 * Marks the original task as retried.
 */
export async function retryFailedChapters(
  stateManager: CentralizedStateManager,
  taskId: string,
): Promise<{ success: boolean; newTaskId?: string; reason?: string }> {
  const globalState = await stateManager.getGlobalState()
  const original = globalState.downloadQueue.find((task) => task.id === taskId)

  if (!original) {
    logger.warn('[Queue]', {
      event: 'RETRY_FAILED_CHAPTERS',
      outcome: 'TASK_NOT_FOUND',
      taskId,
    })
    return { success: false, reason: 'Task not found' }
  }

  if (original.status !== 'partial_success') {
    logger.info('[Queue]', {
      event: 'RETRY_FAILED_CHAPTERS',
      outcome: 'INELIGIBLE_STATUS',
      taskId,
      status: original.status,
    })
    return { success: false, reason: 'Retry failed chapters is only available for partial-success tasks' }
  }

  const failedChapters = original.chapters.filter(
    (chapter) => chapter.status === 'failed' || chapter.status === 'partial_success',
  )
  if (failedChapters.length === 0) {
    logger.info('[Queue]', {
      event: 'RETRY_FAILED_CHAPTERS',
      outcome: 'NO_FAILED_CHAPTERS',
      taskId,
    })
    return { success: false, reason: 'No failed chapters to retry' }
  }

  const now = Date.now()
  const retryTaskId = crypto.randomUUID()

  const retryChapters: DownloadTaskState['chapters'] = failedChapters.map((chapter) => ({
    ...chapter,
    status: 'queued',
    errorMessage: undefined,
    totalImages: undefined,
    imagesFailed: undefined,
    lastUpdated: now,
  }))

  const retryTask: DownloadTaskState = {
    id: retryTaskId,
    siteIntegrationId: original.siteIntegrationId,
    mangaId: original.mangaId,
    seriesTitle: original.seriesTitle,
    seriesCoverUrl: original.seriesCoverUrl,
    chapters: retryChapters,
    status: 'queued',
    errorMessage: undefined,
    errorCategory: undefined,
    created: now,
    started: undefined,
    completed: undefined,
    isRetried: false,
    isRetryTask: true,
    lastSuccessfulDownloadId: undefined,
    settingsSnapshot: original.settingsSnapshot,
  }

  await stateManager.addDownloadTask(retryTask)
  await stateManager.updateDownloadTask(original.id, { isRetried: true })

  logger.info('[Queue]', {
    event: 'RETRY_FAILED_CHAPTERS',
    outcome: 'RETRY_CREATED',
    taskId,
    newTaskId: retryTaskId,
    failedChapters: failedChapters.length,
  })

  return { success: true, newTaskId: retryTaskId }
}

/**
 * Restart a terminal task by cloning all chapters into a new queued task.
 * Marks the original task as retried.
 */
export async function restartTask(
  stateManager: CentralizedStateManager,
  taskId: string,
): Promise<{ success: boolean; newTaskId?: string; reason?: string }> {
  const globalState = await stateManager.getGlobalState()
  const original = globalState.downloadQueue.find((task) => task.id === taskId)

  if (!original) {
    logger.warn('[Queue]', {
      event: 'RESTART_TASK',
      outcome: 'TASK_NOT_FOUND',
      taskId,
    })
    return { success: false, reason: 'Task not found' }
  }

  const isEligible =
    original.status === 'failed' || original.status === 'partial_success' || original.status === 'canceled'
  if (!isEligible) {
    logger.info('[Queue]', {
      event: 'RESTART_TASK',
      outcome: 'INELIGIBLE_STATUS',
      taskId,
      status: original.status,
    })
    return {
      success: false,
      reason: 'Restart is only available for failed, partial-success, or canceled tasks',
    }
  }

  const now = Date.now()
  const restartTaskId = crypto.randomUUID()

  const resetChapters: DownloadTaskState['chapters'] = original.chapters.map((chapter) => ({
    ...chapter,
    status: 'queued',
    errorMessage: undefined,
    totalImages: undefined,
    imagesFailed: undefined,
    lastUpdated: now,
  }))

  const restartedTask: DownloadTaskState = {
    ...original,
    id: restartTaskId,
    chapters: resetChapters,
    status: 'queued',
    errorMessage: undefined,
    errorCategory: undefined,
    created: now,
    started: undefined,
    completed: undefined,
    isRetried: false,
    isRetryTask: true,
    lastSuccessfulDownloadId: undefined,
    settingsSnapshot: original.settingsSnapshot,
  }

  await stateManager.addDownloadTask(restartedTask)
  await stateManager.updateDownloadTask(original.id, { isRetried: true })

  logger.info('[Queue]', {
    event: 'RESTART_TASK',
    outcome: 'RESTART_CREATED',
    taskId,
    newTaskId: restartTaskId,
    chapterCount: original.chapters.length,
  })

  return { success: true, newTaskId: restartTaskId }
}

/**
 * Move a queued task to the top of the queued segment while preserving active task order.
 */
export async function moveTaskToTop(
  stateManager: CentralizedStateManager,
  taskId: string,
): Promise<{ success: boolean; reason?: string }> {
  const globalState = await stateManager.getGlobalState()
  const queue = [...globalState.downloadQueue]
  const taskIndex = queue.findIndex((task) => task.id === taskId)

  if (taskIndex === -1) {
    return { success: false, reason: 'Task not found' }
  }

  if (queue[taskIndex]?.status !== 'queued') {
    return { success: false, reason: 'Only queued tasks can be moved to top' }
  }

  const activeTaskCount = queue.filter((task) => task.status === 'downloading').length
  const [task] = queue.splice(taskIndex, 1)
  if (!task) {
    return { success: false, reason: 'Task not found' }
  }

  queue.splice(activeTaskCount, 0, task)

  await stateManager.updateGlobalState({ downloadQueue: queue })

  return { success: true }
}

/**
 * Remove all terminal tasks from history in a single atomic update.
 */
export async function clearAllHistory(
  stateManager: CentralizedStateManager,
): Promise<{ success: boolean; removedCount: number }> {
  const globalState = await stateManager.getGlobalState()
  const before = globalState.downloadQueue.length
  const nonTerminal = globalState.downloadQueue.filter(
    (task) => task.status === 'queued' || task.status === 'downloading',
  )

  await stateManager.updateGlobalState({ downloadQueue: nonTerminal })

  return {
    success: true,
    removedCount: before - nonTerminal.length,
  }
}

