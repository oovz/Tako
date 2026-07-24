import { useCallback, useEffect, useState } from "react"

import { toast } from "sonner"

import logger from "@/src/runtime/logger"
import { normalizePersistedDownloadTask } from "@/src/runtime/persisted-download-task"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { DownloadTaskState } from "@/src/types/queue-state"
import { StateAction } from "@/src/types/state-actions"
import type {
  RestartTaskMessage,
  RestartTaskResponse,
  RetryFailedChaptersMessage,
  RetryFailedChaptersResponse,
} from "@/src/types/runtime-command-messages"
import type {
  StateActionMessage,
  StateActionResponse,
} from "@/src/types/state-action-message"
import { useChromeStorageValue } from "@/src/ui/shared/hooks/useChromeStorageValue"
import { t } from "@/src/runtime/i18n"
import { requestDownloadTaskCancellation } from "@/entrypoints/options/download-task-actions"
import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import { normalizeDestinationIssues } from "@/src/runtime/destination-issue-state"
import type { DestinationIssue } from "@/src/types/queue-state"
import type { PendingUndoReceipt } from "@/src/types/queue-state"
import {
  getPendingUndoReceipt,
  undoPendingAction,
} from "@/src/runtime/state-actions"

function showOptionsUndoToast(receipt: PendingUndoReceipt): void {
  toast(
    receipt.type === "cancel_queued"
      ? t("sidepanel_taskRemovedFromQueue")
      : t("sidepanel_historyRemoved"),
    {
      duration: Math.max(1, receipt.expiresAt - Date.now()),
      action: {
        label: t("common_undo"),
        onClick: () => {
          void undoPendingAction(receipt.token).catch((error) => {
            logger.error("[DOWNLOADS TAB] Failed to undo task action:", error)
            toast.error(t("sidepanel_undoFailed"))
          })
        },
      },
    }
  )
}

export function normalizeDownloadQueueState(raw: unknown): DownloadTaskState[] {
  return Array.isArray(raw)
    ? raw
        .map(normalizePersistedDownloadTask)
        .filter((task): task is DownloadTaskState => task !== null)
    : []
}

async function readHistoryStorageBytes(): Promise<number> {
  return chrome.storage.local.getBytesInUse(LOCAL_STORAGE_KEYS.downloadQueue)
}

export function useDownloadsTabState() {
  const [historyStorageBytes, setHistoryStorageBytes] = useState(0)
  const { value: tasks, hydrated: tasksHydrated } = useChromeStorageValue<
    DownloadTaskState[]
  >({
    areaName: "local",
    key: LOCAL_STORAGE_KEYS.downloadQueue,
    initialValue: [],
    parse: normalizeDownloadQueueState,
  })
  const { value: destinationIssues, hydrated: destinationIssuesHydrated } =
    useChromeStorageValue<DestinationIssue[]>({
      areaName: "local",
      key: LOCAL_STORAGE_KEYS.destinationIssues,
      initialValue: [],
      parse: normalizeDestinationIssues,
    })

  useEffect(() => {
    if (!tasksHydrated) {
      return
    }

    let canceled = false
    void readHistoryStorageBytes()
      .then((bytes) => {
        if (!canceled) {
          setHistoryStorageBytes(bytes)
        }
      })
      .catch((error) => {
        logger.debug(
          "[DOWNLOADS TAB] Failed to refresh history storage usage (non-fatal):",
          error
        )
      })

    return () => {
      canceled = true
    }
  }, [tasks, tasksHydrated])

  const isLoading = !tasksHydrated || !destinationIssuesHydrated
  const destinationIssue = destinationIssues[0] ?? null

  const cancelTask = useCallback(async (taskId: string) => {
    const result = await requestDownloadTaskCancellation(taskId)
    if (result.success && result.undo) showOptionsUndoToast(result.undo)
    if (!result.success) toast.error(t("options_toastCancelFailed"))
    return result
  }, [])

  const retryTask = useCallback(async (taskId: string) => {
    try {
      const response = await chrome.runtime.sendMessage<
        RetryFailedChaptersMessage,
        RetryFailedChaptersResponse
      >({
        type: "RETRY_FAILED_CHAPTERS",
        ...createCommandEnvelope(),
        payload: { taskId },
      })
      if (!response || response.success === false) {
        toast.error(t("options_toastRetryFailed"))
      }
    } catch (error) {
      logger.error("[DOWNLOADS TAB] Failed to retry task:", error)
      toast.error(t("options_toastRetryFailed"))
    }
  }, [])

  const restartTask = useCallback(async (taskId: string) => {
    try {
      const response = await chrome.runtime.sendMessage<
        RestartTaskMessage,
        RestartTaskResponse
      >({
        type: "RESTART_TASK",
        ...createCommandEnvelope(),
        payload: { taskId },
      })
      if (!response || response.success === false) {
        toast.error(t("options_toastRestartFailed"))
      }
    } catch (error) {
      logger.error("[DOWNLOADS TAB] Failed to restart task:", error)
      toast.error(t("options_toastRestartFailed"))
    }
  }, [])

  const removeTask = useCallback(async (taskId: string) => {
    try {
      const response = await chrome.runtime.sendMessage<
        StateActionMessage,
        StateActionResponse
      >({
        type: "STATE_ACTION",
        ...createCommandEnvelope(),
        action: StateAction.REMOVE_DOWNLOAD_TASK,
        payload: { taskId },
      })
      if (!response || response.success === false) {
        toast.error(t("options_toastRemoveFailed"))
        return
      }
      const undo = getPendingUndoReceipt(response)
      if (undo) showOptionsUndoToast(undo)
    } catch (error) {
      logger.error("[DOWNLOADS TAB] Failed to remove task:", error)
      toast.error(t("options_toastRemoveFailed"))
    }
  }, [])

  const clearAllHistory = useCallback(async (): Promise<boolean> => {
    try {
      const response: { success?: boolean; error?: string } =
        await chrome.runtime.sendMessage({
          type: "CLEAR_ALL_HISTORY",
          ...createCommandEnvelope(),
          payload: {},
        })
      if (!response?.success) {
        throw new Error(response?.error || "Failed to clear history")
      }
      return true
    } catch (error) {
      logger.error("[DOWNLOADS TAB] Failed to clear history:", error)
      toast.error(t("options_toastClearHistoryFailed"))
      return false
    }
  }, [])

  const sendDestinationTaskAction = useCallback(
    async (
      taskId: string,
      action:
        | StateAction.RETRY_DESTINATION_TASK
        | StateAction.CONTINUE_TASK_IN_DOWNLOADS
    ) => {
      try {
        const response = await chrome.runtime.sendMessage<
          StateActionMessage,
          StateActionResponse
        >({
          type: "STATE_ACTION",
          action,
          ...createCommandEnvelope(),
          payload: { taskId },
        })
        if (!response?.success) {
          throw new Error(response?.error || "Destination task action failed")
        }
        return true
      } catch (error) {
        logger.error("[DOWNLOADS TAB] Destination task action failed:", error)
        toast.error(t("destinationIssue_actionFailed"))
        return false
      }
    },
    []
  )

  return {
    tasks,
    isLoading,
    destinationIssue,
    historyStorageBytes,
    cancelTask,
    retryTask,
    restartTask,
    removeTask,
    clearAllHistory,
    retryDestinationTask: (taskId: string) =>
      sendDestinationTaskAction(taskId, StateAction.RETRY_DESTINATION_TASK),
    continueTaskInDownloads: (taskId: string) =>
      sendDestinationTaskAction(taskId, StateAction.CONTINUE_TASK_IN_DOWNLOADS),
  }
}
