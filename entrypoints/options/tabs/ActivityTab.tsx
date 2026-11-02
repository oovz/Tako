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
  const [historyToClear, setHistoryToClear] =
    useState<ActivityHistoryKind | null>(null)
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
        description={t("options_downloadsDesc")}
      />
      <QueueReadNotice status={state.readStatus} onRetry={state.retryRead} />
      <ActivityTabQueue
        state={state}
        onClearHistory={() => setHistoryToClear("tasks")}
      />
      <ActivityTabHistory
        {...props}
        seriesHistory={seriesHistory}
        readStatus={state.readStatus}
        historyStorageBytes={state.historyStorageBytes}
        onClearChapterHistoryRequest={() => setHistoryToClear("chapters")}
      />
      {historyToClear && (
        <ActivityTabHistoryConfirmation
          kind={historyToClear}
          onClose={() => setHistoryToClear(null)}
          onConfirm={clearHistory[historyToClear]}
        />
      )}
    </div>
  )
}
