import {
  composeDownloadedChapterKey,
  composeSeriesHistoryKey,
  type DownloadedChapterRecord,
  type HistoryAggregate,
  type SeriesDownloadHistory,
} from "./types"

export function rebuildSeriesHistory(
  records: DownloadedChapterRecord[]
): Record<string, SeriesDownloadHistory> {
  const histories: Record<string, SeriesDownloadHistory> = {}
  for (const record of records) {
    const key = composeSeriesHistoryKey(
      record.siteIntegrationId,
      record.seriesId
    )
    const history =
      histories[key] ??
      (histories[key] = {
        siteIntegrationId: record.siteIntegrationId,
        seriesId: record.seriesId,
        seriesTitle: record.seriesTitle,
        lastUpdated: record.downloadedAt,
        downloadedChapters: [],
      })
    history.downloadedChapters.push(structuredClone(record))
    history.lastUpdated = Math.max(history.lastUpdated, record.downloadedAt)
  }
  for (const history of Object.values(histories)) {
    history.downloadedChapters.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    )
  }
  return histories
}

export function addOrReplaceRecord(
  aggregate: HistoryAggregate,
  record: DownloadedChapterRecord
): HistoryAggregate {
  const key = composeDownloadedChapterKey(
    record.siteIntegrationId,
    record.seriesId,
    record.chapterId
  )
  const records = aggregate.downloadedChapters.filter(
    (candidate) =>
      composeDownloadedChapterKey(
        candidate.siteIntegrationId,
        candidate.seriesId,
        candidate.chapterId
      ) !== key
  )
  records.push(structuredClone(record))
  return {
    downloadedChapters: records,
    seriesDownloadHistory: rebuildSeriesHistory(records),
    clearCutoffs: structuredClone(aggregate.clearCutoffs),
  }
}

export function removeChapter(
  aggregate: HistoryAggregate,
  siteIntegrationId: string,
  seriesId: string,
  chapterId: string,
  now: number
): HistoryAggregate {
  const key = composeDownloadedChapterKey(
    siteIntegrationId,
    seriesId,
    chapterId
  )
  const records = aggregate.downloadedChapters.filter(
    (record) =>
      composeDownloadedChapterKey(
        record.siteIntegrationId,
        record.seriesId,
        record.chapterId
      ) !== key
  )
  const clearCutoffs = structuredClone(aggregate.clearCutoffs)
  clearCutoffs.byChapter[key] = now
  return {
    downloadedChapters: records,
    seriesDownloadHistory: rebuildSeriesHistory(records),
    clearCutoffs,
  }
}

export function clearAll(
  aggregate: HistoryAggregate,
  now: number
): HistoryAggregate {
  return {
    downloadedChapters: [],
    seriesDownloadHistory: {},
    clearCutoffs: { allBefore: now, bySeries: {}, byChapter: {} },
  }
}

export function clearSeries(
  aggregate: HistoryAggregate,
  siteIntegrationId: string,
  seriesId: string,
  now: number
): HistoryAggregate {
  const records = aggregate.downloadedChapters.filter(
    (record) =>
      record.siteIntegrationId !== siteIntegrationId ||
      record.seriesId !== seriesId
  )
  const clearCutoffs = structuredClone(aggregate.clearCutoffs)
  clearCutoffs.bySeries[composeSeriesHistoryKey(siteIntegrationId, seriesId)] =
    now
  return {
    downloadedChapters: records,
    seriesDownloadHistory: rebuildSeriesHistory(records),
    clearCutoffs,
  }
}

export function cleanupOlderThan(
  aggregate: HistoryAggregate,
  olderThanDays: number,
  now: number
): HistoryAggregate {
  const cutoff = now - olderThanDays * 24 * 60 * 60 * 1000
  const retained = aggregate.downloadedChapters.filter(
    (record) => record.downloadedAt > cutoff
  )
  const clearCutoffs = structuredClone(aggregate.clearCutoffs)
  for (const record of aggregate.downloadedChapters) {
    if (record.downloadedAt > cutoff) continue
    clearCutoffs.byChapter[
      composeDownloadedChapterKey(
        record.siteIntegrationId,
        record.seriesId,
        record.chapterId
      )
    ] = now
  }
  return {
    downloadedChapters: retained,
    seriesDownloadHistory: rebuildSeriesHistory(retained),
    clearCutoffs,
  }
}
