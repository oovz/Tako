import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"

import { toast } from "sonner"

import logger from "@/src/runtime/logger"
import { openOptionsPage } from "@/src/runtime/open-options"
import { t } from "@/src/runtime/i18n"
import { createPendingActionGuard } from "@/entrypoints/sidepanel/hooks/pending-action-guard"
import type { PendingUndoReceipt } from "@/src/domain/queue/state"
import type { CancelTaskResult } from "@/entrypoints/sidepanel/types"
import { queueCommandClient } from "@/src/ui/shared/queue-command-client"

function showUndoToast(receipt: PendingUndoReceipt): void {
  toast(
    receipt.type === "cancel_queued"
      ? t("sidepanel_taskRemovedFromQueue")
      : t("sidepanel_historyRemoved"),
    {
      duration: Math.max(1, receipt.expiresAt - Date.now()),
      action: {
        label: t("common_undo"),
        onClick: () => {
          void (async () => {
            await queueCommandClient.undoQueueAction(receipt.token)
          })().catch((error) => {
            logger.error("[CommandCenter] Failed to undo task action:", error)
            toast.error(t("sidepanel_undoFailed"))
          })
        },
      },
    }
  )
}

function addPendingTaskId(
  setPendingTaskIds: Dispatch<SetStateAction<Set<string>>>,
  taskId: string
): void {
  setPendingTaskIds((previousIds) => {
    if (previousIds.has(taskId)) return previousIds
    const nextIds = new Set(previousIds)
    nextIds.add(taskId)
    return nextIds
  })
}

function removePendingTaskId(
  setPendingTaskIds: Dispatch<SetStateAction<Set<string>>>,
  taskId: string
): void {
  setPendingTaskIds((previousIds) => {
    if (!previousIds.has(taskId)) return previousIds
    const nextIds = new Set(previousIds)
    nextIds.delete(taskId)
    return nextIds
  })
}

export function useCommandCenterActions() {
  const [cancelingTaskIds, setCancelingTaskIds] = useState<Set<string>>(
    new Set()
  )
  const [forgettingTaskIds, setForgettingTaskIds] = useState<Set<string>>(
    new Set()
  )
  const [retryingTaskIds, setRetryingTaskIds] = useState<Set<string>>(new Set())
  const [restartingTaskIds, setRestartingTaskIds] = useState<Set<string>>(
    new Set()
  )
  const [removingTaskIds, setRemovingTaskIds] = useState<Set<string>>(new Set())
  const [movingTaskIds, setMovingTaskIds] = useState<Set<string>>(new Set())
  const pendingGuardRef = useRef(createPendingActionGuard())

  const handleCancelTask = useCallback(
    async (taskId: string): Promise<CancelTaskResult> => {
      const pendingKey = `cancel:${taskId}`
      if (!pendingGuardRef.current.tryBegin(pendingKey)) {
        return { kind: "already-pending" }
      }

      addPendingTaskId(setCancelingTaskIds, taskId)

      try {
        const result = await queueCommandClient.cancelTask(taskId)
        if (result.kind === "queued") {
          showUndoToast(result.undo)
        }
        return { kind: "completed" }
      } catch (error) {
        logger.error("[CommandCenter] Failed to cancel task:", error)
        return { kind: "failed", message: t("sidepanel_toastCancelFailed") }
      } finally {
        pendingGuardRef.current.finish(pendingKey)
        removePendingTaskId(setCancelingTaskIds, taskId)
      }
    },
    []
  )

  const handleForgetTask = useCallback(async (taskId: string) => {
    const pendingKey = `forget:${taskId}`
    if (!pendingGuardRef.current.tryBegin(pendingKey)) return
    addPendingTaskId(setForgettingTaskIds, taskId)

    try {
      const result = await queueCommandClient.forgetUnobservableOutputs(taskId)
      toast.success(t("sidepanel_forgetSucceeded", String(result.surrendered)))
    } catch (error) {
      logger.error(
        "[CommandCenter] Failed to forget unobservable outputs:",
        error
      )
      toast.error(t("sidepanel_toastForgetFailed"))
    } finally {
      pendingGuardRef.current.finish(pendingKey)
      removePendingTaskId(setForgettingTaskIds, taskId)
    }
  }, [])

  const handleRetryFailed = useCallback(async (taskId: string) => {
    const pendingKey = `retry:${taskId}`
    if (!pendingGuardRef.current.tryBegin(pendingKey)) return
    addPendingTaskId(setRetryingTaskIds, taskId)

    try {
      await queueCommandClient.retryFailedChapters(taskId)
    } catch (error) {
      logger.error("[CommandCenter] Failed to retry failed chapters:", error)
      toast.error(t("sidepanel_toastRetryFailed"))
    } finally {
      pendingGuardRef.current.finish(pendingKey)
      removePendingTaskId(setRetryingTaskIds, taskId)
    }
  }, [])

  const handleRemoveTask = useCallback(async (taskId: string) => {
    const pendingKey = `remove:${taskId}`
    if (!pendingGuardRef.current.tryBegin(pendingKey)) return
    addPendingTaskId(setRemovingTaskIds, taskId)

    try {
      showUndoToast(await queueCommandClient.removeTask(taskId))
    } catch (error) {
      logger.error("[CommandCenter] Failed to remove task:", error)
      toast.error(t("sidepanel_toastRemoveFailed"))
    } finally {
      pendingGuardRef.current.finish(pendingKey)
      removePendingTaskId(setRemovingTaskIds, taskId)
    }
  }, [])

  const handleRestartTask = useCallback(async (taskId: string) => {
    const pendingKey = `restart:${taskId}`
    if (!pendingGuardRef.current.tryBegin(pendingKey)) return
    addPendingTaskId(setRestartingTaskIds, taskId)

    try {
      await queueCommandClient.restartTask(taskId)
    } catch (error) {
      logger.error("[CommandCenter] Failed to restart task:", error)
      toast.error(t("sidepanel_toastRestartFailed"))
    } finally {
      pendingGuardRef.current.finish(pendingKey)
      removePendingTaskId(setRestartingTaskIds, taskId)
    }
  }, [])

  const handleMoveTaskToTop = useCallback(async (taskId: string) => {
    const pendingKey = `move-to-top:${taskId}`
    if (!pendingGuardRef.current.tryBegin(pendingKey)) return
    addPendingTaskId(setMovingTaskIds, taskId)

    try {
      await queueCommandClient.moveTaskToTop(taskId)
    } catch (error) {
      logger.error("[CommandCenter] Failed to move task to top:", error)
      toast.error(t("sidepanel_toastMoveTopFailed"))
    } finally {
      pendingGuardRef.current.finish(pendingKey)
      removePendingTaskId(setMovingTaskIds, taskId)
    }
  }, [])

  const openSettings = useCallback(async () => {
    try {
      await openOptionsPage()
    } catch (error) {
      logger.error("[CommandCenter] Failed to open Options page:", error)
    }
  }, [])

  const openFullHistory = useCallback(async () => {
    try {
      await openOptionsPage("downloads")
    } catch (error) {
      logger.error("[CommandCenter] Failed to open full history:", error)
    }
  }, [])

  return {
    cancelingTaskIds,
    forgettingTaskIds,
    retryingTaskIds,
    restartingTaskIds,
    removingTaskIds,
    movingTaskIds,
    handleCancelTask,
    handleForgetTask,
    handleRetryFailed,
    handleRemoveTask,
    handleRestartTask,
    handleMoveTaskToTop,
    openSettings,
    openFullHistory,
  }
}
