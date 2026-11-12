import { getEffectiveTaskDestination } from "@/src/domain/queue/task-destination"
import { firstUnsuccessfulChapter } from "@/src/domain/queue/task-lifecycle"
import {
  getCompletedOutputDestination,
  getCompletedSaveConfirmedAt,
  hasUncertainNativeOutput,
} from "@/src/runtime/output-result-presentation"
import type {
  DownloadTaskState,
  QueueTaskSummary,
  TaskChapter,
} from "@/src/domain/queue/state"

export function composeSeriesKey(siteId: string, seriesId: string): string {
  return `${siteId}#${seriesId}`
}

function countChapters(
  chapters: DownloadTaskState["chapters"]
): QueueTaskSummary["chapters"] {
  let completed = 0
  let unsuccessful = 0
  for (const chapter of chapters) {
    if (chapter.status === "completed") completed += 1
    else if (
      chapter.status === "failed" ||
      chapter.status === "partial_success"
    )
      unsuccessful += 1
  }
  return { total: chapters.length, completed, unsuccessful }
}

function getFailureCategory(
  task: DownloadTaskState,
  failureChapter: Pick<TaskChapter, "errorCategory"> | undefined
): QueueTaskSummary["failureCategory"] {
  if (task.status === "completed") return undefined
  if (failureChapter) return failureChapter.errorCategory ?? "unknown"
  return (
    task.errorCategory ??
    (task.status === "failed" || task.status === "partial_success"
      ? "unknown"
      : undefined)
  )
}

function isTargetUnavailable(
  task: DownloadTaskState,
  destination: QueueTaskSummary["destination"]
): true | undefined {
  return task.chapters.some((chapter) => chapter.requestedPath === null) ||
    (destination.kind === "file-system-access" && destination.handleId === null)
    ? true
    : undefined
}

function chapterRange(chapters: TaskChapter[]): string | undefined {
  if (chapters.length === 0) return undefined
  const numbers = chapters.map(
    (chapter) => chapter.chapterNumber ?? chapter.index
  )
  const first = numbers[0]
  if (numbers.length === 1) return String(first)
  if (numbers.every((number, index) => number === first + index))
    return first + "–" + numbers.at(-1)
  return numbers.slice(0, 3).join(", ") + (numbers.length > 3 ? "…" : "")
}

export function toQueueTaskSummary(task: DownloadTaskState): QueueTaskSummary {
  const destination = getEffectiveTaskDestination(task)
  const failureChapter = firstUnsuccessfulChapter(task.chapters)

  return {
    id: task.id,
    chapterRange: chapterRange(task.chapters),
    seriesKey: composeSeriesKey(task.siteIntegrationId, task.mangaId),
    seriesTitle: task.seriesTitle,
    siteIntegration: task.siteIntegrationId,
    coverUrl: task.seriesCoverUrl,
    status: task.status,
    activeBlock: task.activeBlock,
    destination,
    useChromeFallback: task.useChromeFallback,
    requestedPath: (
      failureChapter ??
      task.chapters.find((chapter) => chapter.status === "queued") ??
      task.chapters[0]
    )?.requestedPath,
    targetUnavailable: isTargetUnavailable(task, destination),
    outputDestination: getCompletedOutputDestination(task.chapters),
    saveConfirmedAt: getCompletedSaveConfirmedAt(task.chapters),
    outputMode:
      destination.kind === "file-system-access" ? "fsa" : "downloads-api",
    chapters: countChapters(task.chapters),
    timestamps: {
      created: task.created,
      started: task.started,
      completed: task.completed,
    },
    outputUncertain: hasUncertainNativeOutput(task.chapters),
    failureCategory: getFailureCategory(task, failureChapter),
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
