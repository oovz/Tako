import type { DownloadTaskState, TaskChapter } from "@/src/types/queue-state"

export function normalizeInterruptedChapter(
  chapter: TaskChapter,
  errorMessage: string,
  now: number
): TaskChapter {
  if (chapter.status !== "downloading" && chapter.status !== "queued") {
    return chapter
  }

  const requested = Math.max(0, chapter.outputs?.requested ?? 0)
  const committed = Math.max(0, chapter.outputs?.committed ?? 0)
  const recordedFailed = Math.max(0, chapter.outputs?.failed ?? 0)
  if (chapter.status === "downloading" && committed > 0) {
    const failed = Math.max(recordedFailed, requested - committed)
    const complete = requested > 0 && committed === requested && failed === 0
    return {
      ...chapter,
      status: complete ? "completed" : "partial_success",
      errorMessage: complete ? undefined : errorMessage,
      errorCategory: complete ? undefined : "unknown",
      outputs: { requested, committed, failed },
      lastUpdated: now,
    }
  }

  return {
    ...chapter,
    status: "failed",
    errorMessage,
    errorCategory: "unknown",
    lastUpdated: now,
  }
}

export function normalizeInterruptedTask(
  task: DownloadTaskState,
  errorMessage: string,
  now: number = Date.now()
): DownloadTaskState {
  const normalizedChapters = task.chapters.map((chapter) =>
    normalizeInterruptedChapter(chapter, errorMessage, now)
  )
  const successfulCount = normalizedChapters.filter(
    (chapter) =>
      chapter.status === "completed" || chapter.status === "partial_success"
  ).length
  const allChaptersCompleted =
    normalizedChapters.length > 0 &&
    normalizedChapters.every((chapter) => chapter.status === "completed")

  return {
    ...task,
    status: allChaptersCompleted
      ? "completed"
      : successfulCount > 0
        ? "partial_success"
        : "failed",
    activeBlock: undefined,
    browserDownloadWait: undefined,
    errorMessage: allChaptersCompleted ? undefined : errorMessage,
    errorCategory: allChaptersCompleted ? undefined : "unknown",
    completed: task.completed ?? now,
    chapters: normalizedChapters,
  }
}
