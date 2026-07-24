import type {
  DownloadTaskState,
  QueueTaskSummary,
} from "@/src/types/queue-state"

export function composeSeriesKey(siteId: string, seriesId: string): string {
  return `${siteId}#${seriesId}`
}

export function toQueueTaskSummary(task: DownloadTaskState): QueueTaskSummary {
  const totalChapters = task.chapters.length
  let completedChapters = 0
  let unsuccessfulChapters = 0

  for (const chapter of task.chapters) {
    if (chapter.status === "completed") {
      completedChapters += 1
    } else if (
      chapter.status === "failed" ||
      chapter.status === "partial_success"
    ) {
      unsuccessfulChapters += 1
    }
  }

  const failureCategory =
    task.errorCategory ??
    task.chapters.find((chapter) => chapter.errorCategory)?.errorCategory ??
    (task.status === "failed" || task.status === "partial_success"
      ? "unknown"
      : undefined)

  return {
    id: task.id,
    seriesKey: composeSeriesKey(task.siteIntegrationId, task.mangaId),
    seriesTitle: task.seriesTitle,
    siteIntegration: task.siteIntegrationId,
    coverUrl: task.seriesCoverUrl,
    status: task.status,
    chapters: {
      total: totalChapters,
      completed: completedChapters,
      unsuccessful: unsuccessfulChapters,
    },
    timestamps: {
      created: task.created,
      completed: task.completed,
    },
    failureCategory,
    isRetried: task.isRetried ?? false,
    isRetryTask: task.isRetryTask ?? false,
    lastSuccessfulDownloadId: task.lastSuccessfulDownloadId,
  }
}
