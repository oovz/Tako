import { Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DownloadTaskGroups } from "../components/DownloadTaskGroups"
import { partitionDownloadTasks } from "../components/downloads-tab-helpers"
import type { useDownloadsTabState } from "../hooks/useDownloadsTabState"
import { t } from "@/src/runtime/i18n"

export function ActivityTabQueue({
  state,
  onClearHistory,
}: {
  state: ReturnType<typeof useDownloadsTabState>
  onClearHistory: () => void
}) {
  const { tasks, readStatus, cancelTask, retryTask, restartTask, removeTask } =
    state
  const {
    activeTasks,
    queuedTasks,
    completedTasks,
    failedTasks,
    canceledTasks,
    terminalTasks,
  } = partitionDownloadTasks(tasks)
  return (
    <>
      {/* Live Download Queue Monitor */}
      {readStatus !== "error" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground tracking-tight">
                {t("options_activeDownloads")}
              </h2>
              <Badge variant="secondary" className="h-5 px-2 text-xs font-mono">
                {tasks.length}
              </Badge>
            </div>
            {terminalTasks.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClearHistory}
                className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/40"
              >
                <Trash2 className="size-3.5" />
                {t("options_clearTaskHistory")}
              </Button>
            )}
          </div>

          <DownloadTaskGroups
            tasks={tasks}
            activeTasks={activeTasks}
            queuedTasks={queuedTasks}
            completedTasks={completedTasks}
            failedTasks={failedTasks}
            canceledTasks={canceledTasks}
            onCancel={cancelTask}
            onRetry={retryTask}
            onRestart={restartTask}
            onRemove={removeTask}
          />
        </div>
      )}
    </>
  )
}
