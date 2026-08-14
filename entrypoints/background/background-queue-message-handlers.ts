import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"
import { StartDownloadRejectedError } from "@/src/runtime/start-download-errors"

type QueueMessageType =
  | "START_DOWNLOAD"
  | "RETRY_FAILED_CHAPTERS"
  | "RESTART_TASK"
  | "MOVE_TASK_TO_TOP"
  | "CLEAR_ALL_HISTORY"
  | "REMOVE_TASK"
  | "CANCEL_TASK"
  | "FORGET_UNOBSERVABLE_OUTPUTS"
  | "RETRY_DESTINATION"
  | "CONTINUE_DOWNLOAD"
  | "UNDO_QUEUE_ACTION"

export function createBackgroundQueueMessageHandlers(
  deps: BackgroundRuntimeHandlerDependencies
): Pick<RuntimeMessageHandlerMap<"background">, QueueMessageType> {
  return {
    START_DOWNLOAD: async (message) => {
      try {
        const result = await deps.queueApplicationCommands.startDownload(
          message.payload,
          message.commandId
        )
        return { success: true, taskId: result.taskId }
      } catch (error) {
        if (error instanceof StartDownloadRejectedError) {
          return { success: false, error: error.message, code: error.code }
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          code: "durable_state_failure",
        }
      }
    },
    RETRY_FAILED_CHAPTERS: async (message) => {
      await deps.queueApplicationCommands.retryFailedChapters(
        message.payload.taskId,
        message.commandId
      )
      return { success: true }
    },
    RESTART_TASK: async (message) => {
      await deps.queueApplicationCommands.restartTask(
        message.payload.taskId,
        message.commandId
      )
      return { success: true }
    },
    MOVE_TASK_TO_TOP: async (message) => {
      await deps.queueApplicationCommands.moveTaskToTop(message.payload.taskId)
      return { success: true }
    },
    CLEAR_ALL_HISTORY: async () => {
      await deps.queueApplicationCommands.clearTerminalHistory()
      return { success: true }
    },
    REMOVE_TASK: async (message) => {
      const undo = await deps.queueApplicationCommands.removeTask(
        message.payload.taskId
      )
      return { success: true, data: { undo } }
    },
    CANCEL_TASK: async (message) => {
      const result = await deps.queueApplicationCommands.cancelTask(
        message.payload.taskId
      )
      return result.kind === "queued"
        ? { success: true, data: { undo: result.undo } }
        : { success: true }
    },
    FORGET_UNOBSERVABLE_OUTPUTS: async (message) => {
      const result =
        await deps.queueApplicationCommands.forgetUnobservableOutputs(
          message.payload.taskId
        )
      return { success: true, surrendered: result.surrendered }
    },
    RETRY_DESTINATION: async (message) => {
      await deps.queueApplicationCommands.retryDestination(
        message.payload.taskId
      )
      return { success: true }
    },
    CONTINUE_DOWNLOAD: async (message) => {
      await deps.queueApplicationCommands.continueDownload(
        message.payload.taskId
      )
      return { success: true }
    },
    UNDO_QUEUE_ACTION: async (message) => {
      await deps.queueApplicationCommands.undoQueueAction(message.payload.token)
      return { success: true }
    },
  }
}
