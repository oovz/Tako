import logger from "@/src/runtime/logger"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { DownloadTaskState } from "@/src/types/queue-state"

/**
 * Create a new download task containing only the failed chapters of an existing task.
 * Marks the original task as retried.
 */
export async function retryFailedChapters(
  stateManager: CentralizedStateManager,
  taskId: string
): Promise<{ success: boolean; newTaskId?: string; reason?: string }> {
  const now = Date.now()
  const retryTaskId = crypto.randomUUID()
  let failedChapterCount = 0
  const result = await stateManager.updateDownloadQueueAtomically<{
    success: boolean
    newTaskId?: string
    reason?: string
  }>((queue) => {
    const original = queue.find((task) => task.id === taskId)
    if (!original) {
      return {
        queue: [...queue],
        result: { success: false as const, reason: "Task not found" },
      }
    }
    if (original.status !== "partial_success") {
      return {
        queue: [...queue],
        result: {
          success: false as const,
          reason:
            "Retry failed chapters is only available for partial-success tasks",
        },
      }
    }
    if (original.isRetried) {
      return {
        queue: [...queue],
        result: {
          success: false as const,
          reason: "Task has already been retried",
        },
      }
    }
    const failedChapters = original.chapters.filter(
      (chapter) =>
        chapter.status === "failed" || chapter.status === "partial_success"
    )
    if (failedChapters.length === 0) {
      return {
        queue: [...queue],
        result: {
          success: false as const,
          reason: "No failed chapters to retry",
        },
      }
    }
    failedChapterCount = failedChapters.length
    const retryChapters: DownloadTaskState["chapters"] = failedChapters.map(
      (chapter) => ({
        ...chapter,
        status: "queued",
        errorMessage: undefined,
        totalImages: undefined,
        imagesFailed: undefined,
        outputs: { requested: 0, committed: 0, failed: 0 },
        dispatchAttempt: undefined,
        lastUpdated: now,
      })
    )
    const retryTask: DownloadTaskState = {
      id: retryTaskId,
      siteIntegrationId: original.siteIntegrationId,
      mangaId: original.mangaId,
      seriesTitle: original.seriesTitle,
      seriesCoverUrl: original.seriesCoverUrl,
      chapters: retryChapters,
      status: "queued",
      created: now,
      isRetried: false,
      isRetryTask: true,
      settingsSnapshot: original.settingsSnapshot,
    }
    return {
      queue: queue
        .map((task) =>
          task.id === taskId ? { ...task, isRetried: true } : task
        )
        .concat(retryTask),
      result: { success: true as const, newTaskId: retryTaskId },
    }
  })

  if (!result.success) return result

  logger.info("[Queue]", {
    event: "RETRY_FAILED_CHAPTERS",
    outcome: "RETRY_CREATED",
    taskId,
    newTaskId: retryTaskId,
    failedChapters: failedChapterCount,
  })

  return result
}

/**
 * Restart a terminal task by cloning all chapters into a new queued task.
 * Marks the original task as retried.
 */
export async function restartTask(
  stateManager: CentralizedStateManager,
  taskId: string
): Promise<{ success: boolean; newTaskId?: string; reason?: string }> {
  const now = Date.now()
  const restartTaskId = crypto.randomUUID()
  let chapterCount = 0
  const result = await stateManager.updateDownloadQueueAtomically<{
    success: boolean
    newTaskId?: string
    reason?: string
  }>((queue) => {
    const original = queue.find((task) => task.id === taskId)
    if (!original) {
      return {
        queue: [...queue],
        result: { success: false as const, reason: "Task not found" },
      }
    }
    if (!["failed", "partial_success", "canceled"].includes(original.status)) {
      return {
        queue: [...queue],
        result: {
          success: false as const,
          reason:
            "Restart is only available for failed, partial-success, or canceled tasks",
        },
      }
    }
    if (original.isRetried) {
      return {
        queue: [...queue],
        result: {
          success: false as const,
          reason: "Task has already been retried",
        },
      }
    }
    chapterCount = original.chapters.length
    const restartedTask: DownloadTaskState = {
      ...original,
      id: restartTaskId,
      chapters: original.chapters.map((chapter) => ({
        ...chapter,
        status: "queued",
        errorMessage: undefined,
        totalImages: undefined,
        imagesFailed: undefined,
        outputs: { requested: 0, committed: 0, failed: 0 },
        dispatchAttempt: undefined,
        lastUpdated: now,
      })),
      status: "queued",
      errorMessage: undefined,
      errorCategory: undefined,
      created: now,
      started: undefined,
      completed: undefined,
      isRetried: false,
      isRetryTask: true,
      lastSuccessfulDownloadId: undefined,
      nextChapterDispatchAt: undefined,
    }
    return {
      queue: queue
        .map((task) =>
          task.id === taskId ? { ...task, isRetried: true } : task
        )
        .concat(restartedTask),
      result: { success: true as const, newTaskId: restartTaskId },
    }
  })

  if (!result.success) return result

  logger.info("[Queue]", {
    event: "RESTART_TASK",
    outcome: "RESTART_CREATED",
    taskId,
    newTaskId: restartTaskId,
    chapterCount,
  })

  return result
}

/**
 * Move a queued task to the top of the queued segment while preserving active task order.
 */
export async function moveTaskToTop(
  stateManager: CentralizedStateManager,
  taskId: string
): Promise<{ success: boolean; reason?: string }> {
  return await stateManager.updateDownloadQueueAtomically<{
    success: boolean
    reason?: string
  }>((currentQueue) => {
    const queue = [...currentQueue]
    const taskIndex = queue.findIndex((task) => task.id === taskId)

    if (taskIndex === -1) {
      return {
        queue,
        result: { success: false as const, reason: "Task not found" },
      }
    }

    if (queue[taskIndex]?.status !== "queued") {
      return {
        queue,
        result: {
          success: false as const,
          reason: "Only queued tasks can be moved to top",
        },
      }
    }

    const activeTaskCount = queue.filter(
      (task) => task.status === "downloading"
    ).length
    const [task] = queue.splice(taskIndex, 1)
    if (!task) {
      return {
        queue,
        result: { success: false as const, reason: "Task not found" },
      }
    }

    queue.splice(activeTaskCount, 0, task)
    return { queue, result: { success: true as const } }
  })
}

/**
 * Remove all terminal tasks from history in a single atomic update.
 */
export async function clearAllHistory(
  stateManager: CentralizedStateManager
): Promise<{ success: boolean; removedCount: number }> {
  return await stateManager.updateDownloadQueueAtomically((queue) => {
    const nonTerminal = queue.filter(
      (task) => task.status === "queued" || task.status === "downloading"
    )
    return {
      queue: nonTerminal,
      result: {
        success: true as const,
        removedCount: queue.length - nonTerminal.length,
      },
    }
  })
}
