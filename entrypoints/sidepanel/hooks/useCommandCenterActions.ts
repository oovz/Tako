import { useCallback } from "react"
import { useQueueUndo } from "../components/QueueUndo"
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
  const showUndo = useQueueUndo()
  const cancelWithUndo = useCallback(
    (taskId: string) => cancelCommandCenterTask(taskId, showUndo),
    [showUndo]
  )
  const removeWithUndo = useCallback(
    (taskId: string) => removeCommandCenterTask(taskId, showUndo),
    [showUndo]
  )
  const cancel = usePendingTaskAction(cancelWithUndo, CANCEL_ALREADY_PENDING)
  const retry = usePendingTaskAction(retryCommandCenterTask, undefined)
  const restart = usePendingTaskAction(restartCommandCenterTask, undefined)
  const remove = usePendingTaskAction(removeWithUndo, undefined)
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
