import React, { useCallback, useState } from "react"

import { AlertTriangle, Folder } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import {
  getDestinationIssueMessageKey,
  normalizeDestinationIssues,
} from "@/src/runtime/destination-issue-state"
import { t } from "@/src/runtime/i18n"
import logger from "@/src/runtime/logger"
import { openOptionsPage } from "@/src/runtime/open-options"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { DestinationIssue } from "@/src/types/queue-state"
import { StateAction } from "@/src/types/state-actions"
import type {
  StateActionMessage,
  StateActionResponse,
} from "@/src/types/state-action-message"
import { useChromeStorageValue } from "@/src/ui/shared/hooks/useChromeStorageValue"

interface FsaBannerProps {
  className?: string
}

export function FsaBanner({ className }: FsaBannerProps) {
  const [pendingAction, setPendingAction] = useState<StateAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const { value: destinationIssues } = useChromeStorageValue<
    DestinationIssue[]
  >({
    areaName: "local",
    key: LOCAL_STORAGE_KEYS.destinationIssues,
    initialValue: [],
    parse: normalizeDestinationIssues,
  })
  const issue = destinationIssues[0]

  const openOptions = useCallback(async () => {
    try {
      await openOptionsPage("downloads")
    } catch (error) {
      logger.debug("[FsaBanner] Failed to open options (non-fatal):", error)
    }
  }, [])

  const sendTaskAction = useCallback(
    async (action: StateAction) => {
      if (!issue || pendingAction !== null) return
      setPendingAction(action)
      setActionError(null)
      try {
        const response = await chrome.runtime.sendMessage<
          StateActionMessage,
          StateActionResponse
        >({
          type: "STATE_ACTION",
          action,
          ...createCommandEnvelope(),
          payload: { taskId: issue.taskId },
        })
        if (!response?.success) {
          throw new Error(response?.error || "Task action failed")
        }
      } catch (error) {
        logger.warn("[FsaBanner] Destination task action failed", error)
        setActionError(t("destinationIssue_actionFailed"))
      } finally {
        setPendingAction(null)
      }
    },
    [issue, pendingAction]
  )

  if (!issue) return null

  return (
    <Alert variant="destructive" className={className}>
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
            onClick={() =>
              void sendTaskAction(StateAction.CONTINUE_TASK_IN_DOWNLOADS)
            }
          >
            {t("destinationIssue_continueDownloads")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pendingAction !== null}
            onClick={() =>
              void sendTaskAction(StateAction.CANCEL_DOWNLOAD_TASK)
            }
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
