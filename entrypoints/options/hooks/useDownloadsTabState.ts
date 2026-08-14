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
  destinationIssue: null,
  queueStorageBytes: 0,
}

export function useDownloadsTabState() {
  const [downloadState, setDownloadState] =
    useState<OptionsDownloadState>(EMPTY_DOWNLOAD_STATE)
  const [isLoading, setIsLoading] = useState(true)
  const latestRequestId = useRef(0)

  const refreshDownloadState = useCallback(async (): Promise<void> => {
    const requestId = ++latestRequestId.current
    try {
      const response = await sendRuntimeMessage({
        target: "background",
        type: "GET_OPTIONS_DOWNLOAD_STATE",
      })
      if (!response.success) throw new Error(response.error)
      if (requestId !== latestRequestId.current) return
      setDownloadState(response.data)
    } catch (error) {
      if (requestId === latestRequestId.current) {
        logger.error("[DOWNLOADS TAB] Failed to refresh download state:", error)
      }
    } finally {
      if (requestId === latestRequestId.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void refreshDownloadState()
    })

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ): void => {
      if (
        areaName !== "local" ||
        ![
          LOCAL_STORAGE_KEYS.downloadQueue,
          LOCAL_STORAGE_KEYS.destinationIssues,
        ].some((key) => key in changes)
      ) {
        return
      }
      void refreshDownloadState()
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => {
      latestRequestId.current += 1
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [refreshDownloadState])

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

  const clearAllHistory = useCallback(async (): Promise<boolean> => {
    try {
      await queueCommandClient.clearTerminalHistory()
      void refreshDownloadState()
      return true
    } catch (error) {
      logger.error("[DOWNLOADS TAB] Failed to clear history:", error)
      toast.error(t("options_toastClearHistoryFailed"))
      return false
    }
  }, [refreshDownloadState])

  const sendDestinationTaskAction = useCallback(
    async (taskId: string, type: "RETRY_DESTINATION" | "CONTINUE_DOWNLOAD") => {
      try {
        if (type === "RETRY_DESTINATION") {
          await queueCommandClient.retryDestination(taskId)
        } else {
          await queueCommandClient.continueDownload(taskId)
        }
        void refreshDownloadState()
        return true
      } catch (error) {
        logger.error("[DOWNLOADS TAB] Destination task action failed:", error)
        toast.error(t("destinationIssue_actionFailed"))
        return false
      }
    },
    [refreshDownloadState]
  )

  return {
    tasks: downloadState.tasks,
    isLoading,
    destinationIssue: downloadState.destinationIssue,
    historyStorageBytes: downloadState.queueStorageBytes,
    cancelTask,
    retryTask,
    restartTask,
    removeTask,
    clearAllHistory,
    retryDestinationTask: (taskId: string) =>
      sendDestinationTaskAction(taskId, "RETRY_DESTINATION"),
    continueTaskInDownloads: (taskId: string) =>
      sendDestinationTaskAction(taskId, "CONTINUE_DOWNLOAD"),
  }
}
