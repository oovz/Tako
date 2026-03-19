/**
 * Chapter Persistence Service
 * 
 * Tracks downloaded chapters across sessions using chrome.storage.local
 * Provides persistent memory of what has been downloaded.
 *
 * Records are deduplicated and queried by canonical `chapterId`; `url` is
 * retained only as descriptive source metadata.
 */
import logger from '@/src/runtime/logger';
import { isRecord, type JsonValue } from '@/src/shared/type-guards';

export interface DownloadedChapterRecord {
  chapterId: string;
  url: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
  chapterNumber?: number;
  volumeNumber?: number;
  downloadedAt: number;
  filePath?: string;
  fileSize?: number;
  format: 'zip' | 'cbz' | 'cbr' | 'pdf' | 'none';
}

export interface SeriesDownloadHistory {
  seriesId: string;
  seriesTitle: string;
  lastUpdated: number;
  downloadedChapters: DownloadedChapterRecord[];
}

const VALID_FORMATS = ['zip', 'cbz', 'cbr', 'pdf', 'none'] as const;

const isDownloadedChapterRecord = (value: unknown): value is DownloadedChapterRecord => {
  if (!isRecord(value)) return false;
  const hasValidFormat =
    typeof value.format === 'string'
    && VALID_FORMATS.some((candidate) => candidate === value.format);
  return (
    typeof value.chapterId === 'string'
    && typeof value.url === 'string'
    && typeof value.title === 'string'
    && typeof value.seriesId === 'string'
    && typeof value.seriesTitle === 'string'
    && typeof value.downloadedAt === 'number'
    && hasValidFormat
  );
};

const parseDownloadedChapters = (raw: unknown): DownloadedChapterRecord[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isDownloadedChapterRecord);
};

const parseSeriesHistory = (value: JsonValue | undefined): SeriesDownloadHistory | null => {
  if (!isRecord(value)) return null;
  if (typeof value.seriesId !== 'string') return null;
  if (typeof value.seriesTitle !== 'string') return null;
  if (typeof value.lastUpdated !== 'number') return null;
  const downloadedChapters = parseDownloadedChapters(value.downloadedChapters);
  return {
    seriesId: value.seriesId,
    seriesTitle: value.seriesTitle,
    lastUpdated: value.lastUpdated,
    downloadedChapters,
  };
};

const parseSeriesHistoryMap = (raw: JsonValue | undefined): Record<string, SeriesDownloadHistory> => {
  if (!isRecord(raw)) return {};
  const entries: Record<string, SeriesDownloadHistory> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = parseSeriesHistory(value);
    if (parsed) entries[key] = parsed;
  }
  return entries;
};

class ChapterPersistenceService {
  private readonly STORAGE_KEY = 'downloadedChapters';
  private readonly SERIES_HISTORY_KEY = 'seriesDownloadHistory';
  
  /**
   * Mark a chapter as downloaded
   */
  async markChapterAsDownloaded(record: DownloadedChapterRecord): Promise<void> {
    try {
      // Get existing records
      const existing = await this.getDownloadedChapters();
      
      // Remove any existing record for this chapter (in case of re-download)
      const filtered = existing.filter(ch => ch.chapterId !== record.chapterId);
      
      // Add the new record
      filtered.push(record);
      
      // Store updated list
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: filtered
      });
      
      // Update series history
      await this.updateSeriesHistory(record);
      
