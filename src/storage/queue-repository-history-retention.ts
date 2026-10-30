import { composeDownloadedChapterKey } from "@/src/domain/history/types"
import type {
  DownloadTaskState,
  QueueAggregateState,
} from "@/src/domain/queue/state"

type RetainedCompletion = { latest: number; confirmed?: number }
type TaskChapter = DownloadTaskState["chapters"][number]

function historySources(state: QueueAggregateState): DownloadTaskState[] {
  return [
    ...state.queue,
    ...state.pendingUndoActions.map((action) => action.taskSnapshot),
  ]
}

function chapterKey(task: DownloadTaskState, chapter: TaskChapter): string {
  return composeDownloadedChapterKey(
    task.siteIntegrationId,
    task.mangaId,
    chapter.id
  )
}

function retainCompletion(
  retained: RetainedCompletion | undefined,
  chapter: TaskChapter
): RetainedCompletion {
  return {
    latest: Math.max(retained?.latest ?? 0, chapter.lastUpdated),
    confirmed:
      chapter.saveConfirmedAt === undefined
        ? retained?.confirmed
        : Math.max(retained?.confirmed ?? 0, chapter.lastUpdated),
  }
}

function retainedCompletions(
  state: QueueAggregateState
): Map<string, RetainedCompletion> {
  const retained = new Map<string, RetainedCompletion>()
  for (const task of historySources(state)) {
    for (const chapter of task.chapters) {
      if (chapter.status !== "completed") continue
      const key = chapterKey(task, chapter)
      retained.set(key, retainCompletion(retained.get(key), chapter))
    }
  }
  return retained
}

/** Completed chapters whose last durable repair evidence is being removed. */
export function lostCompletedChapterSources(
  previous: QueueAggregateState,
  next: QueueAggregateState
): DownloadTaskState[] {
  const retained = retainedCompletions(next)
  return historySources(previous)
    .map((task) => ({
      ...task,
      chapters: task.chapters.filter((chapter) => {
        if (chapter.status !== "completed") return false
        const completion = retained.get(chapterKey(task, chapter))
        const retainedAt =
          chapter.saveConfirmedAt === undefined
            ? completion?.latest
            : completion?.confirmed
        return retainedAt === undefined || retainedAt < chapter.lastUpdated
      }),
    }))
    .filter((task) => task.chapters.length > 0)
}
