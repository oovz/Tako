import { isRecord } from "@/src/shared/type-guards"
import { materializeCanceledChapters } from "./task-lifecycle"
import type {
  DownloadTaskState,
  PendingUndoAction,
  PendingUndoActionType,
  PendingUndoReceipt,
} from "./state"

export const PENDING_UNDO_WINDOW_MS = 5_000

const PENDING_UNDO_ACTION_TYPES = new Set<PendingUndoActionType>([
  "cancel_queued",
  "remove_history",
])

export function createPendingUndoAction(input: {
  token: string
  type: PendingUndoActionType
  taskSnapshot: DownloadTaskState
  previousQueuePosition: number
  now: number
}): PendingUndoAction {
  return {
    token: input.token,
    type: input.type,
    taskSnapshot: structuredClone(input.taskSnapshot),
    previousQueuePosition: input.previousQueuePosition,
    createdAt: input.now,
    expiresAt: input.now + PENDING_UNDO_WINDOW_MS,
  }
}

export function toPendingUndoReceipt(
  action: PendingUndoAction
): PendingUndoReceipt {
  return {
    token: action.token,
    type: action.type,
    expiresAt: action.expiresAt,
  }
}

export function isPendingUndoReceipt(
  value: unknown
): value is PendingUndoReceipt {
  return (
    isRecord(value) &&
    typeof value.token === "string" &&
    PENDING_UNDO_ACTION_TYPES.has(value.type as PendingUndoActionType) &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt)
  )
}

export function reinsertPendingUndoTask(
  queue: readonly DownloadTaskState[],
  action: PendingUndoAction,
  task: DownloadTaskState
): DownloadTaskState[] {
  const nextQueue = structuredClone(queue) as DownloadTaskState[]
  if (nextQueue.some((candidate) => candidate.id === task.id)) return nextQueue

  nextQueue.splice(
    Math.min(action.previousQueuePosition, nextQueue.length),
    0,
    structuredClone(task)
  )
  return nextQueue
}

export function materializeExpiredCancellationTask(
  action: PendingUndoAction
): DownloadTaskState {
  const task = structuredClone(action.taskSnapshot)
  return {
    ...task,
    status: "canceled",
    activeBlock: undefined,
    errorMessage: undefined,
    errorCategory: undefined,
    completed: action.createdAt,
    chapters: materializeCanceledChapters(task.chapters, action.createdAt),
  }
}

export function applyExpiredPendingUndoAction(
  queue: readonly DownloadTaskState[],
  action: PendingUndoAction
): DownloadTaskState[] {
  if (action.type !== "cancel_queued") {
    return structuredClone(queue) as DownloadTaskState[]
  }
  return reinsertPendingUndoTask(
    queue,
    action,
    materializeExpiredCancellationTask(action)
  )
}

export function partitionPendingUndoActions(
  actions: readonly PendingUndoAction[],
  now: number
): { finalized: PendingUndoAction[]; pending: PendingUndoAction[] } {
  return {
    finalized: actions.filter((action) => now >= action.expiresAt),
    pending: actions.filter((action) => now < action.expiresAt),
  }
}
