import { useCallback } from "react"
import { toast } from "sonner"
import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import { queueCommandClient } from "@/src/ui/shared/queue-command-client"
import type { PendingUndoReceipt } from "@/src/domain/queue/state"
import { isPendingUndoReceipt } from "@/src/domain/queue/pending-undo"
import type { DownloadTaskActionResult } from "@/entrypoints/options/types/download-task-actions"

function showOptionsUndoToast(
  receipt: PendingUndoReceipt,
  refresh: () => void
): void {
  toast(
    receipt.type === "cancel_queued"
      ? t("sidepanel_taskRemovedFromQueue")
      : t("sidepanel_historyRemoved"),
    {
      duration: Math.max(1, receipt.expiresAt - Date.now()),
      action: {
        label: t("common_undo"),
        onClick: () => {
          void queueCommandClient
            .undoQueueAction(receipt.token)
            .then(refresh)
            .catch((error) => {
              logger.error("[DOWNLOADS TAB] Failed to undo task action:", error)
              toast.error(t("sidepanel_undoFailed"))
            })
        },
      },
    }
  )
}

async function cancelOptionsTask(
  taskId: string,
  refresh: () => Promise<void>
): Promise<DownloadTaskActionResult> {
  try {
    const result = await queueCommandClient.cancelTask(taskId)
    if (result.kind === "queued")
      showOptionsUndoToast(result.undo, () => {
        void refresh()
      })
    void refresh()
    return {
      success: true,
      undo: result.kind === "queued" ? result.undo : undefined,
    }
  } catch (error) {
    logger.error("[DOWNLOADS TAB] Failed to cancel task:", error)
    toast.error(t("options_toastCancelFailed"))
    return { success: false, error: t("options_toastCancelFailed") }
  }
}

async function retryOptionsTask(
  taskId: string,
  refresh: () => Promise<void>
): Promise<void> {
  try {
    await queueCommandClient.retryFailedChapters(taskId)
    void refresh()
  } catch (error) {
    logger.error("[DOWNLOADS TAB] Failed to retry task:", error)
    toast.error(t("options_toastRetryFailed"))
  }
}

async function restartOptionsTask(
  taskId: string,
  refresh: () => Promise<void>
): Promise<void> {
  try {
    await queueCommandClient.restartTask(taskId)
    void refresh()
  } catch (error) {
    logger.error("[DOWNLOADS TAB] Failed to restart task:", error)
    toast.error(t("options_toastRestartFailed"))
  }
}

async function removeOptionsTask(
  taskId: string,
  refresh: () => Promise<void>
): Promise<void> {
  try {
    const receipt = await queueCommandClient.removeTask(taskId)
    if (isPendingUndoReceipt(receipt))
      showOptionsUndoToast(receipt, () => {
        void refresh()
      })
    void refresh()
  } catch (error) {
    logger.error("[DOWNLOADS TAB] Failed to remove task:", error)
    toast.error(t("options_toastRemoveFailed"))
  }
}

async function clearOptionsTaskHistory(
  refresh: () => Promise<void>
): Promise<boolean> {
  try {
    await queueCommandClient.clearTerminalHistory()
    toast.success(t("options_toastTaskHistoryCleared"))
    void refresh()
    return true
  } catch (error) {
    logger.error("[DOWNLOADS TAB] Failed to clear task history:", error)
    toast.error(t("options_toastClearTaskHistoryFailed"))
    return false
  }
}

export function useOptionsDownloadActions(refresh: () => Promise<void>) {
  const cancelTask = useCallback(
    (taskId: string) => cancelOptionsTask(taskId, refresh),
    [refresh]
  )
  const retryTask = useCallback(
    (taskId: string) => retryOptionsTask(taskId, refresh),
    [refresh]
  )
  const restartTask = useCallback(
    (taskId: string) => restartOptionsTask(taskId, refresh),
    [refresh]
  )
  const removeTask = useCallback(
    (taskId: string) => removeOptionsTask(taskId, refresh),
    [refresh]
  )
  const clearTaskHistory = useCallback(
    () => clearOptionsTaskHistory(refresh),
    [refresh]
  )
  return { cancelTask, retryTask, restartTask, removeTask, clearTaskHistory }
}
