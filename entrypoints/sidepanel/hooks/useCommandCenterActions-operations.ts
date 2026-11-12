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
): (taskId: string) => Promise<string | null> {
  return async (taskId) => {
    try {
      await command(taskId)
      return null
    } catch (error) {
      logger.error(`[CommandCenter] Failed to ${label}:`, error)
      return t(failureKey)
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
): Promise<string | null> {
  try {
    const undo = await queueCommandClient.removeTask(taskId)
    if (undo) onUndo?.(undo, taskId)
    return null
  } catch (error) {
    logger.error("[CommandCenter] Failed to remove task:", error)
    return t("sidepanel_toastRemoveFailed")
  }
}

export async function openCommandCenterSettings(): Promise<boolean> {
  try {
    await openOptionsPage()
    return true
  } catch (error) {
    logger.error("[CommandCenter] Failed to open Options page:", error)
    return false
  }
}

export async function openCommandCenterHistory(): Promise<boolean> {
  try {
    await openOptionsPage("activity")
    return true
  } catch (error) {
    logger.error("[CommandCenter] Failed to open full history:", error)
    return false
  }
}
