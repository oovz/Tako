import { useCallback, useEffect, useRef, useState } from "react"

import { toast } from "sonner"

import logger from "@/src/runtime/logger"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { OptionsDownloadState } from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import { t } from "@/src/runtime/i18n"
import { queueCommandClient } from "@/src/ui/shared/queue-command-client"
import type { PendingUndoReceipt } from "@/src/domain/queue/state"
import { isPendingUndoReceipt } from "@/src/domain/queue/pending-undo"
import type { StorageReadStatus } from "@/src/ui/shared/hooks/useChromeStorageValue"
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

const EMPTY_DOWNLOAD_STATE: OptionsDownloadState = {
  tasks: [],
  queueStorageBytes: 0,
}

export function useDownloadsTabState() {
  const [downloadState, setDownloadState] =
    useState<OptionsDownloadState>(EMPTY_DOWNLOAD_STATE)
  const [readStatus, setReadStatus] = useState<StorageReadStatus>("loading")
  const [readAttempt, setReadAttempt] = useState(0)
  const hasSnapshot = useRef(false)
  const latestRequestId = useRef(0)

  const refreshDownloadState = useCallback(async (): Promise<void> => {
    const requestId = ++latestRequestId.current
    if (!hasSnapshot.current) setReadStatus("loading")
    try {
      const response = await sendRuntimeMessage({
        target: "background",
        type: "GET_OPTIONS_DOWNLOAD_STATE",
      })
      if (!response.success) throw new Error(response.error)
      if (requestId !== latestRequestId.current) return
      setDownloadState(response.data)
      hasSnapshot.current = true
      setReadStatus("ready")
    } catch (error) {
      if (requestId === latestRequestId.current) {
        logger.error("[DOWNLOADS TAB] Failed to refresh download state:", error)
        setReadStatus(hasSnapshot.current ? "stale" : "error")
      }
    }
  }, [])

  useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ): void => {
      if (
        areaName !== "local" ||
        ![LOCAL_STORAGE_KEYS.downloadQueue].some((key) => key in changes)
      ) {
        return
      }
      void refreshDownloadState()
    }

    let disposed = false
    let subscribed = false
    queueMicrotask(() => {
      if (disposed) return
      try {
        chrome.storage.onChanged.addListener(handleStorageChange)
        subscribed = true
      } catch (error) {
        logger.error(
          "[DOWNLOADS TAB] Failed to subscribe to download state:",
          error
        )
        setReadStatus(hasSnapshot.current ? "stale" : "error")
        return
      }
      void refreshDownloadState()
    })
    return () => {
      disposed = true
      latestRequestId.current += 1
      if (subscribed)
        chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [refreshDownloadState, readAttempt])

  const cancelTask = useCallback(
    async (taskId: string): Promise<DownloadTaskActionResult> => {
      try {
        const result = await queueCommandClient.cancelTask(taskId)
        if (result.kind === "queued") {
          showOptionsUndoToast(result.undo, () => {
            void refreshDownloadState()
          })
        }
        void refreshDownloadState()
        return {
          success: true as const,
          undo: result.kind === "queued" ? result.undo : undefined,
        }
      } catch (error) {
        logger.error("[DOWNLOADS TAB] Failed to cancel task:", error)
        toast.error(t("options_toastCancelFailed"))
        return {
          success: false as const,
          error: t("options_toastCancelFailed"),
        }
      }
    },
    [refreshDownloadState]
  )

  const retryTask = useCallback(
    async (taskId: string) => {
      try {
        await queueCommandClient.retryFailedChapters(taskId)
        void refreshDownloadState()
      } catch (error) {
        logger.error("[DOWNLOADS TAB] Failed to retry task:", error)
        toast.error(t("options_toastRetryFailed"))
      }
    },
    [refreshDownloadState]
  )

  const restartTask = useCallback(
    async (taskId: string) => {
      try {
        await queueCommandClient.restartTask(taskId)
        void refreshDownloadState()
      } catch (error) {
        logger.error("[DOWNLOADS TAB] Failed to restart task:", error)
        toast.error(t("options_toastRestartFailed"))
      }
    },
    [refreshDownloadState]
  )

  const removeTask = useCallback(
    async (taskId: string) => {
      try {
        const receipt = await queueCommandClient.removeTask(taskId)
        if (isPendingUndoReceipt(receipt)) {
          showOptionsUndoToast(receipt, () => {
            void refreshDownloadState()
          })
        }
        void refreshDownloadState()
      } catch (error) {
        logger.error("[DOWNLOADS TAB] Failed to remove task:", error)
        toast.error(t("options_toastRemoveFailed"))
      }
    },
    [refreshDownloadState]
  )

  const clearTaskHistory = useCallback(async (): Promise<boolean> => {
    try {
      await queueCommandClient.clearTerminalHistory()
      toast.success(t("options_toastTaskHistoryCleared"))
      void refreshDownloadState()
      return true
    } catch (error) {
      logger.error("[DOWNLOADS TAB] Failed to clear task history:", error)
      toast.error(t("options_toastClearTaskHistoryFailed"))
      return false
    }
  }, [refreshDownloadState])

  return {
    tasks: downloadState.tasks,
    isLoading: readStatus === "loading",
    readStatus,
    retryRead: () => setReadAttempt((attempt) => attempt + 1),
    historyStorageBytes: downloadState.queueStorageBytes,
    cancelTask,
    retryTask,
    restartTask,
    removeTask,
    clearTaskHistory,
  }
}
