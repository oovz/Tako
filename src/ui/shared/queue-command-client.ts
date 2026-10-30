import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import {
  sendRuntimeMessage,
  sendRuntimeMessageWithRetry,
} from "@/src/runtime/send-runtime-message"
import type { PendingUndoReceipt } from "@/src/domain/queue/state"

export type CancelQueueTaskResult =
  { kind: "active" } | { kind: "queued"; undo: PendingUndoReceipt }

function assertSuccess(response: { success: boolean; error?: string }): void {
  if (!response.success) {
    throw new Error(response.error ?? "Queue command failed")
  }
}

type RetainedQueueAction =
  | {
      type: "RETRY_FAILED_CHAPTERS" | "RESTART_TASK"
      payload: { taskId: string }
    }
  | { type: "UNDO_QUEUE_ACTION"; payload: { token: string } }

async function sendRetainedQueueAction(
  action: RetainedQueueAction
): Promise<void> {
  const subject =
    "taskId" in action.payload ? action.payload.taskId : action.payload.token
  assertSuccess(
    await sendRuntimeMessageWithRetry(
      { target: "background", ...createCommandEnvelope(), ...action },
      { retentionKey: `${action.type}:${subject}` }
    )
  )
}

export const queueCommandClient = {
  async cancelTask(taskId: string): Promise<CancelQueueTaskResult> {
    const response = await sendRuntimeMessageWithRetry(
      {
        target: "background",
        type: "CANCEL_TASK",
        ...createCommandEnvelope(),
        payload: { taskId },
      },
      { retentionKey: `CANCEL_TASK:${taskId}` }
    )
    assertSuccess(response)
    return "data" in response
      ? { kind: "queued", undo: response.data.undo }
      : { kind: "active" }
  },

  async retryFailedChapters(taskId: string): Promise<void> {
    await sendRetainedQueueAction({
      type: "RETRY_FAILED_CHAPTERS",
      payload: { taskId },
    })
  },

  async restartTask(taskId: string): Promise<void> {
    await sendRetainedQueueAction({ type: "RESTART_TASK", payload: { taskId } })
  },

  async moveTaskToTop(taskId: string): Promise<void> {
    assertSuccess(
      await sendRuntimeMessage({
        target: "background",
        type: "MOVE_TASK_TO_TOP",
        ...createCommandEnvelope(),
        payload: { taskId },
      })
    )
  },

  async removeTask(taskId: string): Promise<PendingUndoReceipt | undefined> {
    const response = await sendRuntimeMessageWithRetry(
      {
        target: "background",
        type: "REMOVE_TASK",
        ...createCommandEnvelope(),
        payload: { taskId },
      },
      { retentionKey: `REMOVE_TASK:${taskId}` }
    )
    assertSuccess(response)
    return "data" in response ? response.data.undo : undefined
  },

  async undoQueueAction(token: string): Promise<void> {
    await sendRetainedQueueAction({
      type: "UNDO_QUEUE_ACTION",
      payload: { token },
    })
  },

  async clearTerminalHistory(): Promise<void> {
    assertSuccess(
      await sendRuntimeMessage({
        target: "background",
        type: "CLEAR_ALL_HISTORY",
        ...createCommandEnvelope(),
        payload: {},
      })
    )
  },
}
