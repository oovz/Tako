import type { HistoryRepository } from "./history-repository"
import type {
  DownloadedChapterRecord,
  SeriesDownloadHistory,
} from "@/src/domain/history/types"
export class HistoryQueryService {
  constructor(private readonly repository: HistoryRepository) {}
  getDownloadedChapters(): Promise<DownloadedChapterRecord[]> {
    return this.repository.getDownloadedChapters()
  }
  getSeriesHistory(
    siteIntegrationId: string,
    seriesId: string
  ): Promise<SeriesDownloadHistory | null> {
    return this.repository.getSeriesHistory(siteIntegrationId, seriesId)
  }
  getAllSeriesHistory(): Promise<SeriesDownloadHistory[]> {
    return this.repository.getAllSeriesHistory()
  }
  getStorageStats(): ReturnType<HistoryRepository["getStorageStats"]> {
    return this.repository.getStorageStats()
  }
}
