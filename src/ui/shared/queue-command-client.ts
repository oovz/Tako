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

  async forgetUnobservableOutputs(
    taskId: string
  ): Promise<{ surrendered: number }> {
    const response = await sendRuntimeMessage({
      target: "background",
      type: "FORGET_UNOBSERVABLE_OUTPUTS",
      ...createCommandEnvelope(),
      payload: { taskId },
    })
    if (!response.success) {
      throw new Error(response.error ?? "Queue command failed")
    }
    return { surrendered: response.surrendered }
  },

  async retryFailedChapters(taskId: string): Promise<void> {
    assertSuccess(
      await sendRuntimeMessageWithRetry(
        {
          target: "background",
          type: "RETRY_FAILED_CHAPTERS",
          ...createCommandEnvelope(),
          payload: { taskId },
        },
        { retentionKey: `RETRY_FAILED_CHAPTERS:${taskId}` }
      )
    )
  },

  async restartTask(taskId: string): Promise<void> {
    assertSuccess(
      await sendRuntimeMessageWithRetry(
        {
          target: "background",
          type: "RESTART_TASK",
          ...createCommandEnvelope(),
          payload: { taskId },
        },
        { retentionKey: `RESTART_TASK:${taskId}` }
      )
    )
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
    assertSuccess(
      await sendRuntimeMessageWithRetry(
        {
          target: "background",
          type: "UNDO_QUEUE_ACTION",
          ...createCommandEnvelope(),
          payload: { token },
        },
        { retentionKey: `UNDO_QUEUE_ACTION:${token}` }
      )
    )
  },

  async retryDestination(taskId: string): Promise<void> {
    assertSuccess(
      await sendRuntimeMessageWithRetry(
        {
          target: "background",
          type: "RETRY_DESTINATION",
          ...createCommandEnvelope(),
          payload: { taskId },
        },
        { retentionKey: `RETRY_DESTINATION:${taskId}` }
      )
    )
  },

  async continueDownload(taskId: string): Promise<void> {
    assertSuccess(
      await sendRuntimeMessageWithRetry(
        {
          target: "background",
          type: "CONTINUE_DOWNLOAD",
          ...createCommandEnvelope(),
          payload: { taskId },
        },
        { retentionKey: `CONTINUE_DOWNLOAD:${taskId}` }
      )
    )
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
