import { QueueReadNotice } from "@/src/ui/shared/QueueReadNotice"
import { useState } from "react"
import { Database, Layers, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { DownloadTaskGroups } from "../components/DownloadTaskGroups"
import { ClearHistoryDialog } from "../components/ClearHistoryDialog"
import {
  formatBytes,
  partitionDownloadTasks,
} from "../components/downloads-tab-helpers"
import { useDownloadsTabState } from "../hooks/useDownloadsTabState"
import { runConfirmedHistoryAction } from "../hooks/history-dialog-action"
import { composeSeriesKey } from "@/src/runtime/queue-task-summary"
import { getDisplayName } from "@/src/site-integrations/catalog"
import { t } from "@/src/runtime/i18n"
import { SettingsGroup } from "../components/primitives/SettingsGroup"
import { SettingsRow } from "../components/primitives/SettingsRow"
import { SettingsSectionHeader } from "../components/primitives/SettingsSectionHeader"
import type { HistoryStats, SeriesHistory } from "../hooks/useOptionsHistory"

interface ActivityTabProps {
  stats?: HistoryStats | null
  series?: SeriesHistory[]
  onClearChapterHistory: () => Promise<boolean>
  onClearSeriesHistory?: (
    siteIntegrationId: string,
    seriesId: string
  ) => Promise<boolean>
  onRefreshSeries?: () => Promise<SeriesHistory[]>
  isClearingHistory?: boolean
}
export function ActivityTab({
  stats,
  series = [],
  onClearChapterHistory,
  onClearSeriesHistory,
  onRefreshSeries,
  isClearingHistory = false,
}: ActivityTabProps) {
  const [historyToClear, setHistoryToClear] = useState<
    "tasks" | "chapters" | null
  >(null)
  const [clearSeriesDialogOpen, setClearSeriesDialogOpen] = useState(false)
  const [selectedSeriesToClear, setSelectedSeriesToClear] = useState("")
  const [localSeries, setLocalSeries] = useState<SeriesHistory[]>(series)
  const {
    tasks,
    isLoading,
    readStatus,
    retryRead,
    historyStorageBytes,
    cancelTask,
    retryTask,
    restartTask,
    removeTask,
    clearTaskHistory,
  } = useDownloadsTabState()

  const {
    activeTasks,
    queuedTasks,
    completedTasks,
    failedTasks,
    canceledTasks,
    terminalTasks,
  } = partitionDownloadTasks(tasks)

  const handleClearSeries = async () => {
    if (!selectedSeriesToClear || !onClearSeriesHistory) return
    const selected = localSeries.find(
      (s) =>
        composeSeriesKey(s.siteIntegrationId, s.seriesId) ===
        selectedSeriesToClear
    )
    if (!selected) return
    await runConfirmedHistoryAction(
      () => onClearSeriesHistory(selected.siteIntegrationId, selected.seriesId),
      () => {
        setSelectedSeriesToClear("")
        setClearSeriesDialogOpen(false)
      }
    )
  }

  const handleOpenSeriesDialog = async (open: boolean) => {
    if (open && onRefreshSeries) {
      const refreshed = await onRefreshSeries()
      setLocalSeries(refreshed)
    } else {
      setSelectedSeriesToClear("")
    }
    setClearSeriesDialogOpen(open)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-border bg-card">
        <Loader2 className="size-8 animate-spin text-primary mb-4" />
        <p className="text-sm text-muted-foreground">
          {t("options_loadingDownloads")}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        id="options-activity-heading"
        title={t("options_activity")}
        description={t("options_downloadsDesc")}
      />

      <QueueReadNotice status={readStatus} onRetry={retryRead} />

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
                onClick={() => setHistoryToClear("tasks")}
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

      {/* History & Storage Management */}
      <SettingsGroup
        title={t("options_manageHistoryData")}
        description={t("options_manageHistoryDesc")}
      >
        {/* Storage usage summary */}
        <SettingsRow
          icon={Database}
          title={t("options_storageUsed")}
          description={
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mt-1">
              <span>
                {t("options_totalSeries")}:{" "}
                <strong className="text-foreground font-semibold">
                  {stats?.totalSeries ?? 0}
                </strong>
              </span>
              <span>•</span>
              <span>
                {t("options_totalChapters")}:{" "}
                <strong className="text-foreground font-semibold">
                  {stats?.totalChapters ?? 0}
                </strong>
              </span>
              <span>•</span>
              <span>
                {t("options_localStorageUsage")}:{" "}
                <strong className="text-foreground font-semibold">
                  {readStatus === "error"
                    ? "—"
                    : formatBytes(historyStorageBytes)}
                </strong>
              </span>
            </div>
          }
        />

        {/* Clear Series History Action */}
        <SettingsRow
          icon={Layers}
          title={t("options_clearSpecificSeries")}
          description={t("options_clearSeriesSubtext")}
          control={
            <Dialog
              open={clearSeriesDialogOpen}
              onOpenChange={handleOpenSeriesDialog}
            >
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    isClearingHistory || (stats?.totalSeries ?? 0) === 0
                  }
                  className="text-xs h-8"
                >
                  {t("options_clearSeriesHistory")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("options_clearSeriesHistory")}</DialogTitle>
                  <DialogDescription>
                    {t("options_clearSeriesSubtext")}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 py-3">
                  <Label htmlFor="series-select">
                    {t("options_selectSeries")}
                  </Label>
                  <Select
                    value={selectedSeriesToClear}
                    onValueChange={setSelectedSeriesToClear}
                  >
                    <SelectTrigger id="series-select">
                      <SelectValue placeholder={t("options_chooseSeries")} />
                    </SelectTrigger>
                    <SelectContent>
                      {localSeries.length === 0 ? (
                        <SelectItem value="_empty" disabled>
                          {t("options_noDownloadHistory")}
                        </SelectItem>
                      ) : (
                        localSeries.map((s) => {
                          const key = composeSeriesKey(
                            s.siteIntegrationId,
                            s.seriesId
                          )
                          const siteName =
                            getDisplayName(s.siteIntegrationId) ??
                            s.siteIntegrationId
                          return (
                            <SelectItem key={key} value={key}>
                              {s.seriesTitle || s.seriesId} ({siteName})
                            </SelectItem>
                          )
                        })
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setClearSeriesDialogOpen(false)}
                  >
                    {t("common_cancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!selectedSeriesToClear || isClearingHistory}
                    onClick={handleClearSeries}
                  >
                    {isClearingHistory && (
                      <Loader2 className="size-4 animate-spin mr-1.5" />
                    )}
                    {t("options_clearSelected")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />

        {/* Clear Chapter History Action */}
        <SettingsRow
          icon={Trash2}
          title={t("options_clearChapterHistory")}
          description={t("options_clearChapterHistorySubtext")}
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHistoryToClear("chapters")}
              disabled={isClearingHistory || (stats?.totalSeries ?? 0) === 0}
              className="text-xs h-8 text-destructive hover:bg-destructive/10 hover:border-destructive/40"
            >
              {t("options_clearChapterHistory")}
            </Button>
          }
        />
      </SettingsGroup>

      {historyToClear && (
        <ClearHistoryDialog
          open
          onOpenChange={(open) => {
            if (!open) setHistoryToClear(null)
          }}
          title={t(
            historyToClear === "tasks"
              ? "options_clearTaskHistoryTitle"
              : "options_clearChapterHistoryTitle"
          )}
          description={t(
            historyToClear === "tasks"
              ? "options_clearTaskHistoryDesc"
              : "options_clearChapterHistoryDesc"
          )}
          confirmLabel={t(
            historyToClear === "tasks"
              ? "options_clearTaskHistory"
              : "options_clearChapterHistory"
          )}
          onConfirm={
            historyToClear === "tasks"
              ? clearTaskHistory
              : onClearChapterHistory
          }
        />
      )}
    </div>
  )
}
