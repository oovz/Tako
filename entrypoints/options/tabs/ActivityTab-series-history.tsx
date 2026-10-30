import { useState } from "react"
import { Layers, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { SettingsRow } from "../components/primitives/SettingsRow"
import { runConfirmedHistoryAction } from "../hooks/history-dialog-action"
import type { SeriesHistory } from "../hooks/useOptionsHistory"
import { composeSeriesKey } from "@/src/runtime/queue-task-summary"
import { getDisplayName } from "@/src/site-integrations/catalog"
import { t } from "@/src/runtime/i18n"
import type { ActivityTabProps } from "./ActivityTab-contract"

export function useActivitySeriesHistory({
  series = [],
  onClearSeriesHistory,
  onRefreshSeries,
}: Pick<
  ActivityTabProps,
  "series" | "onClearSeriesHistory" | "onRefreshSeries"
>) {
  const [clearSeriesDialogOpen, setClearSeriesDialogOpen] = useState(false)
  const [selectedSeriesToClear, setSelectedSeriesToClear] = useState("")
  const [localSeries, setLocalSeries] = useState<SeriesHistory[]>(series)
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

  return {
    clearSeriesDialogOpen,
    selectedSeriesToClear,
    localSeries,
    setSelectedSeriesToClear,
    setClearSeriesDialogOpen,
    handleClearSeries,
    handleOpenSeriesDialog,
  }
}

export type ActivitySeriesHistoryState = ReturnType<
  typeof useActivitySeriesHistory
>
export function ActivityTabSeriesHistory({
  state,
  isClearingHistory = false,
  disabled,
}: {
  state: ActivitySeriesHistoryState
  isClearingHistory?: boolean
  disabled: boolean
}) {
  const {
    clearSeriesDialogOpen,
    selectedSeriesToClear,
    localSeries,
    setSelectedSeriesToClear,
    setClearSeriesDialogOpen,
    handleClearSeries,
    handleOpenSeriesDialog,
  } = state
  return (
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
              disabled={disabled}
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
            <SeriesHistorySelect
              series={localSeries}
              value={selectedSeriesToClear}
              onValueChange={setSelectedSeriesToClear}
            />
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
  )
}

function SeriesHistorySelect({
  series,
  value,
  onValueChange,
}: {
  series: SeriesHistory[]
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-3 py-3">
      <Label htmlFor="series-select">{t("options_selectSeries")}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id="series-select">
          <SelectValue placeholder={t("options_chooseSeries")} />
        </SelectTrigger>
        <SelectContent>
          {series.length === 0 ? (
            <SelectItem value="_empty" disabled>
              {t("options_noDownloadHistory")}
            </SelectItem>
          ) : (
            series.map((s) => {
              const key = composeSeriesKey(s.siteIntegrationId, s.seriesId)
              const siteName =
                getDisplayName(s.siteIntegrationId) ?? s.siteIntegrationId
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
  )
}
