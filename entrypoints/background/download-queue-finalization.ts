import logger from "@/src/runtime/logger"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import { areNotificationsEnabled } from "@/entrypoints/background/notification-preferences"
import { getNotificationService } from "@/entrypoints/background/notification-service"
import { settingsService } from "@/src/storage/settings-service"
import {
  chapterPersistenceService,
  composeDownloadedChapterKey,
} from "@/src/storage/chapter-persistence-service"
import type { DownloadTaskState } from "@/src/types/queue-state"
import type { DownloadErrorCategory } from "@/src/shared/download-contract"

export type ChapterDispatchOutcome = {
  chapterId: string
  status: "completed" | "partial_success" | "failed"
  errorMessage?: string
  errorCategory?: DownloadErrorCategory
  imagesFailed?: number
}

function materializeChapterOutcomes(
  task: DownloadTaskState,
  chapterOutcomesByIndex: Array<ChapterDispatchOutcome | undefined>
): ChapterDispatchOutcome[] {
  return chapterOutcomesByIndex.map((outcome, index) => {
    if (outcome) {
      return outcome
    }

    const chapter = task.chapters[index]
    return {
      chapterId: chapter?.id || `unknown-chapter-${index + 1}`,
      status: "failed",
      errorMessage: "Chapter did not complete dispatch",
      errorCategory: "unknown",
    }
  })
}

function resolveFinalTaskStatus(
  chapterOutcomes: ChapterDispatchOutcome[]
): DownloadTaskState["status"] {
  const completedCount = chapterOutcomes.filter(
    (outcome) => outcome.status === "completed"
  ).length
  const partialCount = chapterOutcomes.filter(
    (outcome) => outcome.status === "partial_success"
  ).length
  const failedCount = chapterOutcomes.filter(
    (outcome) => outcome.status === "failed"
  ).length

  if (failedCount === 0 && partialCount === 0) {
    return "completed"
  }

  if (completedCount > 0 || partialCount > 0) {
    return "partial_success"
  }

  return "failed"
}

function resolvePersistedFormat(
  settingsSnapshot: DownloadTaskState["settingsSnapshot"]
): "cbz" | "zip" | "none" {
  return settingsSnapshot.archiveFormat
}

export async function persistCompletedChapter(
  task: DownloadTaskState,
  chapterId: string,
  persistedFormat: "cbz" | "zip" | "none"
): Promise<void> {
  const chapter = task.chapters.find(
    (taskChapter) => taskChapter.id === chapterId
  )
  if (!chapter) {
    return
  }

  await chapterPersistenceService.markChapterAsDownloaded({
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
  tasks: DownloadTaskState[]
): Promise<void> {
  const existing = await chapterPersistenceService.getDownloadedChapters()
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
        await chapterPersistenceService.restoreChapterFromCompletedTask(
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
  persistedFormat: "cbz" | "zip" | "none"
): Promise<void> {
  for (const outcome of chapterOutcomes) {
    if (outcome.status !== "completed") {
      continue
    }

    await persistCompletedChapter(task, outcome.chapterId, persistedFormat)
  }
}

export async function finalizeDownloadTaskAfterDispatch(input: {
  stateManager: CentralizedStateManager
  taskId: string
  task: DownloadTaskState
  chapterOutcomesByIndex: Array<ChapterDispatchOutcome | undefined>
  settingsSnapshot: DownloadTaskState["settingsSnapshot"]
}): Promise<{
  chapterOutcomes: ChapterDispatchOutcome[]
  completedCount: number
  finalStatus: DownloadTaskState["status"]
  finalized: boolean
}> {
  const chapterOutcomes = materializeChapterOutcomes(
    input.task,
    input.chapterOutcomesByIndex
  )
  const completedCount = chapterOutcomes.filter(
    (outcome) => outcome.status === "completed"
  ).length
  const failedCount = chapterOutcomes.filter(
    (outcome) => outcome.status === "failed"
  ).length
  const finalStatus = resolveFinalTaskStatus(chapterOutcomes)
  const persistedFormat = resolvePersistedFormat(input.settingsSnapshot)

  await persistCompletedChapters(input.task, chapterOutcomes, persistedFormat)

  const firstFailedOutcome = chapterOutcomes.find((o) => o.status === "failed")
  const transition = await input.stateManager.transitionDownloadTask(
    input.taskId,
    ["downloading"],
    {
      status: finalStatus,
      completed: Date.now(),
      errorMessage:
        failedCount > 0
          ? `Some chapters failed (${completedCount}/${chapterOutcomes.length})`
          : undefined,
      errorCategory:
        firstFailedOutcome?.errorCategory ??
        (finalStatus === "failed" || finalStatus === "partial_success"
          ? "unknown"
          : undefined),
    }
  )

  return {
    chapterOutcomes,
    completedCount,
    finalStatus,
    finalized: transition.success,
  }
}

export async function notifyDownloadTaskCompletion(input: {
  stateManager: CentralizedStateManager
  taskId: string
  finalStatus: DownloadTaskState["status"]
  completedCount: number
  totalChapters: number
}): Promise<void> {
  try {
    const taskAfterCompletion = (
      await input.stateManager.getGlobalState()
    ).downloadQueue.find((queuedTask) => queuedTask.id === input.taskId)
    if (!taskAfterCompletion) {
      return
    }

    await notifyTerminalDownloadTask({
      task: taskAfterCompletion,
      finalStatus: input.finalStatus,
      completedCount: input.completedCount,
      totalChapters: input.totalChapters,
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
}): Promise<void> {
  try {
    const taskAfterCompletion = input.task

    const settings = await settingsService.getSettings()
    const notificationsEnabled = areNotificationsEnabled(settings)
    if (!notificationsEnabled) {
      return
    }

    const notificationService = getNotificationService()
    if (input.finalStatus === "completed") {
      notificationService.showDownloadCompleteNotification({
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
      notificationService.notifyTaskFailed({
        task: taskAfterCompletion,
        notificationsEnabled,
        errorMessage: taskAfterCompletion.errorMessage,
      })
    }
  } catch (error) {
    logger.debug("[Queue] Completion side effects failed (non-fatal)", error)
  }
}
