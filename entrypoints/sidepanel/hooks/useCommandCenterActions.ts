import type { CancelTaskResult } from "@/entrypoints/sidepanel/types"
import { usePendingTaskAction } from "./useCommandCenterActions-pending"
import {
  cancelCommandCenterTask,
  retryCommandCenterTask,
  restartCommandCenterTask,
  removeCommandCenterTask,
  moveCommandCenterTaskToTop,
  openCommandCenterSettings,
  openCommandCenterHistory,
} from "./useCommandCenterActions-operations"

const CANCEL_ALREADY_PENDING: CancelTaskResult = { kind: "already-pending" }

export function useCommandCenterActions() {
  const cancel = usePendingTaskAction(
    cancelCommandCenterTask,
    CANCEL_ALREADY_PENDING
  )
  const retry = usePendingTaskAction(retryCommandCenterTask, undefined)
  const restart = usePendingTaskAction(restartCommandCenterTask, undefined)
  const remove = usePendingTaskAction(removeCommandCenterTask, undefined)
  const move = usePendingTaskAction(moveCommandCenterTaskToTop, undefined)

  return {
    cancelingTaskIds: cancel.pendingTaskIds,
    retryingTaskIds: retry.pendingTaskIds,
    restartingTaskIds: restart.pendingTaskIds,
    removingTaskIds: remove.pendingTaskIds,
    movingTaskIds: move.pendingTaskIds,
    handleCancelTask: cancel.run,
    handleRetryFailed: retry.run,
    handleRemoveTask: remove.run,
    handleRestartTask: restart.run,
    handleMoveTaskToTop: move.run,
    openSettings: openCommandCenterSettings,
    openFullHistory: openCommandCenterHistory,
  }
}
