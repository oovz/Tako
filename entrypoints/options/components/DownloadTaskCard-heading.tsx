import { Badge } from "@/components/ui/badge"
import { CardHeader, CardTitle } from "@/components/ui/card"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { getDisplayName } from "@/src/site-integrations/catalog"
import {
  getCompletedOutputDestination,
  getCompletedSaveConfirmedAt,
} from "@/src/runtime/output-result-presentation"
import { t } from "@/src/runtime/i18n"
import {
  formatTaskTimestamp,
  getTaskStatusBadge,
  getTerminalTimestampLabel,
} from "./downloads-tab-helpers"

function taskTimestamp(task: DownloadTaskState) {
  const terminalLabel = getTerminalTimestampLabel(task.status)
  if (terminalLabel && typeof task.completed === "number") {
    return `${terminalLabel} ${formatTaskTimestamp(task.completed)}`
  }
  return t("options_createdAt", [formatTaskTimestamp(task.created)])
}

export function DownloadTaskCardHeading({ task }: { task: DownloadTaskState }) {
  const variant = getTaskStatusBadge(
    task.status,
    getCompletedOutputDestination(task.chapters),
    getCompletedSaveConfirmedAt(task.chapters)
  )
  const completedChapters = task.chapters.filter(
    (chapter) => chapter.status === "completed"
  ).length
  return (
    <CardHeader className="pb-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <CardTitle role="heading" aria-level={3} className="text-base">
            {task.seriesTitle}
          </CardTitle>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>
              {t("options_chaptersCount", [
                String(completedChapters),
                String(task.chapters.length),
              ])}
            </span>
            <span>•</span>
            <span>{getDisplayName(task.siteIntegrationId)}</span>
            <span>•</span>
            <span>{taskTimestamp(task)}</span>
            {task.isRetried && (
              <>
                <span>•</span>
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {t("options_retried")}
                </Badge>
              </>
            )}
          </div>
        </div>
        <Badge className={variant.className}>{variant.label}</Badge>
      </div>
    </CardHeader>
  )
}
