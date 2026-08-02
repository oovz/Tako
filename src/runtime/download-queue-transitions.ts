import type { DownloadTaskStatus } from "@/src/shared/download-contract"
import type { ChapterStatus } from "@/src/types/chapter"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
  TaskChapter,
} from "@/src/types/queue-state"
import {
  isExecutingDownloadTask,
  normalizeDownloadTaskExecutionState,
} from "@/src/runtime/download-task-execution-state"

export type DownloadTaskTransitionResult =
  | { success: true; task: DownloadTaskState }
  | { success: false; reason: "not-found" }
  | {
      success: false
      reason: "invalid-status"
      currentStatus: DownloadTaskStatus
    }
  | { success: false; reason: "active-task-exists" }

export type DownloadingTaskChapterUpdateResult =
  | { success: true; updated: boolean }
  | { success: false; reason: "task-not-found" }
  | { success: false; reason: "chapter-not-found" }
  | {
      success: false
      reason: "task-not-downloading"
      currentStatus: DownloadTaskStatus
    }

export type BeginChapterDispatchTransitionResult =
  | { success: true; updated: true }
  | Exclude<DownloadingTaskChapterUpdateResult, { success: true }>
  | { success: false; reason: "chapter-not-dispatchable" }

export interface TaskChapterUpdate {
  errorMessage?: string
  errorCategory?: TaskChapter["errorCategory"]
  totalImages?: number
  imagesFailed?: number
  outputs?: TaskChapter["outputs"]
  dispatchAttempt?: number
}

export interface QueueMutationResult<TResult> {
  queue: DownloadTaskState[]
  result: TResult
}

const TERMINAL_CHAPTER_STATUSES: ReadonlySet<ChapterStatus> = new Set([
  "completed",
  "failed",
  "partial_success",
  "canceled",
  "skipped",
])

export function isTerminalChapterStatus(status: ChapterStatus): boolean {
  return TERMINAL_CHAPTER_STATUSES.has(status)
}

function replaceTaskAt(
  queue: readonly DownloadTaskState[],
  taskIndex: number,
  task: DownloadTaskState
): DownloadTaskState[] {
  const nextQueue = [...queue]
  nextQueue[taskIndex] = task
  return nextQueue
}

function applyChapterUpdate(
  currentChapter: TaskChapter,
  status: ChapterStatus,
  updates: TaskChapterUpdate | undefined,
  now: number
): TaskChapter {
  return {
    ...currentChapter,
    status,
    errorMessage: updates?.errorMessage,
    errorCategory: updates?.errorCategory,
    totalImages: updates?.totalImages ?? currentChapter.totalImages,
    imagesFailed: updates?.imagesFailed ?? currentChapter.imagesFailed,
    outputs: updates?.outputs ?? currentChapter.outputs,
    dispatchAttempt: updates?.dispatchAttempt ?? currentChapter.dispatchAttempt,
    lastUpdated: now,
  }
}

export function updateDownloadTaskInQueue(
  queue: readonly DownloadTaskState[],
  taskId: string,
  updates: Omit<Partial<DownloadTaskState>, "id" | "status">
): QueueMutationResult<{ found: boolean; task?: DownloadTaskState }> {
  const taskIndex = queue.findIndex((task) => task.id === taskId)
  if (taskIndex === -1) {
    return { queue: [...queue], result: { found: false } }
  }

  const updatedTask: DownloadTaskState = {
    ...queue[taskIndex],
    ...updates,
  }
  return {
    queue: replaceTaskAt(queue, taskIndex, updatedTask),
    result: { found: true, task: updatedTask },
  }
}

