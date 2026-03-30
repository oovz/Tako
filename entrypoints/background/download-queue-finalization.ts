import logger from '@/src/runtime/logger'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import { areNotificationsEnabled } from '@/entrypoints/background/notification-preferences'
import { getNotificationService } from '@/entrypoints/background/notification-service'
import { settingsService } from '@/src/storage/settings-service'
import { chapterPersistenceService } from '@/src/storage/chapter-persistence-service'
import type { DownloadTaskState } from '@/src/types/queue-state'

export type ChapterDispatchOutcome = {
  chapterId: string
  status: 'completed' | 'partial_success' | 'failed'
  errorMessage?: string
  errorCategory?: 'network' | 'download' | 'other'
  imagesFailed?: number
}

function materializeChapterOutcomes(
  task: DownloadTaskState,
  chapterOutcomesByIndex: Array<ChapterDispatchOutcome | undefined>,
): ChapterDispatchOutcome[] {
  return chapterOutcomesByIndex.map((outcome, index) => {
    if (outcome) {
      return outcome
    }

    const chapter = task.chapters[index]
    return {
      chapterId: chapter?.id || `unknown-chapter-${index + 1}`,
      status: 'failed',
      errorMessage: 'Chapter did not complete dispatch',
    }
  })
}

function resolveFinalTaskStatus(chapterOutcomes: ChapterDispatchOutcome[]): DownloadTaskState['status'] {
  const completedCount = chapterOutcomes.filter((outcome) => outcome.status === 'completed').length
  const partialCount = chapterOutcomes.filter((outcome) => outcome.status === 'partial_success').length
  const failedCount = chapterOutcomes.filter((outcome) => outcome.status === 'failed').length

  if (failedCount === 0 && partialCount === 0) {
    return 'completed'
  }

  if (completedCount > 0 || partialCount > 0) {
    return 'partial_success'
  }

  return 'failed'
}

function resolvePersistedFormat(
  settingsSnapshot: DownloadTaskState['settingsSnapshot'],
  fallbackFormat: 'cbz' | 'zip' | 'none',
): 'cbz' | 'zip' | 'none' {
  const archiveFormat = settingsSnapshot.archiveFormat
  if (archiveFormat === 'cbz' || archiveFormat === 'zip' || archiveFormat === 'none') {
    return archiveFormat
  }

  return fallbackFormat
}

async function persistCompletedChapters(
  task: DownloadTaskState,
  chapterOutcomes: ChapterDispatchOutcome[],
  persistedFormat: 'cbz' | 'zip' | 'none',
): Promise<void> {
  for (const outcome of chapterOutcomes) {
    if (outcome.status !== 'completed') {
      continue
    }

    const chapter = task.chapters.find((taskChapter) => taskChapter.id === outcome.chapterId)
    if (!chapter) {
      continue
    }

    await chapterPersistenceService.markChapterAsDownloaded({
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
}

export async function finalizeDownloadTaskAfterDispatch(input: {
  stateManager: CentralizedStateManager
  taskId: string
  task: DownloadTaskState
  chapterOutcomesByIndex: Array<ChapterDispatchOutcome | undefined>
  settingsSnapshot: DownloadTaskState['settingsSnapshot']
  defaultFormat: 'cbz' | 'zip' | 'none'
}): Promise<{
  chapterOutcomes: ChapterDispatchOutcome[]
  completedCount: number
  finalStatus: DownloadTaskState['status']
}> {
  const chapterOutcomes = materializeChapterOutcomes(input.task, input.chapterOutcomesByIndex)
  const completedCount = chapterOutcomes.filter((outcome) => outcome.status === 'completed').length
  const failedCount = chapterOutcomes.filter((outcome) => outcome.status === 'failed').length
  const finalStatus = resolveFinalTaskStatus(chapterOutcomes)
  const persistedFormat = resolvePersistedFormat(input.settingsSnapshot, input.defaultFormat)

  await persistCompletedChapters(input.task, chapterOutcomes, persistedFormat)

  const firstFailedOutcome = chapterOutcomes.find((o) => o.status === 'failed')
  await input.stateManager.updateDownloadTask(input.taskId, {
    status: finalStatus,
    completed: Date.now(),
    errorMessage: failedCount > 0 ? `Some chapters failed (${completedCount}/${chapterOutcomes.length})` : undefined,
    errorCategory: firstFailedOutcome?.errorCategory,
  })

  return {
    chapterOutcomes,
    completedCount,
    finalStatus,
  }
}

export async function notifyDownloadTaskCompletion(input: {
  stateManager: CentralizedStateManager
  taskId: string
  finalStatus: DownloadTaskState['status']
  completedCount: number
  totalChapters: number
}): Promise<void> {
  try {
    const taskAfterCompletion = (await input.stateManager.getGlobalState()).downloadQueue.find(
      (queuedTask) => queuedTask.id === input.taskId,
    )
    if (!taskAfterCompletion) {
      return
    }

    const settings = await settingsService.getSettings()
    const notificationsEnabled = areNotificationsEnabled(settings)
    if (!notificationsEnabled) {
      return
    }

    const notificationService = getNotificationService()
    if (input.finalStatus === 'completed') {
      notificationService.showDownloadCompleteNotification({
        task: taskAfterCompletion,
        notificationsEnabled,
        chaptersCompleted: input.completedCount,
        chaptersTotal: input.totalChapters,
      })
    }

    if ((input.finalStatus === 'failed' || input.finalStatus === 'partial_success') && taskAfterCompletion.errorMessage) {
      notificationService.notifyTaskFailed({
        task: taskAfterCompletion,
        notificationsEnabled,
        errorMessage: taskAfterCompletion.errorMessage,
      })
    }
  } catch (error) {
    logger.debug('[Queue] Completion side effects failed (non-fatal)', error)
  }
}

