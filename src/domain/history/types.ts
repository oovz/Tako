export interface DownloadedChapterRecord {
  siteIntegrationId: string
  chapterId: string
  url: string
  title: string
  seriesId: string
  seriesTitle: string
  chapterNumber?: number
  volumeNumber?: number
  downloadedAt: number
  filePath?: string
  fileSize?: number
  format: "zip" | "cbz" | "cbr" | "pdf" | "none"
}

export interface SeriesDownloadHistory {
  siteIntegrationId: string
  seriesId: string
  seriesTitle: string
  lastUpdated: number
  downloadedChapters: DownloadedChapterRecord[]
}

export interface DownloadHistoryClearCutoffs {
  allBefore?: number
  bySeries: Record<string, number>
  byChapter: Record<string, number>
}

export interface HistoryAggregate {
  downloadedChapters: DownloadedChapterRecord[]
  seriesDownloadHistory: Record<string, SeriesDownloadHistory>
  clearCutoffs: DownloadHistoryClearCutoffs
}

export function composeDownloadedChapterKey(
  siteIntegrationId: string,
  seriesId: string,
  chapterId: string
): string {
  return `${siteIntegrationId}\u0000${seriesId}\u0000${chapterId}`
}

export function composeSeriesHistoryKey(
  siteIntegrationId: string,
  seriesId: string
): string {
  return `${siteIntegrationId}#${seriesId}`
}
