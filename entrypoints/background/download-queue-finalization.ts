import logger from "@/src/runtime/logger"
import type { DispatchLeaseAuthority } from "@/src/domain/queue/state"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { areNotificationsEnabled } from "@/entrypoints/background/notification-preferences"
import { getNotificationService } from "@/entrypoints/background/notification-service"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import { composeDownloadedChapterKey } from "@/src/domain/history/types"
import type { HistoryRepository } from "@/src/storage/history-repository"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { ChapterDispatchOutcome } from "@/src/domain/queue/task-lifecycle"

function resolvePersistedFormat(
  settingsSnapshot: DownloadTaskState["settingsSnapshot"]
): "cbz" | "zip" | "none" {
  return settingsSnapshot.archiveFormat
}

export interface DownloadQueueFinalizationDependencies {
  settingsRepository: Pick<SettingsRepository, "getSettings">
  historyRepository: Pick<
    HistoryRepository,
    | "markChapterAsDownloaded"
    | "getDownloadedChapters"
    | "restoreChapterFromCompletedTask"
  >
}

export async function persistCompletedChapter(
  task: DownloadTaskState,
  chapterId: string,
  persistedFormat: "cbz" | "zip" | "none",
  deps: DownloadQueueFinalizationDependencies
): Promise<void> {
  const chapter = task.chapters.find(
    (taskChapter) => taskChapter.id === chapterId
  )
  if (!chapter) {
    return
  }

  await deps.historyRepository.markChapterAsDownloaded({
    siteIntegrationId: task.siteIntegrationId,
    chapterId: chapter.id,
    url: chapter.url,
    title: chapter.title,
    seriesId: task.mangaId,
    seriesTitle: task.seriesTitle,
    chapterNumber: chapter.chapterNumber,
    volumeNumber: chapter.volumeNumber,
    downloadedAt: Date.now(),
    fileSize: 0,
    format: persistedFormat,
  })
}

/**
 * Repair the downloaded-chapter projection from the durable queue after an
 * interrupted service-worker run. This is idempotent and intentionally treats
 * only fully completed chapters as downloaded.
 */
export async function reconcileCompletedChapterHistory(
  tasks: DownloadTaskState[],
  deps: DownloadQueueFinalizationDependencies
): Promise<void> {
  const existing = await deps.historyRepository.getDownloadedChapters()
  const persistedKeys = new Set(
    existing.map((record) =>
      composeDownloadedChapterKey(
        record.siteIntegrationId,
        record.seriesId,
        record.chapterId
      )
    )
  )

  for (const task of tasks) {
    for (const chapter of task.chapters) {
      if (chapter.status !== "completed") continue

      const key = composeDownloadedChapterKey(
        task.siteIntegrationId,
        task.mangaId,
        chapter.id
      )
      if (persistedKeys.has(key)) continue
      const restored =
        await deps.historyRepository.restoreChapterFromCompletedTask(
          {
            siteIntegrationId: task.siteIntegrationId,
            chapterId: chapter.id,
            url: chapter.url,
            title: chapter.title,
            seriesId: task.mangaId,
            seriesTitle: task.seriesTitle,
            chapterNumber: chapter.chapterNumber,
            volumeNumber: chapter.volumeNumber,
            downloadedAt: chapter.lastUpdated,
            fileSize: 0,
            format: resolvePersistedFormat(task.settingsSnapshot),
          },
          chapter.lastUpdated
        )
      if (restored) persistedKeys.add(key)
    }
  }
}

async function persistCompletedChapters(
  task: DownloadTaskState,
  chapterOutcomes: ChapterDispatchOutcome[],
  persistedFormat: "cbz" | "zip" | "none",
  deps: DownloadQueueFinalizationDependencies
): Promise<void> {
  for (const outcome of chapterOutcomes) {
    if (outcome.status !== "completed") {
      continue
    }

    await persistCompletedChapter(
      task,
      outcome.chapterId,
      persistedFormat,
      deps
    )
  }
}

export async function finalizeDownloadTaskAfterDispatch(input: {
  stateManager: QueueRepository
  taskId: string
  chapterOutcomesByIndex: Array<ChapterDispatchOutcome | undefined>
  settingsSnapshot: DownloadTaskState["settingsSnapshot"]
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
  const persistedFormat = resolvePersistedFormat(input.settingsSnapshot)
  const finalization = await input.stateManager.finalizeDownloadTask({
    taskId: input.taskId,
    chapterOutcomesByIndex: input.chapterOutcomesByIndex,
    completedAt: Date.now(),
    clearLease: input.dispatchLease,
  })

  if (finalization.outcome === "applied") {
    try {
      await persistCompletedChapters(
        finalization.task,
        finalization.chapterOutcomes,
        persistedFormat,
        input.finalizationDependencies
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
