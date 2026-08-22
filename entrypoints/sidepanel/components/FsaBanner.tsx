import React, { useCallback, useEffect, useRef, useState } from "react"

import { AlertTriangle, Folder } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { getDestinationIssueMessageKey } from "@/src/runtime/destination-issue-state"
import { cn } from "@/src/shared/utils"
import { t } from "@/src/runtime/i18n"
import logger from "@/src/runtime/logger"
import { openOptionsPage } from "@/src/runtime/open-options"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { DestinationIssue } from "@/src/domain/queue/state"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import { queueCommandClient } from "@/src/ui/shared/queue-command-client"

interface FsaBannerProps {
  className?: string
}

export function FsaBanner({ className }: FsaBannerProps) {
  const [pendingAction, setPendingAction] = useState<
    "CONTINUE_DOWNLOAD" | "CANCEL_TASK" | null
  >(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [issue, setIssue] = useState<DestinationIssue | null>(null)
  const latestRequestId = useRef(0)

  const refreshDestinationIssue = useCallback(async (): Promise<void> => {
    const requestId = ++latestRequestId.current
    try {
      const response = await sendRuntimeMessage({
        target: "background",
        type: "GET_SIDEPANEL_DOWNLOAD_STATE",
      })
      if (!response.success) throw new Error(response.error)
      if (requestId === latestRequestId.current) {
        setIssue(response.data.destinationIssue)
      }
    } catch (error) {
      if (requestId === latestRequestId.current) {
        logger.warn("[FsaBanner] Failed to refresh destination issue", error)
      }
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void refreshDestinationIssue()
    })

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ): void => {
      if (
        areaName !== "local" ||
        !(LOCAL_STORAGE_KEYS.destinationIssues in changes)
      ) {
        return
      }
      void refreshDestinationIssue()
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => {
      latestRequestId.current += 1
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [refreshDestinationIssue])

  const openOptions = useCallback(async () => {
    try {
      await openOptionsPage("storage")
    } catch (error) {
      logger.debug("[FsaBanner] Failed to open options (non-fatal):", error)
    }
  }, [])

  const sendTaskAction = useCallback(
    async (type: "CONTINUE_DOWNLOAD" | "CANCEL_TASK") => {
      if (!issue || pendingAction !== null) return
      setPendingAction(type)
      setActionError(null)
      try {
        if (type === "CONTINUE_DOWNLOAD") {
          await queueCommandClient.continueDownload(issue.taskId)
        } else {
          await queueCommandClient.cancelTask(issue.taskId)
        }
        void refreshDestinationIssue()
      } catch (error) {
        logger.warn("[FsaBanner] Destination task action failed", error)
        setActionError(t("destinationIssue_actionFailed"))
      } finally {
        setPendingAction(null)
      }
    },
    [issue, pendingAction, refreshDestinationIssue]
  )

  if (!issue) return null

  return (
    <Alert
      variant="destructive"
      className={cn(
        "animate-in fade-in slide-in-from-top-2 duration-200 ease-out",
        className
      )}
    >
      <AlertTriangle className="size-4" />
      <AlertTitle>{t("destinationIssue_title")}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span className="min-w-0 break-words">
          {t(getDestinationIssueMessageKey(issue.kind))}
        </span>
        <div className="flex max-w-full flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={openOptions}>
            <Folder data-icon="inline-start" className="size-3.5" />
            {t("destinationIssue_fixFolder")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pendingAction !== null}
            onClick={() => void sendTaskAction("CONTINUE_DOWNLOAD")}
          >
            {t("destinationIssue_continueDownloads")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pendingAction !== null}
            onClick={() => void sendTaskAction("CANCEL_TASK")}
          >
            {t("destinationIssue_cancelTask")}
          </Button>
        </div>
        {actionError && (
          <span role="alert" className="text-sm font-medium">
            {actionError}
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}
