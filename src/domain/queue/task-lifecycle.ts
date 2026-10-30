import type {
  DownloadErrorCategory,
  DownloadTaskStatus,
} from "@/src/shared/download-contract"
import type { ChapterStatus } from "@/src/types/chapter"
import type { DownloadTaskState, OutputAccounting, TaskChapter } from "./state"

const TERMINAL_TASK_STATUSES: ReadonlySet<DownloadTaskStatus> = new Set([
  "completed",
  "partial_success",
  "failed",
  "canceled",
])

const TERMINAL_CHAPTER_STATUSES: ReadonlySet<ChapterStatus> = new Set([
  "completed",
  "failed",
  "partial_success",
  "canceled",
  "skipped",
])

export interface ChapterDispatchOutcome {
  chapterId: string
  status: "completed" | "partial_success" | "failed"
  errorMessage?: string
  errorCategory?: DownloadErrorCategory
  imagesFailed?: number
}

export function firstUnsuccessfulChapter<T extends Pick<TaskChapter, "status">>(
  chapters: readonly T[]
): T | undefined {
  return chapters.find(
    (chapter) =>
      chapter.status === "failed" || chapter.status === "partial_success"
  )
}

export function isTerminalDownloadTask(
  task: Pick<DownloadTaskState, "status">
): boolean {
  return TERMINAL_TASK_STATUSES.has(task.status)
}

export function isTerminalChapterStatus(status: ChapterStatus): boolean {
  return TERMINAL_CHAPTER_STATUSES.has(status)
}

export function isLogicallyBlockedTask(
  task: Pick<DownloadTaskState, "status" | "activeBlock">
): boolean {
  return !isTerminalDownloadTask(task) && task.activeBlock !== undefined
}

export function isRunnableQueuedTask(
  task: Pick<DownloadTaskState, "status" | "activeBlock">
): boolean {
  return task.status === "queued" && !isLogicallyBlockedTask(task)
}

export function isExecutingDownloadTask(
  task: Pick<DownloadTaskState, "status" | "activeBlock">
): boolean {
  return task.status === "downloading" && !isLogicallyBlockedTask(task)
}

export function isWatchdogEligibleTask(
  task: Pick<DownloadTaskState, "status" | "activeBlock">
): boolean {
  return isExecutingDownloadTask(task)
}

/**
 * Repair persisted or transition-produced combinations that are not valid
 * execution states. Nonterminal blocks wait in the queue without consuming the
 * single execution slot; terminal tasks retain no active wait metadata.
 */
export function normalizeDownloadTaskExecutionState(
  task: DownloadTaskState
): DownloadTaskState {
  if (isTerminalDownloadTask(task)) {
    if (!task.activeBlock) return task
    return {
      ...task,
      activeBlock: undefined,
    }
  }

  if (task.activeBlock && task.status === "downloading") {
    return {
      ...task,
      status: "queued",
    }
  }

  return task
}

export function normalizeInterruptedChapter(
  chapter: TaskChapter,
  errorMessage: string,
  now: number
): TaskChapter {
  if (chapter.status !== "downloading" && chapter.status !== "queued") {
    return chapter
  }

  if (
    chapter.status === "downloading" &&
    chapter.outputs &&
    chapter.outputs.committed > 0
  ) {
    return recoverCommittedChapter(chapter, chapter.outputs, errorMessage, now)
  }

  return {
    ...chapter,
    status: "failed",
    errorMessage,
    errorCategory: "unknown",
    lastUpdated: now,
  }
}

function recoverCommittedChapter(
  chapter: TaskChapter,
  outputs: OutputAccounting,
  errorMessage: string,
  now: number
): TaskChapter {
  const requested = Math.max(0, outputs.requested)
  const committed = Math.max(0, outputs.committed)
  const failed = Math.max(0, outputs.failed, requested - committed)
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

export function resolveTerminalChapterTaskStatus(
  chapters: readonly Pick<TaskChapter, "status">[]
): "completed" | "partial_success" | "failed" {
  if (
    chapters.length > 0 &&
    chapters.every((chapter) => chapter.status === "completed")
  )
    return "completed"
  return chapters.some(
    (chapter) =>
      chapter.status === "completed" || chapter.status === "partial_success"
  )
    ? "partial_success"
    : "failed"
}

export function normalizeInterruptedTask(
  task: DownloadTaskState,
  errorMessage: string,
  now: number
): DownloadTaskState {
  const normalizedChapters = task.chapters.map((chapter) =>
    normalizeInterruptedChapter(chapter, errorMessage, now)
  )
  const status = resolveTerminalChapterTaskStatus(normalizedChapters)
  const allChaptersCompleted = status === "completed"

  const failureChapter = firstUnsuccessfulChapter(normalizedChapters)

  return {
    ...task,
    status,
    activeBlock: undefined,
    errorMessage: allChaptersCompleted
      ? undefined
      : (failureChapter?.errorMessage ?? errorMessage),
    errorCategory: allChaptersCompleted
      ? undefined
      : (failureChapter?.errorCategory ?? "unknown"),
    completed: task.completed ?? now,
    chapters: normalizedChapters,
  }
}

export function materializeCanceledChapters(
  chapters: readonly TaskChapter[],
  now: number
): TaskChapter[] {
  return chapters.map((chapter) => {
    if (chapter.status === "downloading") {
      return {
        ...chapter,
        status: "canceled",
        errorMessage: "Canceled by user",
        lastUpdated: now,
      }
    }
    if (chapter.status === "queued") {
      return {
        ...chapter,
        status: "skipped",
        errorMessage: "Skipped after task cancellation",
        lastUpdated: now,
      }
    }
    return chapter
  })
}

export function cancelDownloadingTask(
  task: DownloadTaskState,
  now: number
): DownloadTaskState {
  return {
    ...task,
    status: "canceled",
    activeBlock: undefined,
    completed: now,
    chapters: materializeCanceledChapters(task.chapters, now),
  }
}

export function materializeChapterDispatchOutcomes(
  task: DownloadTaskState,
  chapterOutcomesByIndex: readonly (ChapterDispatchOutcome | undefined)[]
): ChapterDispatchOutcome[] {
  return chapterOutcomesByIndex.map((outcome, index) => {
    if (outcome) return outcome

    const chapter = task.chapters[index]
    return {
      chapterId: chapter?.id || `unknown-chapter-${index + 1}`,
      status: "failed",
      errorMessage: "Chapter did not complete dispatch",
      errorCategory: "unknown",
    }
  })
}

export function resolveFinalDownloadTaskStatus(
  chapterOutcomes: readonly ChapterDispatchOutcome[]
): DownloadTaskState["status"] {
  const hasFailed = chapterOutcomes.some(
    (outcome) => outcome.status === "failed"
  )
  const hasPartial = chapterOutcomes.some(
    (outcome) => outcome.status === "partial_success"
  )
  if (!hasFailed && !hasPartial) return "completed"

  const hasSuccessful = chapterOutcomes.some(
    (outcome) =>
      outcome.status === "completed" || outcome.status === "partial_success"
  )
  return hasSuccessful ? "partial_success" : "failed"
}
