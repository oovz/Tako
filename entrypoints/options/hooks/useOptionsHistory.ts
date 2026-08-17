import { useState } from "react"
import { toast } from "sonner"
import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import type { OptionsHistoryController } from "../controllers/options-history-controller"

export interface SeriesHistory {
  siteIntegrationId: string
  seriesId: string
  seriesTitle: string
  chapterCount: number
}

export interface HistoryStats {
  totalChapters: number
  totalSeries: number
}

export function useOptionsHistory(historyController: OptionsHistoryController) {
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null)
  const [historySeries, setHistorySeries] = useState<SeriesHistory[]>([])
  const [isClearing, setIsClearing] = useState(false)

  async function handleRefreshHistory(): Promise<SeriesHistory[]> {
    const loaded = await historyController.refresh()
    setHistoryStats(loaded.historyStats)
    setHistorySeries(loaded.historySeries)
    return loaded.historySeries
  }

  async function clearAllHistory(): Promise<boolean> {
    try {
      setIsClearing(true)
      const loaded = await historyController.clear({ scope: "all" })
      setHistoryStats(loaded.historyStats)
      setHistorySeries(loaded.historySeries)
      toast.success(t("options_toastAllHistoryCleared"))
      return true
    } catch (error) {
      logger.error("[OPTIONS] Failed to clear history:", error)
      toast.error(t("options_toastClearHistoryFailed"))
      return false
    } finally {
      setIsClearing(false)
    }
  }

  async function clearSeriesHistory(
    siteIntegrationId: string,
    seriesId: string
  ): Promise<boolean> {
    try {
      setIsClearing(true)
      const loaded = await historyController.clear({
        scope: "series",
        siteIntegrationId,
        seriesId,
      })
      setHistoryStats(loaded.historyStats)
      setHistorySeries(loaded.historySeries)
      toast.success(t("options_toastSeriesHistoryCleared"))
      return true
    } catch (error) {
      logger.error("[OPTIONS] Failed to clear series history:", error)
      toast.error(t("options_toastClearSeriesFailed"))
      return false
    } finally {
      setIsClearing(false)
    }
  }

  return {
    historyStats,
    setHistoryStats,
    historySeries,
    setHistorySeries,
    isClearing,
    handleRefreshHistory,
    clearAllHistory,
    clearSeriesHistory,
  }
}
