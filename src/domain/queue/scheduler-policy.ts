import type { ActiveDispatchLease, DownloadTaskState } from "./state"
import { isExecutingDownloadTask, isRunnableQueuedTask } from "./task-lifecycle"

export type QueueSchedulingPlan =
  | { kind: "drained" }
  | { kind: "wait" }
  | { kind: "start-task"; taskId: string }

/**
 * Choose the next serial queue action from one authoritative observation.
 * Native browser output no longer occupies the offscreen execution slot.
 */
export function planQueueScheduling(input: {
  queue: DownloadTaskState[]
  activeLease: ActiveDispatchLease | null
}): QueueSchedulingPlan {
  const runnableTask = input.queue.find(isRunnableQueuedTask)
  const activeTasks = input.queue.filter(isExecutingDownloadTask)

  if (!runnableTask) {
    return activeTasks.length === 0 ? { kind: "drained" } : { kind: "wait" }
  }

  if (input.activeLease !== null || activeTasks.length > 0) {
    return { kind: "wait" }
  }

  return { kind: "start-task", taskId: runnableTask.id }
}

export type StartupQueueActivation =
  { kind: "resume-task"; taskId: string } | { kind: "process-queue" }

export function planStartupQueueActivation(input: {
  queue: DownloadTaskState[]
  resumeTaskId?: string
  activeLease: ActiveDispatchLease | null
  offscreenActiveTaskIds: readonly string[]
}): StartupQueueActivation | undefined {
  if (input.resumeTaskId) {
    return { kind: "resume-task", taskId: input.resumeTaskId }
  }

  if (
    input.activeLease === null &&
    input.offscreenActiveTaskIds.length === 0 &&
    !input.queue.some(isExecutingDownloadTask) &&
    input.queue.some(isRunnableQueuedTask)
  ) {
    return { kind: "process-queue" }
  }

  return undefined
}
