import { useCallback, useRef, useState } from "react"
import { useQueueUndo } from "../components/QueueUndo"
import { usePanelFeedback } from "../components/PanelFeedback"
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

type TaskCommand = (taskId: string) => Promise<string | null>
type RunTaskCommand = (taskId: string, command: TaskCommand) => Promise<void>

function useReportedTaskAction(command: TaskCommand, run: RunTaskCommand) {
  const operation = useCallback(
    (taskId: string) => run(taskId, command),
    [command, run]
  )
  return usePendingTaskAction(operation, undefined)
}

export function useCommandCenterActions() {
  const showUndo = useQueueUndo()
  const reportFeedback = usePanelFeedback()
  const [taskActionErrors, setTaskActionErrors] = useState<
    Readonly<Record<string, string>>
  >({})
  const activeCommands = useRef(new Map<string, object>())
  const runTaskCommand = useCallback<RunTaskCommand>(
    async (taskId, command) => {
      const owner = {}
      activeCommands.current.set(taskId, owner)
      setTaskActionErrors((previous) => {
        if (!Object.hasOwn(previous, taskId)) return previous
        const next = { ...previous }
        delete next[taskId]
        return next
      })
      try {
        const message = await command(taskId)
        if (message && activeCommands.current.get(taskId) === owner) {
          setTaskActionErrors((previous) => ({
            ...previous,
            [taskId]: message,
          }))
        }
      } finally {
        if (activeCommands.current.get(taskId) === owner)
          activeCommands.current.delete(taskId)
      }
    },
    []
  )
  const cancelWithUndo = useCallback(
    (taskId: string) => cancelCommandCenterTask(taskId, showUndo),
    [showUndo]
  )
  const removeWithUndo = useCallback(
    (taskId: string) => removeCommandCenterTask(taskId, showUndo),
    [showUndo]
  )
  const cancel = usePendingTaskAction(cancelWithUndo, CANCEL_ALREADY_PENDING)
  const retry = useReportedTaskAction(retryCommandCenterTask, runTaskCommand)
  const restart = useReportedTaskAction(
    restartCommandCenterTask,
    runTaskCommand
  )
  const remove = useReportedTaskAction(removeWithUndo, runTaskCommand)
  const move = useReportedTaskAction(moveCommandCenterTaskToTop, runTaskCommand)
  const openSettings = useCallback(async () => {
    if (!(await openCommandCenterSettings()))
      reportFeedback("settingsOpenFailed")
  }, [reportFeedback])
  const openFullHistory = useCallback(async () => {
    if (!(await openCommandCenterHistory())) reportFeedback("historyOpenFailed")
  }, [reportFeedback])

  return {
    taskActionErrors,
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
    openSettings,
    openFullHistory,
  }
}
