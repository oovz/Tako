import type { DownloadTaskState, TaskChapter } from '@/src/types/queue-state'

export function normalizeInterruptedChapter(
  chapter: TaskChapter,
  errorMessage: string,
  now: number,
): TaskChapter {
  if (chapter.status !== 'downloading' && chapter.status !== 'queued') {
    return chapter
  }

  return {
    ...chapter,
    status: 'failed',
    errorMessage,
    lastUpdated: now,
  }
}

export function normalizeInterruptedTask(
  task: DownloadTaskState,
  errorMessage: string,
  now: number = Date.now(),
): DownloadTaskState {
  const normalizedChapters = task.chapters.map((chapter) => normalizeInterruptedChapter(chapter, errorMessage, now))
  const completedCount = normalizedChapters.filter((chapter) => chapter.status === 'completed').length

  return {
    ...task,
    status: completedCount > 0 ? 'partial_success' : 'failed',
    errorMessage,
    completed: task.completed ?? now,
    chapters: normalizedChapters,
  }
}
