import type { DownloadTaskStatus } from "@/src/shared/download-contract"
import type { DownloadTaskState } from "@/src/types/queue-state"

const TERMINAL_TASK_STATUSES: ReadonlySet<DownloadTaskStatus> = new Set([
  "completed",
  "partial_success",
  "failed",
  "canceled",
])

export function isTerminalDownloadTask(
  task: Pick<DownloadTaskState, "status">
): boolean {
  return TERMINAL_TASK_STATUSES.has(task.status)
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
    if (!task.activeBlock && !task.browserDownloadWait) return task
    return {
      ...task,
      activeBlock: undefined,
      browserDownloadWait: undefined,
    }
  }

  if (task.activeBlock && task.status === "downloading") {
    return {
      ...task,
      status: "queued",
      browserDownloadWait: undefined,
    }
  }

  return task
}
