import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import { StateAction } from "@/src/types/state-actions"
import type {
  StateActionMessage,
  StateActionResponse,
} from "@/src/types/state-action-message"
import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import { getPendingUndoReceipt } from "@/src/runtime/state-actions"
import type { PendingUndoReceipt } from "@/src/types/queue-state"

export type DownloadTaskActionResult =
  | { success: true; undo?: PendingUndoReceipt }
  | { success: false; error: string }

export async function requestDownloadTaskCancellation(
  taskId: string
): Promise<DownloadTaskActionResult> {
  try {
    const response = await chrome.runtime.sendMessage<
      StateActionMessage,
      StateActionResponse
    >({
      type: "STATE_ACTION",
      ...createCommandEnvelope(),
      action: StateAction.CANCEL_DOWNLOAD_TASK,
      payload: { taskId },
    })

    if (response?.success) {
      return {
        success: true,
        undo: getPendingUndoReceipt(response) ?? undefined,
      }
    }

    return {
      success: false,
      error: t("options_toastCancelFailed"),
    }
  } catch (error) {
    logger.error("[DOWNLOADS TAB] Failed to cancel task:", error)
    return {
      success: false,
      error: t("options_toastCancelFailed"),
    }
  }
}
