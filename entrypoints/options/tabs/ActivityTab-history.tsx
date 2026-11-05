import { Button } from "@/components/ui/button"
import { ClearHistoryDialog } from "../components/ClearHistoryDialog"
import { SettingsGroup } from "../components/primitives/SettingsGroup"
import { SettingsRow } from "../components/primitives/SettingsRow"
import { formatBytes } from "../components/downloads-tab-helpers"
import {
  ActivityTabSeriesHistory,
  type ActivitySeriesHistoryState,
} from "./ActivityTab-series-history"
import type { ActivityTabProps } from "./ActivityTab-contract"
import type { HistoryStats } from "../hooks/useOptionsHistory"
import type { StorageReadStatus } from "@/src/ui/shared/hooks/useChromeStorageValue"
import { t } from "@/src/runtime/i18n"

type StorageSummaryProps = {
  stats?: HistoryStats | null
  readStatus: StorageReadStatus
  historyStorageBytes: number
}
function ActivityStorageSummary({
  stats,
  readStatus,
  historyStorageBytes,
}: StorageSummaryProps) {
  return (
    <SettingsRow
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
              {readStatus === "error" ? "—" : formatBytes(historyStorageBytes)}
            </strong>
          </span>
        </div>
      }
    />
  )
}

export function ActivityTabHistory(
  props: ActivityTabProps &
    StorageSummaryProps & {
      onClearChapterHistoryRequest: () => void
      seriesHistory: ActivitySeriesHistoryState
    }
) {
  const {
    stats,
    readStatus,
    historyStorageBytes,
    onClearChapterHistoryRequest,
    isClearingHistory = false,
  } = props
  const disabled = isClearingHistory || (stats?.totalSeries ?? 0) === 0
  return (
    <SettingsGroup
      title={t("options_manageHistoryData")}
      description={t("options_manageHistoryDesc")}
    >
      <ActivityStorageSummary
        stats={stats}
        readStatus={readStatus}
        historyStorageBytes={historyStorageBytes}
      />
      <ActivityTabSeriesHistory
        state={props.seriesHistory}
        isClearingHistory={isClearingHistory}
        disabled={disabled}
      />
      {/* Clear Chapter History Action */}
      <SettingsRow
        title={t("options_clearChapterHistory")}
        description={t("options_clearChapterHistorySubtext")}
        control={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearChapterHistoryRequest}
            disabled={disabled}
            className="text-xs h-8 text-destructive hover:bg-destructive/10 hover:border-destructive/40"
          >
            {t("options_clearChapterHistory")}
          </Button>
        }
      />
    </SettingsGroup>
  )
}

export type ActivityHistoryKind = "tasks" | "chapters"
const HISTORY_DIALOG_KEYS = {
  tasks: {
    title: "options_clearTaskHistoryTitle",
    description: "options_clearTaskHistoryDesc",
    confirmLabel: "options_clearTaskHistory",
  },
  chapters: {
    title: "options_clearChapterHistoryTitle",
    description: "options_clearChapterHistoryDesc",
    confirmLabel: "options_clearChapterHistory",
  },
}
export function ActivityTabHistoryConfirmation({
  kind,
  onClose,
  onConfirm,
}: {
  kind: ActivityHistoryKind
  onClose: () => void
  onConfirm: () => Promise<boolean>
}) {
  const keys = HISTORY_DIALOG_KEYS[kind]
  return (
    <ClearHistoryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t(keys.title)}
      description={t(keys.description)}
      confirmLabel={t(keys.confirmLabel)}
      onConfirm={onConfirm}
    />
  )
}
