import { Folder, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getDestinationIssueMessageKey } from "@/src/runtime/destination-issue-state"
import { t } from "@/src/runtime/i18n"
import type { DestinationIssue } from "@/src/types/queue-state"

interface DownloadsFsaBannerProps {
  issue: DestinationIssue
  taskTitle?: string
  isWorking: boolean
  onGrantAccess: () => Promise<void>
  onPickFolder: () => Promise<void>
  onContinueInDownloads: () => Promise<void>
  onCancelTask: () => Promise<void>
}

export function DownloadsFsaBanner({
  issue,
  taskTitle,
  isWorking,
  onGrantAccess,
  onPickFolder,
  onContinueInDownloads,
  onCancelTask,
}: DownloadsFsaBannerProps) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-destructive">
            {t("destinationIssue_title")}
          </p>
          {taskTitle && (
            <p className="text-xs font-medium text-foreground">{taskTitle}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {t(getDestinationIssueMessageKey(issue.kind))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onGrantAccess()}
            disabled={isWorking}
          >
            <ShieldCheck data-icon="inline-start" className="size-3.5" />
            {t("destinationIssue_grantAccess")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onPickFolder()}
            disabled={isWorking}
          >
            <Folder data-icon="inline-start" className="size-3.5" />
            {t("destinationIssue_chooseFolder")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onContinueInDownloads()}
            disabled={isWorking}
          >
            {t("destinationIssue_continueDownloads")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onCancelTask()}
            disabled={isWorking}
          >
            {t("destinationIssue_cancelTask")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
