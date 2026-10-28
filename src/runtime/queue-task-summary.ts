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
    destination: task.settingsSnapshot.destination,
    requestedPath: (
      failureChapter ??
      task.chapters.find((chapter) => chapter.status === "queued") ??
      task.chapters[0]
    )?.requestedPath,
    targetUnavailable:
      task.chapters.some((chapter) => chapter.requestedPath === null) ||
      (task.settingsSnapshot.destination.kind === "file-system-access" &&
        task.settingsSnapshot.destination.handleId === null)
        ? true
        : undefined,
    outputDestination: getCompletedOutputDestination(task.chapters),
    saveConfirmedAt: getCompletedSaveConfirmedAt(task.chapters),
    outputMode:
      task.settingsSnapshot.destination.kind === "file-system-access"
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
    outputUncertain: hasUncertainNativeOutput(task.chapters),
    failureCategory,
    folderAccessRequired: task.chapters.some(
      (chapter) => chapter.errorCategory === "folder_permission_required"
    )
      ? true
      : undefined,
    isRetried: task.isRetried ?? false,
    isRetryTask: task.isRetryTask ?? false,
    lastSuccessfulDownloadId: task.lastSuccessfulDownloadId,
  }
}
