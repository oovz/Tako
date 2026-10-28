import { TaskDestinationCaption } from "@/src/ui/shared/TaskDestinationCaption"
import type { TaskDestination } from "@/src/types/state-snapshots"
import { ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getDestinationIssueMessageKey } from "@/src/runtime/destination-issue-state"
import { t } from "@/src/runtime/i18n"
import type { DestinationIssue } from "@/src/domain/queue/state"

interface DownloadsFsaBannerProps {
  issue: DestinationIssue
  destination?: TaskDestination
  requestedPath?: string | null
  taskTitle?: string
  isWorking: boolean
  onGrantAccess: () => Promise<void>
  onCancelTask: () => Promise<void>
}

export function DownloadsFsaBanner({
  issue,
  taskTitle,
  destination,
  requestedPath,
  isWorking,
  onGrantAccess,
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
          {destination && (
            <TaskDestinationCaption
              destination={destination}
              requestedPath={requestedPath}
            />
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
