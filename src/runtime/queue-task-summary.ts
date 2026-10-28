import { firstUnsuccessfulChapter } from "@/src/domain/queue/task-lifecycle"
import {
  getCompletedOutputDestination,
  getCompletedSaveConfirmedAt,
  hasUncertainNativeOutput,
} from "@/src/runtime/output-result-presentation"
import type {
  DownloadTaskState,
  QueueTaskSummary,
} from "@/src/domain/queue/state"

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

  const failureChapter = firstUnsuccessfulChapter(task.chapters)
  const failureCategory =
    task.status === "completed"
      ? undefined
      : failureChapter
        ? (failureChapter.errorCategory ?? "unknown")
        : (task.errorCategory ??
          (task.status === "failed" || task.status === "partial_success"
            ? "unknown"
            : undefined))

  return {
    id: task.id,
    seriesKey: composeSeriesKey(task.siteIntegrationId, task.mangaId),
    seriesTitle: task.seriesTitle,
    siteIntegration: task.siteIntegrationId,
    coverUrl: task.seriesCoverUrl,
    status: task.status,
    activeBlock: task.activeBlock,
    outputDestination: getCompletedOutputDestination(task.chapters),
    saveConfirmedAt: getCompletedSaveConfirmedAt(task.chapters),
    outputMode:
      (task.destinationOverride ?? task.settingsSnapshot.destination) ===
      "file-system-access"
        ? "fsa"
        : "downloads-api",
    chapters: {
      total: totalChapters,
      completed: completedChapters,
      unsuccessful: unsuccessfulChapters,
    },
    timestamps: {
      created: task.created,
      completed: task.completed,
    },
    acceptanceUncertain: hasUncertainNativeOutput(task.chapters),
    failureCategory,
    isRetried: task.isRetried ?? false,
    isRetryTask: task.isRetryTask ?? false,
    lastSuccessfulDownloadId: task.lastSuccessfulDownloadId,
  }
}
