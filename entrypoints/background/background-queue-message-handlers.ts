import { DownloadTaskStateSchema } from "@/src/runtime/queue-state-schemas"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import { StartDownloadRejectedError } from "@/src/runtime/start-download-errors"

type QueueMessageType =
  | "START_DOWNLOAD"
  | "RETRY_FAILED_CHAPTERS"
  | "RESTART_TASK"
  | "MOVE_TASK_TO_TOP"
  | "GET_SIDEPANEL_TASK"
  | "REORDER_QUEUED_TASKS"
  | "RENEW_QUEUE_UNDO"
  | "CLEAR_ALL_HISTORY"
  | "REMOVE_TASK"
  | "CANCEL_TASK"
  | "UNDO_QUEUE_ACTION"

export function createBackgroundQueueMessageHandlers(
  deps: BackgroundRuntimeHandlerDependencies
): Pick<RuntimeMessageHandlerMap<"background">, QueueMessageType> {
  return {
    START_DOWNLOAD: (message) => handleStartDownload(deps, message),
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
    GET_SIDEPANEL_TASK: async (message) => {
      const task = await deps.queueRepository.getTask(message.payload.taskId)
      return {
        success: true,
        task: task ? DownloadTaskStateSchema.parse(task) : null,
      }
    },
    REORDER_QUEUED_TASKS: async (message) => {
      await deps.queueApplicationCommands.reorderQueuedTasks(message.payload)
      return { success: true }
    },
    RENEW_QUEUE_UNDO: async (message) => ({
      success: true,
      undo: await deps.queueApplicationCommands.renewQueueUndo(
        message.payload.token
      ),
    }),
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
        message.payload.taskId,
        message.commandId
      )
      return undo === undefined
        ? { success: true }
        : { success: true, data: { undo } }
    },
    CANCEL_TASK: async (message) => {
      const result = await deps.queueApplicationCommands.cancelTask(
        message.payload.taskId,
        message.commandId
      )
      return result.kind === "queued"
        ? { success: true, data: { undo: result.undo } }
        : { success: true }
    },

    UNDO_QUEUE_ACTION: async (message) => {
      await deps.queueApplicationCommands.undoQueueAction(message.payload.token)
      return { success: true }
    },
  }
}

async function handleStartDownload(
  deps: BackgroundRuntimeHandlerDependencies,
  message: RuntimeMessageRequest<"START_DOWNLOAD">
): Promise<RuntimeMessageResponse<"START_DOWNLOAD">> {
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
}
