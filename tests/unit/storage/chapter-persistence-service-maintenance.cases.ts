import { describe, expect, it } from 'vitest';
import { chapterPersistenceService } from './chapter-persistence-service-test-setup';
import type { DownloadedChapterRecord } from './chapter-persistence-service-test-setup';

export function registerChapterPersistenceMaintenanceCases(): void {
  describe('Clear History Operations', () => {
    it('should clear all download history', async () => {
      const records: DownloadedChapterRecord[] = [
        {
          chapterId: 'ch1',
          url: 'https://example.com/ch1',
          title: 'Chapter 1',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          downloadedAt: Date.now(),
          format: 'cbz',
        },
        {
          chapterId: 'ch2',
          url: 'https://example.com/ch2',
          title: 'Chapter 2',
          seriesId: 'series-2',
          seriesTitle: 'Another Manga',
          downloadedAt: Date.now(),
          format: 'cbz',
        },
      ];

      for (const record of records) {
        await chapterPersistenceService.markChapterAsDownloaded(record);
      }

      await chapterPersistenceService.clearAllDownloadHistory();

      const downloaded = await chapterPersistenceService.getDownloadedChapters();
      expect(downloaded).toHaveLength(0);
    });

    it('should clear download history for specific series', async () => {
      const records: DownloadedChapterRecord[] = [
        {
          chapterId: 'series1-ch1',
          url: 'https://example.com/series1/ch1',
          title: 'Chapter 1',
          seriesId: 'series-1',
          seriesTitle: 'Manga A',
          downloadedAt: Date.now(),
          format: 'cbz',
        },
        {
          chapterId: 'series2-ch1',
          url: 'https://example.com/series2/ch1',
          title: 'Chapter 1',
          seriesId: 'series-2',
          seriesTitle: 'Manga B',
          downloadedAt: Date.now(),
          format: 'cbz',
        },
      ];

      for (const record of records) {
        await chapterPersistenceService.markChapterAsDownloaded(record);
      }

      await chapterPersistenceService.clearSeriesDownloadHistory('series-1');

      const allDownloaded = await chapterPersistenceService.getDownloadedChapters();
      expect(allDownloaded).toHaveLength(1);
      expect(allDownloaded[0].seriesId).toBe('series-2');

      const series1History = await chapterPersistenceService.getSeriesHistory('series-1');
      expect(series1History).toBeNull();
    });
  });

  describe('Cleanup and Maintenance', () => {
    it('should cleanup old download records', async () => {
      const now = Date.now();
      const old = now - (100 * 24 * 60 * 60 * 1000);
      const recent = now - (10 * 24 * 60 * 60 * 1000);

      const records: DownloadedChapterRecord[] = [
        {
          chapterId: 'old',
          url: 'https://example.com/old',
          title: 'Old Chapter',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          downloadedAt: old,
          format: 'cbz',
        },
        {
          chapterId: 'recent',
          url: 'https://example.com/recent',
          title: 'Recent Chapter',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          downloadedAt: recent,
          format: 'cbz',
        },
      ];

      for (const record of records) {
        await chapterPersistenceService.markChapterAsDownloaded(record);
      }

      await chapterPersistenceService.cleanupOldRecords(90);

      const downloaded = await chapterPersistenceService.getDownloadedChapters();
      expect(downloaded).toHaveLength(1);
      expect(downloaded[0].title).toBe('Recent Chapter');
    });

    it('should not remove records within retention period', async () => {
      const now = Date.now();
      const recent = now - (30 * 24 * 60 * 60 * 1000);

      const record: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        downloadedAt: recent,
        format: 'cbz',
      };

      await chapterPersistenceService.markChapterAsDownloaded(record);
      await chapterPersistenceService.cleanupOldRecords(90);

      const downloaded = await chapterPersistenceService.getDownloadedChapters();
      expect(downloaded).toHaveLength(1);
    });
  });

  describe('Storage Statistics', () => {
    it('should get storage statistics', async () => {
      const records: DownloadedChapterRecord[] = [
        {
          chapterId: 'series1-ch1',
          url: 'https://example.com/series1/ch1',
          title: 'Chapter 1',
          seriesId: 'series-1',
          seriesTitle: 'Manga A',
          downloadedAt: 1000,
          format: 'cbz',
        },
        {
          chapterId: 'series2-ch1',
          url: 'https://example.com/series2/ch1',
          title: 'Chapter 1',
          seriesId: 'series-2',
          seriesTitle: 'Manga B',
          downloadedAt: 2000,
          format: 'cbz',
        },
      ];

      for (const record of records) {
        await chapterPersistenceService.markChapterAsDownloaded(record);
      }

      const stats = await chapterPersistenceService.getStorageStats();
      expect(stats.totalChapters).toBe(2);
      expect(stats.totalSeries).toBe(2);
      expect(stats.oldestDownload).toBe(1000);
      expect(stats.newestDownload).toBe(2000);
    });

    it('should return zero stats for empty storage', async () => {
      const stats = await chapterPersistenceService.getStorageStats();
      expect(stats.totalChapters).toBe(0);
      expect(stats.totalSeries).toBe(0);
      expect(stats.oldestDownload).toBeNull();
      expect(stats.newestDownload).toBeNull();
    });
  });
}
