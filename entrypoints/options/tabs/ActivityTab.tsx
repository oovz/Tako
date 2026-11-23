import { HistoryBySite } from "../components/HistoryBySite"
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { QueueReadNotice } from "@/src/ui/shared/QueueReadNotice"
import { t } from "@/src/runtime/i18n"
import { SettingsSectionHeader } from "../components/primitives/SettingsSectionHeader"
import { useDownloadsTabState } from "../hooks/useDownloadsTabState"
import type { ActivityTabProps } from "./ActivityTab-contract"
import { useActivitySeriesHistory } from "./ActivityTab-series-history"
import { ActivityTabQueue } from "./ActivityTab-queue"
import {
  ActivityTabHistory,
  ActivityTabHistoryConfirmation,
  type ActivityHistoryKind,
} from "./ActivityTab-history"

export type { ActivityTabProps } from "./ActivityTab-contract"

export function ActivityTab(props: ActivityTabProps) {
  const [historyDialog, setHistoryDialog] = useState<{
    kind: ActivityHistoryKind
    open: boolean
    id: number
  } | null>(null)
  const state = useDownloadsTabState()
  const seriesHistory = useActivitySeriesHistory(props)
  if (state.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-border bg-card">
        <Loader2 className="size-8 animate-spin text-primary mb-4" />
        <p className="text-sm text-muted-foreground">
          {t("options_loadingDownloads")}
        </p>
      </div>
    )
  }

  const clearHistory = {
    tasks: state.clearTaskHistory,
    chapters: props.onClearChapterHistory,
  }
  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        id="options-activity-heading"
        title={t("options_activity")}
      />
      <QueueReadNotice status={state.readStatus} onRetry={state.retryRead} />
      <ActivityTabQueue
        state={state}
        onClearHistory={() =>
          setHistoryDialog((prev) => ({
            kind: "tasks",
            open: true,
            id: (prev?.id ?? 0) + 1,
          }))
        }
      />
      <HistoryBySite series={props.series ?? []} />
      <ActivityTabHistory
        {...props}
        seriesHistory={seriesHistory}
        readStatus={state.readStatus}
        historyStorageBytes={state.historyStorageBytes}
        onClearChapterHistoryRequest={() =>
          setHistoryDialog((prev) => ({
            kind: "chapters",
            open: true,
            id: (prev?.id ?? 0) + 1,
          }))
        }
      />
      {historyDialog && (
        <ActivityTabHistoryConfirmation
          key={historyDialog.id}
          kind={historyDialog.kind}
          open={historyDialog.open}
          onClose={() =>
            setHistoryDialog((prev) => prev && { ...prev, open: false })
          }
          onConfirm={clearHistory[historyDialog.kind]}
        />
      )}
    </div>
  )
}