  logger.info(`✅ Chapter marked as downloaded: ${record.title}`);
    } catch (error) {
  logger.error('❌ Failed to mark chapter as downloaded:', error);
      throw error;
    }
  }
  
  /**
   * Check if a chapter has been downloaded by canonical chapter ID.
   */
  async isChapterDownloaded(chapterId: string): Promise<boolean> {
    try {
      const downloaded = await this.getDownloadedChapters();
      return downloaded.some(ch => ch.chapterId === chapterId);
    } catch (error) {
      logger.error('❌ Failed to check chapter download status:', error);
      return false;
    }
  }
  
  /**
   * Get all downloaded chapters for a series
   */
  async getDownloadedChaptersForSeries(seriesId: string): Promise<DownloadedChapterRecord[]> {
    try {
      const allDownloaded = await this.getDownloadedChapters();
      return allDownloaded.filter(ch => ch.seriesId === seriesId);
    } catch (error) {
      logger.error('❌ Failed to get downloaded chapters for series:', error);
      return [];
    }
  }
  
  /**
   * Get all downloaded chapters
   */
  async getDownloadedChapters(): Promise<DownloadedChapterRecord[]> {
    try {
      const result = await chrome.storage.local.get([this.STORAGE_KEY]) as Record<string, JsonValue>;
      return parseDownloadedChapters(result[this.STORAGE_KEY]);
    } catch (error) {
      logger.error('❌ Failed to get downloaded chapters:', error);
      return [];
    }
  }
  
  /**
   * Remove a chapter from downloaded list by canonical chapter ID.
   */
  async removeDownloadedChapter(chapterId: string): Promise<void> {
    try {
      const existing = await this.getDownloadedChapters();
      const filtered = existing.filter(ch => ch.chapterId !== chapterId);
      
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: filtered
      });
      
  logger.info(`✅ Chapter removed from downloaded list: ${chapterId}`);
    } catch (error) {
  logger.error('❌ Failed to remove downloaded chapter:', error);
      throw error;
    }
  }
  
  /**
   * Get download history for a series
   */
  async getSeriesHistory(seriesId: string): Promise<SeriesDownloadHistory | null> {
    try {
      const result = await chrome.storage.local.get([this.SERIES_HISTORY_KEY]) as Record<string, JsonValue>;
      const allHistory = parseSeriesHistoryMap(result[this.SERIES_HISTORY_KEY]);
      return allHistory[seriesId] || null;
    } catch (error) {
      logger.error('❌ Failed to get series history:', error);
      return null;
    }
  }
  
  /**
   * Update series download history
   */
  private async updateSeriesHistory(record: DownloadedChapterRecord): Promise<void> {
    try {
      const result = await chrome.storage.local.get([this.SERIES_HISTORY_KEY]) as Record<string, JsonValue>;
      const allHistory = parseSeriesHistoryMap(result[this.SERIES_HISTORY_KEY]);
      
      if (!allHistory[record.seriesId]) {
        allHistory[record.seriesId] = {
          seriesId: record.seriesId,
          seriesTitle: record.seriesTitle,
          lastUpdated: record.downloadedAt,
          downloadedChapters: []
        };
      }
      
      const seriesHistory = allHistory[record.seriesId];
      
      // Remove existing record for this chapter
      seriesHistory.downloadedChapters = seriesHistory.downloadedChapters.filter(
        ch => ch.chapterId !== record.chapterId
      );
      
      // Add new record
      seriesHistory.downloadedChapters.push(record);
      seriesHistory.lastUpdated = record.downloadedAt;
      
      // Sort by full chapter title (no reliance on parsed numbers)
      seriesHistory.downloadedChapters.sort((a, b) => {
        const opts: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };
        return a.title.localeCompare(b.title, undefined, opts);
      });
      
      await chrome.storage.local.set({
        [this.SERIES_HISTORY_KEY]: allHistory
      });
    } catch (error) {
      logger.error('❌ Failed to update series history:', error);
      throw error;
    }
  }
  
  /**
   * Clear all download history
   */
  async clearAllDownloadHistory(): Promise<void> {
    try {
      await chrome.storage.local.remove([this.STORAGE_KEY, this.SERIES_HISTORY_KEY]);
      logger.info('✅ Cleared all download history');
    } catch (error) {
      logger.error('❌ Failed to clear all download history:', error);
      throw error;
    }
  }
  
  /**
   * Clear download history for a specific series
   */
  async clearSeriesDownloadHistory(seriesId: string): Promise<void> {
    try {
      // Remove chapters for this series
      const existing = await this.getDownloadedChapters();
      const filtered = existing.filter(ch => ch.seriesId !== seriesId);
      
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: filtered
      });
      
      // Remove series history entry
      const result = await chrome.storage.local.get([this.SERIES_HISTORY_KEY]) as Record<string, JsonValue>;
      const allHistory = parseSeriesHistoryMap(result[this.SERIES_HISTORY_KEY]);
      delete allHistory[seriesId];
      
      await chrome.storage.local.set({
        [this.SERIES_HISTORY_KEY]: allHistory
      });
      
      logger.info(`✅ Cleared download history for series: ${seriesId}`);
    } catch (error) {
      logger.error('❌ Failed to clear series download history:', error);
      throw error;
    }
  }
  
  /**
   * Clean up old download records (older than specified days)
   */
  async cleanupOldRecords(olderThanDays: number = 90): Promise<void> {
    try {
      const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
      
      const existing = await this.getDownloadedChapters();
      const filtered = existing.filter(ch => ch.downloadedAt > cutoffTime);
      
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: filtered
      });
      
  logger.info(`✅ Cleaned up ${existing.length - filtered.length} old download records`);
    } catch (error) {
  logger.error('❌ Failed to cleanup old records:', error);
      throw error;
    }
  }
  
  /**
   * Get storage usage statistics
   */
  async getStorageStats(): Promise<{
    totalChapters: number;
    totalSeries: number;
    oldestDownload: number | null;
    newestDownload: number | null;
  }> {
    try {
      const chapters = await this.getDownloadedChapters();
      const result = await chrome.storage.local.get([this.SERIES_HISTORY_KEY]) as Record<string, JsonValue>;
      const seriesHistory = parseSeriesHistoryMap(result[this.SERIES_HISTORY_KEY]);
      
      const timestamps = chapters.map(ch => ch.downloadedAt).filter(Boolean);
      
      return {
        totalChapters: chapters.length,
        totalSeries: Object.keys(seriesHistory).length,
        oldestDownload: timestamps.length > 0 ? Math.min(...timestamps) : null,
        newestDownload: timestamps.length > 0 ? Math.max(...timestamps) : null
      };
    } catch (error) {
      logger.error('❌ Failed to get storage stats:', error);
      return {
        totalChapters: 0,
        totalSeries: 0,
        oldestDownload: null,
        newestDownload: null
      };
    }
  }
}

// Export singleton instance
export const chapterPersistenceService = new ChapterPersistenceService();

