import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
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
    const response = await sendRuntimeMessage({
      target: "background",
      type: "CANCEL_TASK",
      ...createCommandEnvelope(),
      payload: { taskId },
    })
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
      await sendRuntimeMessage({
        target: "background",
        type: "RETRY_FAILED_CHAPTERS",
        ...createCommandEnvelope(),
        payload: { taskId },
      })
    )
  },

  async restartTask(taskId: string): Promise<void> {
    assertSuccess(
      await sendRuntimeMessage({
        target: "background",
        type: "RESTART_TASK",
        ...createCommandEnvelope(),
        payload: { taskId },
      })
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

  async removeTask(taskId: string): Promise<PendingUndoReceipt> {
    const response = await sendRuntimeMessage({
      target: "background",
      type: "REMOVE_TASK",
      ...createCommandEnvelope(),
      payload: { taskId },
    })
    assertSuccess(response)
    if (!("data" in response)) {
      throw new Error("Remove task response is missing its Undo receipt")
    }
    return response.data.undo
  },

  async undoQueueAction(token: string): Promise<void> {
    assertSuccess(
      await sendRuntimeMessage({
        target: "background",
        type: "UNDO_QUEUE_ACTION",
        ...createCommandEnvelope(),
        payload: { token },
      })
    )
  },

  async retryDestination(taskId: string): Promise<void> {
    assertSuccess(
      await sendRuntimeMessage({
        target: "background",
        type: "RETRY_DESTINATION",
        ...createCommandEnvelope(),
        payload: { taskId },
      })
    )
  },

  async continueDownload(taskId: string): Promise<void> {
    assertSuccess(
      await sendRuntimeMessage({
        target: "background",
        type: "CONTINUE_DOWNLOAD",
        ...createCommandEnvelope(),
        payload: { taskId },
      })
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