export function transitionDownloadTaskInQueue(
  queue: readonly DownloadTaskState[],
  taskId: string,
  allowedCurrentStatuses: readonly DownloadTaskStatus[],
  updates: Omit<Partial<DownloadTaskState>, "id" | "status"> & {
    status: DownloadTaskStatus
  }
): QueueMutationResult<DownloadTaskTransitionResult> {
  const taskIndex = queue.findIndex((task) => task.id === taskId)
  if (taskIndex === -1) {
    return {
      queue: [...queue],
      result: { success: false, reason: "not-found" },
    }
  }

  const currentTask = queue[taskIndex]
  if (!allowedCurrentStatuses.includes(currentTask.status)) {
    return {
      queue: [...queue],
      result: {
        success: false,
        reason: "invalid-status",
        currentStatus: currentTask.status,
      },
    }
  }

  if (
    updates.status === "downloading" &&
    queue.some((task) => task.id !== taskId && isExecutingDownloadTask(task))
  ) {
    return {
      queue: [...queue],
      result: { success: false, reason: "active-task-exists" },
    }
  }

  const updatedTask = normalizeDownloadTaskExecutionState({
    ...currentTask,
    ...updates,
  })
  return {
    queue: replaceTaskAt(queue, taskIndex, updatedTask),
    result: { success: true, task: updatedTask },
  }
}

export function updateTaskChapterInQueue(input: {
  queue: readonly DownloadTaskState[]
  taskId: string
  chapterId: string
  status: ChapterStatus
  updates?: TaskChapterUpdate
  now: number
  requireDownloadingTask: boolean
}): QueueMutationResult<DownloadingTaskChapterUpdateResult> {
  const taskIndex = input.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      queue: [...input.queue],
      result: { success: false, reason: "task-not-found" },
    }
  }

  const task = input.queue[taskIndex]
  if (input.requireDownloadingTask && task.status !== "downloading") {
    return {
      queue: [...input.queue],
      result: {
        success: false,
        reason: "task-not-downloading",
        currentStatus: task.status,
      },
    }
  }

  const chapterIndex = task.chapters.findIndex(
    (chapter) => chapter.id === input.chapterId
  )
  if (chapterIndex === -1) {
    return {
      queue: [...input.queue],
      result: { success: false, reason: "chapter-not-found" },
    }
  }

  const currentChapter = task.chapters[chapterIndex]
  if (
    isTerminalChapterStatus(currentChapter.status) &&
    input.status !== currentChapter.status
  ) {
    return {
      queue: [...input.queue],
      result: { success: true, updated: false },
    }
  }

  const chapters = [...task.chapters]
  chapters[chapterIndex] = applyChapterUpdate(
    currentChapter,
    input.status,
    input.updates,
    input.now
  )
  const updatedTask: DownloadTaskState = { ...task, chapters }
  return {
    queue: replaceTaskAt(input.queue, taskIndex, updatedTask),
    result: { success: true, updated: true },
  }
}

export function beginChapterDispatchInQueue(input: {
  queue: readonly DownloadTaskState[]
  taskId: string
  chapterId: string
  lease: ActiveDispatchLease
  now: number
}): QueueMutationResult<BeginChapterDispatchTransitionResult> {
  const taskIndex = input.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      queue: [...input.queue],
      result: { success: false, reason: "task-not-found" },
    }
  }

  const task = input.queue[taskIndex]
  if (task.status !== "downloading") {
    return {
      queue: [...input.queue],
      result: {
        success: false,
        reason: "task-not-downloading",
        currentStatus: task.status,
      },
    }
  }

  const chapterIndex = task.chapters.findIndex(
    (chapter) => chapter.id === input.chapterId
  )
  if (chapterIndex === -1) {
    return {
      queue: [...input.queue],
      result: { success: false, reason: "chapter-not-found" },
    }
  }

  const chapter = task.chapters[chapterIndex]
  if (chapter.status !== "queued" && chapter.status !== "downloading") {
    return {
      queue: [...input.queue],
      result: { success: false, reason: "chapter-not-dispatchable" },
    }
  }

  const chapters = [...task.chapters]
  chapters[chapterIndex] = {
    ...chapter,
    status: "downloading",
    dispatchAttempt: input.lease.attempt,
    outputs: { requested: 0, committed: 0, failed: 0 },
    errorMessage: undefined,
    lastUpdated: input.now,
  }
  return {
    queue: replaceTaskAt(input.queue, taskIndex, { ...task, chapters }),
    result: { success: true, updated: true },
  }
}

export function cancelDownloadingTask(
  task: DownloadTaskState,
  now: number
): DownloadTaskState {
  return {
    ...task,
    status: "canceled",
    activeBlock: undefined,
    browserDownloadWait: undefined,
    completed: now,
    chapters: task.chapters.map((chapter) => {
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
    }),
  }
}
