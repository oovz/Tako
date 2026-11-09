import { toast } from "sonner"
import logger from "@/src/runtime/logger"
import { openOptionsPage } from "@/src/runtime/open-options"
import { t } from "@/src/runtime/i18n"
import type { PendingUndoReceipt } from "@/src/domain/queue/state"
import type { CancelTaskResult } from "@/entrypoints/sidepanel/types"
import { queueCommandClient } from "@/src/ui/shared/queue-command-client"

export async function cancelCommandCenterTask(
  taskId: string,
  onUndo?: (receipt: PendingUndoReceipt, taskId: string) => void
): Promise<CancelTaskResult> {
  try {
    const result = await queueCommandClient.cancelTask(taskId)
    if (result.kind === "queued") onUndo?.(result.undo, taskId)
    return { kind: "completed" }
  } catch (error) {
    logger.error("[CommandCenter] Failed to cancel task:", error)
    return { kind: "failed", message: t("sidepanel_toastCancelFailed") }
  }
}

function taskCommand(
  command: (taskId: string) => Promise<unknown>,
  label: string,
  failureKey: string
): (taskId: string) => Promise<void> {
  return async (taskId) => {
    try {
      await command(taskId)
    } catch (error) {
      logger.error(`[CommandCenter] Failed to ${label}:`, error)
      toast.error(t(failureKey))
    }
  }
}

export const retryCommandCenterTask = taskCommand(
  queueCommandClient.retryFailedChapters.bind(queueCommandClient),
  "retry failed chapters",
  "sidepanel_toastRetryFailed"
)

export const restartCommandCenterTask = taskCommand(
  queueCommandClient.restartTask.bind(queueCommandClient),
  "restart task",
  "sidepanel_toastRestartFailed"
)

export const moveCommandCenterTaskToTop = taskCommand(
  queueCommandClient.moveTaskToTop.bind(queueCommandClient),
  "move task to top",
  "sidepanel_toastMoveTopFailed"
)

export async function removeCommandCenterTask(
  taskId: string,
  onUndo?: (receipt: PendingUndoReceipt, taskId: string) => void
): Promise<void> {
  try {
    const undo = await queueCommandClient.removeTask(taskId)
    if (undo) onUndo?.(undo, taskId)
  } catch (error) {
    logger.error("[CommandCenter] Failed to remove task:", error)
    toast.error(t("sidepanel_toastRemoveFailed"))
  }
}

export async function openCommandCenterSettings(): Promise<void> {
  try {
    await openOptionsPage()
  } catch (error) {
    logger.error("[CommandCenter] Failed to open Options page:", error)
  }
}

export async function openCommandCenterHistory(): Promise<void> {
  try {
    await openOptionsPage("activity")
  } catch (error) {
    logger.error("[CommandCenter] Failed to open full history:", error)
  }
}
