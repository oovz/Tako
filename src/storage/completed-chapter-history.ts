import { composeDownloadedChapterKey } from "@/src/domain/history/types"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { HistoryRepository } from "@/src/storage/history-repository"

/**
 * Reconcile chapter history with completed task snapshots and their save evidence.
 * The repository enforces explicit clear cutoffs during each restoration.
 */
export async function reconcileCompletedChapterHistory(
  tasks: DownloadTaskState[],
  historyRepository: Pick<
    HistoryRepository,
    "getDownloadedChapters" | "restoreChapterFromCompletedTask"
  >
): Promise<void> {
  const existing = await historyRepository.getDownloadedChapters()
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
      if (persistedKeys.has(key) && chapter.saveConfirmedAt === undefined)
        continue
      const restored = await historyRepository.restoreChapterFromCompletedTask(
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
          outputDestination: chapter.outputDestination,
          saveConfirmedAt: chapter.saveConfirmedAt,
          fileSize: 0,
          format: task.settingsSnapshot.archiveFormat,
        },
        chapter.lastUpdated
      )
      if (restored) persistedKeys.add(key)
    }
  }
}
