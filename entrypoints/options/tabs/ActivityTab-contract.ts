import type { HistoryStats, SeriesHistory } from "../hooks/useOptionsHistory"

export interface ActivityTabProps {
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
