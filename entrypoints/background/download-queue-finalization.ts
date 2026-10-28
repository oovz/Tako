import { reconcileCompletedChapterHistory } from "@/src/storage/completed-chapter-history"
import logger from "@/src/runtime/logger"
import type { DispatchLeaseAuthority } from "@/src/domain/queue/state"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { areNotificationsEnabled } from "@/entrypoints/background/notification-preferences"
import { getNotificationService } from "@/entrypoints/background/notification-service"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import type { HistoryRepository } from "@/src/storage/history-repository"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { ChapterDispatchOutcome } from "@/src/domain/queue/task-lifecycle"

export interface DownloadQueueFinalizationDependencies {
  settingsRepository: Pick<SettingsRepository, "getSettings">
  historyRepository: Pick<
    HistoryRepository,
    "getDownloadedChapters" | "restoreChapterFromCompletedTask"
  >
}

export async function finalizeDownloadTaskAfterDispatch(input: {
  stateManager: QueueRepository
  taskId: string
  chapterOutcomesByIndex: Array<ChapterDispatchOutcome | undefined>
  dispatchLease?: DispatchLeaseAuthority
  finalizationDependencies: DownloadQueueFinalizationDependencies
}): Promise<
  | { finalized: false }
  | {
      chapterOutcomes: ChapterDispatchOutcome[]
      completedCount: number
      finalStatus: DownloadTaskState["status"]
      finalized: true
    }
> {
  const finalization = await input.stateManager.finalizeDownloadTask({
    taskId: input.taskId,
    chapterOutcomesByIndex: input.chapterOutcomesByIndex,
    completedAt: Date.now(),
    clearLease: input.dispatchLease,
  })

  if (finalization.outcome === "applied") {
    try {
      await reconcileCompletedChapterHistory(
        [finalization.task],
        input.finalizationDependencies.historyRepository
      )
    } catch (error) {
      logger.warn(
        "[Queue] Completion history projection will be retried",
        error
      )
    }
    return {
      chapterOutcomes: finalization.chapterOutcomes,
      completedCount: finalization.completedCount,
      finalStatus: finalization.finalStatus,
      finalized: true,
    }
  }

  return { finalized: false }
}

export async function notifyDownloadTaskCompletion(input: {
  stateManager: QueueRepository
  taskId: string
  finalStatus: DownloadTaskState["status"]
  completedCount: number
  totalChapters: number
  settingsRepository: Pick<SettingsRepository, "getSettings">
}): Promise<void> {
  try {
    const taskAfterCompletion = await input.stateManager.getTask(input.taskId)
    if (!taskAfterCompletion) {
      return
    }

    await notifyTerminalDownloadTask({
      task: taskAfterCompletion,
      finalStatus: input.finalStatus,
      completedCount: input.completedCount,
      totalChapters: input.totalChapters,
      settingsRepository: input.settingsRepository,
    })
  } catch (error) {
    logger.debug("[Queue] Completion side effects failed (non-fatal)", error)
  }
}

export async function notifyTerminalDownloadTask(input: {
  task: DownloadTaskState
  finalStatus: DownloadTaskState["status"]
  completedCount: number
  totalChapters: number
  settingsRepository: Pick<SettingsRepository, "getSettings">
}): Promise<void> {
  try {
    const taskAfterCompletion = input.task

    const settings = await input.settingsRepository.getSettings()
    const notificationsEnabled = areNotificationsEnabled(settings)
    if (!notificationsEnabled) {
      return
    }

    const notificationService = getNotificationService()
    if (input.finalStatus === "completed") {
      await notificationService.showDownloadCompleteNotification({
        task: taskAfterCompletion,
        notificationsEnabled,
        chaptersCompleted: input.completedCount,
        chaptersTotal: input.totalChapters,
      })
    }

    if (
      input.finalStatus === "failed" ||
      input.finalStatus === "partial_success"
    ) {
      await notificationService.notifyTaskFailed({
        task: taskAfterCompletion,
        notificationsEnabled,
        errorMessage: taskAfterCompletion.errorMessage,
      })
    }
  } catch (error) {
    logger.debug("[Queue] Completion side effects failed (non-fatal)", error)
  }
}
