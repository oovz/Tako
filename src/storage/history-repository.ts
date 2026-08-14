import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import {
  addOrReplaceRecord,
  cleanupOlderThan,
  clearAll,
  clearSeries,
  removeChapter,
} from "@/src/domain/history/cleanup-policy"
import {
  cloneHistoryAggregate,
  parseHistoryAggregate,
  serializeHistoryAggregate,
} from "@/src/domain/history/schema"
import type {
  DownloadedChapterRecord,
  HistoryAggregate,
  SeriesDownloadHistory,
} from "@/src/domain/history/types"

export const HISTORY_STORAGE_KEYS = {
  downloadedChapters: LOCAL_STORAGE_KEYS.downloadedChapters,
  seriesDownloadHistory: LOCAL_STORAGE_KEYS.seriesDownloadHistory,
  clearCutoffs: LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs,
} as const

export class HistoryRepository {
  private cache: HistoryAggregate | null = null
  private cacheGeneration = 0
  private readonly mutations = new StorageMutationQueue()
  async getAggregate(): Promise<HistoryAggregate> {
    return this.mutations.run(() => this.loadAggregate())
  }
  private async getFreshAggregate(): Promise<HistoryAggregate> {
    return this.mutations.run(() => this.loadAggregate(true))
  }
  private async loadAggregate(forceReload = false): Promise<HistoryAggregate> {
    if (!forceReload && this.cache) return cloneHistoryAggregate(this.cache)

    while (true) {
      const generation = this.cacheGeneration
      const result = await chrome.storage.local.get([
        HISTORY_STORAGE_KEYS.downloadedChapters,
        HISTORY_STORAGE_KEYS.seriesDownloadHistory,
        HISTORY_STORAGE_KEYS.clearCutoffs,
      ])
      if (generation !== this.cacheGeneration) {
        if (this.cache) return cloneHistoryAggregate(this.cache)
        continue
      }

      const document: Record<string, unknown> = {}
      if (HISTORY_STORAGE_KEYS.downloadedChapters in result)
        document.downloadedChapters =
          result[HISTORY_STORAGE_KEYS.downloadedChapters]
      if (HISTORY_STORAGE_KEYS.seriesDownloadHistory in result)
        document.seriesDownloadHistory =
          result[HISTORY_STORAGE_KEYS.seriesDownloadHistory]
      if (HISTORY_STORAGE_KEYS.clearCutoffs in result)
        document.clearCutoffs = result[HISTORY_STORAGE_KEYS.clearCutoffs]
      const aggregate = parseHistoryAggregate(document)
      if (generation !== this.cacheGeneration) {
        if (this.cache) return cloneHistoryAggregate(this.cache)
        continue
      }
      this.cache = cloneHistoryAggregate(aggregate)
      return cloneHistoryAggregate(aggregate)
    }
  }
  async markChapterAsDownloaded(
    record: DownloadedChapterRecord
  ): Promise<void> {
    await this.mutations.run(async () =>
      this.persist(addOrReplaceRecord(await this.loadAggregate(), record))
    )
  }
  async restoreChapterFromCompletedTask(
    record: DownloadedChapterRecord,
    sourceLastUpdated: number
  ): Promise<boolean> {
    return this.mutations.run(async () => {
      const aggregate = await this.loadAggregate()
      const seriesKey = `${record.siteIntegrationId}#${record.seriesId}`
      const chapterKey = `${record.siteIntegrationId}\u0000${record.seriesId}\u0000${record.chapterId}`
      const clearedAt = Math.max(
        aggregate.clearCutoffs.allBefore ?? 0,
        aggregate.clearCutoffs.bySeries[seriesKey] ?? 0,
        aggregate.clearCutoffs.byChapter[chapterKey] ?? 0
      )
      if (sourceLastUpdated <= clearedAt) return false
      await this.persist(addOrReplaceRecord(aggregate, record))
      return true
    })
  }
  async getDownloadedChapters(): Promise<DownloadedChapterRecord[]> {
    return (await this.getFreshAggregate()).downloadedChapters
  }
  async getDownloadedChaptersForSeries(
    siteIntegrationId: string,
    seriesId: string
  ): Promise<DownloadedChapterRecord[]> {
    return (await this.getDownloadedChapters()).filter(
      (record) =>
        record.siteIntegrationId === siteIntegrationId &&
        record.seriesId === seriesId
    )
  }
  async isChapterDownloaded(
    siteIntegrationId: string,
    seriesId: string,
    chapterId: string
  ): Promise<boolean> {
    return (await this.getDownloadedChapters()).some(
      (record) =>
        record.siteIntegrationId === siteIntegrationId &&
        record.seriesId === seriesId &&
        record.chapterId === chapterId
    )
  }
  async getSeriesHistory(
    siteIntegrationId: string,
    seriesId: string
  ): Promise<SeriesDownloadHistory | null> {
    return (
      (await this.getFreshAggregate()).seriesDownloadHistory[
        `${siteIntegrationId}#${seriesId}`
      ] ?? null
    )
  }
  async getAllSeriesHistory(): Promise<SeriesDownloadHistory[]> {
    return Object.values((await this.getFreshAggregate()).seriesDownloadHistory)
  }
  async removeDownloadedChapter(
    siteIntegrationId: string,
    seriesId: string,
    chapterId: string
  ): Promise<void> {
    await this.mutations.run(async () =>
      this.persist(
        removeChapter(
          await this.loadAggregate(),
          siteIntegrationId,
          seriesId,
          chapterId,
          Date.now()
        )
      )
    )
  }
  async clearAllDownloadHistory(): Promise<void> {
    await this.mutations.run(async () =>
      this.persist(clearAll(await this.loadAggregate(), Date.now()))
    )
  }
  async clearSeriesDownloadHistory(
    siteIntegrationId: string,
    seriesId: string
  ): Promise<void> {
    await this.mutations.run(async () =>
      this.persist(
        clearSeries(
          await this.loadAggregate(),
          siteIntegrationId,
          seriesId,
          Date.now()
        )
      )
    )
  }
  async cleanupOldRecords(olderThanDays = 90): Promise<void> {
    await this.mutations.run(async () =>
      this.persist(
        cleanupOlderThan(await this.loadAggregate(), olderThanDays, Date.now())
      )
    )
  }
  async getStorageStats(): Promise<{
    totalChapters: number
    totalSeries: number
    oldestDownload: number | null
    newestDownload: number | null
  }> {
    const aggregate = await this.getFreshAggregate()
    const timestamps = aggregate.downloadedChapters.map(
      (record) => record.downloadedAt
    )
    return {
      totalChapters: timestamps.length,
      totalSeries: Object.keys(aggregate.seriesDownloadHistory).length,
      oldestDownload: timestamps.length ? Math.min(...timestamps) : null,
      newestDownload: timestamps.length ? Math.max(...timestamps) : null,
    }
  }
  invalidateCache(): void {
    this.cacheGeneration += 1
    this.cache = null
  }
  private async persist(next: HistoryAggregate): Promise<void> {
    const document = serializeHistoryAggregate(next)
    await chrome.storage.local.set({
      [HISTORY_STORAGE_KEYS.downloadedChapters]: document.downloadedChapters,
      [HISTORY_STORAGE_KEYS.seriesDownloadHistory]:
        document.seriesDownloadHistory,
      [HISTORY_STORAGE_KEYS.clearCutoffs]: document.clearCutoffs,
    })
    this.cache = cloneHistoryAggregate(next)
  }
}
