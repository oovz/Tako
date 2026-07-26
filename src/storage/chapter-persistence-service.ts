/**
 * Chapter Persistence Service
 *
 * Tracks downloaded chapters across sessions using chrome.storage.local
 * Provides persistent memory of what has been downloaded.
 *
 * Records are deduplicated and queried by integration, series, and chapter
 * identity; `url` is retained only as descriptive source metadata.
 */
import logger from "@/src/runtime/logger"
import { composeSeriesKey } from "@/src/runtime/queue-task-summary"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { z } from "zod"
import { StorageMutationQueue } from "./storage-mutation-queue"

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

export function composeDownloadedChapterKey(
  siteIntegrationId: string,
  seriesId: string,
  chapterId: string
): string {
  return `${siteIntegrationId}\u0000${seriesId}\u0000${chapterId}`
}

const VALID_FORMATS = ["zip", "cbz", "cbr", "pdf", "none"] as const

const DownloadedChapterRecordSchema = z.object({
  siteIntegrationId: z.string().min(1),
  chapterId: z.string(),
  url: z.string(),
  title: z.string(),
  seriesId: z.string(),
  seriesTitle: z.string(),
  chapterNumber: z.number().optional(),
  volumeNumber: z.number().optional(),
  downloadedAt: z.number(),
  filePath: z.string().optional(),
  fileSize: z.number().optional(),
  format: z.enum(VALID_FORMATS),
})

function parseDownloadedChapter(raw: unknown): DownloadedChapterRecord | null {
  const parsed = DownloadedChapterRecordSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export const parseDownloadedChapters = (
  raw: unknown
): DownloadedChapterRecord[] => {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const parsed = parseDownloadedChapter(entry)
    return parsed ? [parsed] : []
  })
}

const SeriesDownloadHistorySchema = z.object({
  siteIntegrationId: z.string().min(1),
  seriesId: z.string(),
  seriesTitle: z.string(),
  lastUpdated: z.number(),
  downloadedChapters: z
    .array(z.unknown())
    .transform((entries) => parseDownloadedChapters(entries)),
})

const parseSeriesHistory = (value: unknown): SeriesDownloadHistory | null => {
  const parsed = SeriesDownloadHistorySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const parseSeriesHistoryMap = (
  raw: unknown
): Record<string, SeriesDownloadHistory> => {
  const rawEntries = z.record(z.string(), z.unknown()).safeParse(raw)
  if (!rawEntries.success) {
    return {}
  }

  const entries: Record<string, SeriesDownloadHistory> = {}
  for (const value of Object.values(rawEntries.data)) {
    const parsed = parseSeriesHistory(value)
    if (!parsed) continue
    const key = composeSeriesKey(parsed.siteIntegrationId, parsed.seriesId)
    entries[key] = parsed
  }
  return entries
}

const DownloadHistoryClearCutoffsSchema = z.object({
  allBefore: z.number().optional(),
  bySeries: z.record(z.string(), z.number()).default({}),
  byChapter: z.record(z.string(), z.number()).default({}),
})

function parseDownloadHistoryClearCutoffs(
  raw: unknown
): DownloadHistoryClearCutoffs {
  const parsed = DownloadHistoryClearCutoffsSchema.safeParse(raw)
  return parsed.success ? parsed.data : { bySeries: {}, byChapter: {} }
}

class ChapterPersistenceService {
  private readonly STORAGE_KEY = LOCAL_STORAGE_KEYS.downloadedChapters
  private readonly SERIES_HISTORY_KEY = LOCAL_STORAGE_KEYS.seriesDownloadHistory
  private readonly CLEAR_CUTOFFS_KEY =
    LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs
  private readonly mutationQueue = new StorageMutationQueue()

  private async writeDownloadedChapterRecord(
    record: DownloadedChapterRecord
  ): Promise<void> {
    const [existing, historyResult] = await Promise.all([
      this.getDownloadedChapters(),
      chrome.storage.local.get([this.SERIES_HISTORY_KEY]),
    ])

    const filtered = existing.filter(
      (chapter) =>
        chapter.siteIntegrationId !== record.siteIntegrationId ||
        chapter.seriesId !== record.seriesId ||
        chapter.chapterId !== record.chapterId
    )
    filtered.push(record)

    const allHistory = parseSeriesHistoryMap(
      historyResult[this.SERIES_HISTORY_KEY]
    )
    this.applySeriesHistoryUpdate(allHistory, record)

    await chrome.storage.local.set({
      [this.STORAGE_KEY]: filtered,
      [this.SERIES_HISTORY_KEY]: allHistory,
    })
  }

  /**
   * Mark a chapter as downloaded
   */
  async markChapterAsDownloaded(
    record: DownloadedChapterRecord
  ): Promise<void> {
    await this.mutationQueue.run(async () => {
      try {
        await this.writeDownloadedChapterRecord(record)
        logger.info(`✅ Chapter marked as downloaded: ${record.title}`)
      } catch (error) {
        logger.error("❌ Failed to mark chapter as downloaded:", error)
        throw error
      }
    })
  }

  /**
   * Restore a completed queue chapter unless the user cleared that history
   * after the queue chapter last changed.
   */
  async restoreChapterFromCompletedTask(
    record: DownloadedChapterRecord,
    sourceLastUpdated: number
  ): Promise<boolean> {
    return this.mutationQueue.run(async () => {
      const result = await chrome.storage.local.get([this.CLEAR_CUTOFFS_KEY])
      const cutoffs = parseDownloadHistoryClearCutoffs(
        result[this.CLEAR_CUTOFFS_KEY]
      )
      const seriesKey = composeSeriesKey(
        record.siteIntegrationId,
        record.seriesId
      )
      const chapterKey = composeDownloadedChapterKey(
        record.siteIntegrationId,
        record.seriesId,
        record.chapterId
      )
      const clearedAt = Math.max(
        cutoffs.allBefore ?? 0,
        cutoffs.bySeries[seriesKey] ?? 0,
        cutoffs.byChapter[chapterKey] ?? 0
      )
      if (sourceLastUpdated <= clearedAt) {
        return false
      }

      await this.writeDownloadedChapterRecord(record)
      return true
    })
  }

  /**
   * Check if a chapter has been downloaded by canonical chapter ID.
   */
  async isChapterDownloaded(
    siteIntegrationId: string,
    seriesId: string,
    chapterId: string
  ): Promise<boolean> {
    const downloaded = await this.getDownloadedChapters()
    return downloaded.some(
      (chapter) =>
        chapter.siteIntegrationId === siteIntegrationId &&
        chapter.seriesId === seriesId &&
        chapter.chapterId === chapterId
    )
  }

  /**
   * Get all downloaded chapters for a series
   */
  async getDownloadedChaptersForSeries(
    siteIntegrationId: string,
    seriesId: string
  ): Promise<DownloadedChapterRecord[]> {
    const allDownloaded = await this.getDownloadedChapters()
    return allDownloaded.filter(
      (chapter) =>
        chapter.siteIntegrationId === siteIntegrationId &&
        chapter.seriesId === seriesId
    )
  }

  /**
   * Get all downloaded chapters
   */
  async getDownloadedChapters(): Promise<DownloadedChapterRecord[]> {
    const result = await chrome.storage.local.get([this.STORAGE_KEY])
    return parseDownloadedChapters(result[this.STORAGE_KEY])
  }

  /**
   * Remove a chapter from downloaded list by canonical chapter ID.
   */
  async removeDownloadedChapter(
    siteIntegrationId: string,
    seriesId: string,
    chapterId: string
  ): Promise<void> {
    await this.mutationQueue.run(async () => {
      try {
        const [existing, historyResult, cutoffResult] = await Promise.all([
          this.getDownloadedChapters(),
          chrome.storage.local.get([this.SERIES_HISTORY_KEY]),
          chrome.storage.local.get([this.CLEAR_CUTOFFS_KEY]),
        ])
        const filtered = existing.filter(
          (chapter) =>
            chapter.siteIntegrationId !== siteIntegrationId ||
            chapter.seriesId !== seriesId ||
            chapter.chapterId !== chapterId
        )
        const allHistory = parseSeriesHistoryMap(
          historyResult[this.SERIES_HISTORY_KEY]
        )
        const seriesKey = composeSeriesKey(siteIntegrationId, seriesId)
        const seriesHistory = allHistory[seriesKey]
        if (seriesHistory) {
          seriesHistory.downloadedChapters =
            seriesHistory.downloadedChapters.filter(
              (chapter) => chapter.chapterId !== chapterId
            )
          if (seriesHistory.downloadedChapters.length === 0) {
            delete allHistory[seriesKey]
          }
        }
        const cutoffs = parseDownloadHistoryClearCutoffs(
          cutoffResult[this.CLEAR_CUTOFFS_KEY]
        )
        cutoffs.byChapter[
          composeDownloadedChapterKey(siteIntegrationId, seriesId, chapterId)
        ] = Date.now()

        await chrome.storage.local.set({
          [this.STORAGE_KEY]: filtered,
          [this.SERIES_HISTORY_KEY]: allHistory,
          [this.CLEAR_CUTOFFS_KEY]: cutoffs,
        })

        logger.info(
          `✅ Chapter removed from downloaded list: ${siteIntegrationId}/${seriesId}/${chapterId}`
        )
      } catch (error) {
        logger.error("❌ Failed to remove downloaded chapter:", error)
        throw error
      }
    })
  }

  /**
   * Get download history for a series
   */
  async getSeriesHistory(
    siteIntegrationId: string,
    seriesId: string
  ): Promise<SeriesDownloadHistory | null> {
    const result = await chrome.storage.local.get([this.SERIES_HISTORY_KEY])
    const allHistory = parseSeriesHistoryMap(result[this.SERIES_HISTORY_KEY])
    return allHistory[composeSeriesKey(siteIntegrationId, seriesId)] || null
  }

  async getAllSeriesHistory(): Promise<SeriesDownloadHistory[]> {
    const result = await chrome.storage.local.get([this.SERIES_HISTORY_KEY])
    return Object.values(parseSeriesHistoryMap(result[this.SERIES_HISTORY_KEY]))
  }

  /**
   * Apply a series history update to the in-memory map (pure — no storage write).
   */
  private applySeriesHistoryUpdate(
    allHistory: Record<string, SeriesDownloadHistory>,
    record: DownloadedChapterRecord
  ): void {
    const seriesKey = composeSeriesKey(
      record.siteIntegrationId,
      record.seriesId
    )
    if (!allHistory[seriesKey]) {
      allHistory[seriesKey] = {
        siteIntegrationId: record.siteIntegrationId,
        seriesId: record.seriesId,
        seriesTitle: record.seriesTitle,
        lastUpdated: record.downloadedAt,
        downloadedChapters: [],
      }
    }

    const seriesHistory = allHistory[seriesKey]

    // Remove existing record for this chapter
    seriesHistory.downloadedChapters = seriesHistory.downloadedChapters.filter(
      (ch) => ch.chapterId !== record.chapterId
    )

    // Add new record
    seriesHistory.downloadedChapters.push(record)
    seriesHistory.lastUpdated = record.downloadedAt

    // Sort by full chapter title (no reliance on parsed numbers)
    seriesHistory.downloadedChapters.sort((a, b) => {
      const opts: Intl.CollatorOptions = { numeric: true, sensitivity: "base" }
      return a.title.localeCompare(b.title, undefined, opts)
    })
  }

  /**
   * Clear all download history
   */
  async clearAllDownloadHistory(): Promise<void> {
    await this.mutationQueue.run(async () => {
      try {
        await chrome.storage.local.set({
          [this.STORAGE_KEY]: [],
          [this.SERIES_HISTORY_KEY]: {},
          [this.CLEAR_CUTOFFS_KEY]: {
            allBefore: Date.now(),
            bySeries: {},
            byChapter: {},
          } satisfies DownloadHistoryClearCutoffs,
        })
        logger.info("✅ Cleared all download history")
      } catch (error) {
        logger.error("❌ Failed to clear all download history:", error)
        throw error
      }
    })
  }

  /**
   * Clear download history for a specific series
   */
  async clearSeriesDownloadHistory(
    siteIntegrationId: string,
    seriesId: string
  ): Promise<void> {
    await this.mutationQueue.run(async () => {
      try {
        const [existing, historyResult, cutoffResult] = await Promise.all([
          this.getDownloadedChapters(),
          chrome.storage.local.get([this.SERIES_HISTORY_KEY]),
          chrome.storage.local.get([this.CLEAR_CUTOFFS_KEY]),
        ])
        const filtered = existing.filter(
          (chapter) =>
            chapter.siteIntegrationId !== siteIntegrationId ||
            chapter.seriesId !== seriesId
        )
        const allHistory = parseSeriesHistoryMap(
          historyResult[this.SERIES_HISTORY_KEY]
        )
        const seriesKey = composeSeriesKey(siteIntegrationId, seriesId)
        delete allHistory[seriesKey]
        const cutoffs = parseDownloadHistoryClearCutoffs(
          cutoffResult[this.CLEAR_CUTOFFS_KEY]
        )
        cutoffs.bySeries[seriesKey] = Date.now()

        await chrome.storage.local.set({
          [this.STORAGE_KEY]: filtered,
          [this.SERIES_HISTORY_KEY]: allHistory,
          [this.CLEAR_CUTOFFS_KEY]: cutoffs,
        })

        logger.info(
          `✅ Cleared download history for series: ${siteIntegrationId}/${seriesId}`
        )
      } catch (error) {
        logger.error("❌ Failed to clear series download history:", error)
        throw error
      }
    })
  }

  /**
   * Clean up old download records (older than specified days)
   */
  async cleanupOldRecords(olderThanDays: number = 90): Promise<void> {
    await this.mutationQueue.run(async () => {
      try {
        const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000

        const [existing, cutoffResult] = await Promise.all([
          this.getDownloadedChapters(),
          chrome.storage.local.get([this.CLEAR_CUTOFFS_KEY]),
        ])
        const filtered = existing.filter((ch) => ch.downloadedAt > cutoffTime)
        const retainedHistory: Record<string, SeriesDownloadHistory> = {}
        filtered.forEach((record) =>
          this.applySeriesHistoryUpdate(retainedHistory, record)
        )
        const cutoffs = parseDownloadHistoryClearCutoffs(
          cutoffResult[this.CLEAR_CUTOFFS_KEY]
        )
        const clearedAt = Date.now()
        existing
          .filter((chapter) => chapter.downloadedAt <= cutoffTime)
          .forEach((chapter) => {
            cutoffs.byChapter[
              composeDownloadedChapterKey(
                chapter.siteIntegrationId,
                chapter.seriesId,
                chapter.chapterId
              )
            ] = clearedAt
          })

        await chrome.storage.local.set({
          [this.STORAGE_KEY]: filtered,
          [this.SERIES_HISTORY_KEY]: retainedHistory,
          [this.CLEAR_CUTOFFS_KEY]: cutoffs,
        })

        logger.info(
          `✅ Cleaned up ${existing.length - filtered.length} old download records`
        )
      } catch (error) {
        logger.error("❌ Failed to cleanup old records:", error)
        throw error
      }
    })
  }

  /**
   * Get storage usage statistics
   */
  async getStorageStats(): Promise<{
    totalChapters: number
    totalSeries: number
    oldestDownload: number | null
    newestDownload: number | null
  }> {
    const chapters = await this.getDownloadedChapters()
    const result = await chrome.storage.local.get([this.SERIES_HISTORY_KEY])
    const seriesHistory = parseSeriesHistoryMap(result[this.SERIES_HISTORY_KEY])

    const timestamps = chapters.map((ch) => ch.downloadedAt).filter(Boolean)

    return {
      totalChapters: chapters.length,
      totalSeries: Object.keys(seriesHistory).length,
      oldestDownload: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestDownload: timestamps.length > 0 ? Math.max(...timestamps) : null,
    }
  }
}

// Export singleton instance
export const chapterPersistenceService = new ChapterPersistenceService()
