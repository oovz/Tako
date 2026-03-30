import { describe, expect, it } from 'vitest';
import { chapterPersistenceService } from './chapter-persistence-service-test-setup';
import type { DownloadedChapterRecord } from './chapter-persistence-service-test-setup';

export function registerChapterPersistenceCrudCases(): void {
  describe('Download History CRUD', () => {
    it('should mark a chapter as downloaded', async () => {
      const record: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        chapterNumber: 1,
        downloadedAt: Date.now(),
        format: 'cbz',
      };

      await chapterPersistenceService.markChapterAsDownloaded(record);

      const downloaded = await chapterPersistenceService.getDownloadedChapters();
      expect(downloaded).toHaveLength(1);
      expect(downloaded[0]).toMatchObject(record);
    });

    it('should check if chapter is downloaded', async () => {
      const record: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        downloadedAt: Date.now(),
        format: 'cbz',
      };

      await chapterPersistenceService.markChapterAsDownloaded(record);

      const isDownloaded = await chapterPersistenceService.isChapterDownloaded('ch1');
      expect(isDownloaded).toBe(true);

      const notDownloaded = await chapterPersistenceService.isChapterDownloaded('ch999');
      expect(notDownloaded).toBe(false);
    });

    it('should get all downloaded chapters', async () => {
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
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          downloadedAt: Date.now(),
          format: 'cbz',
        },
      ];

      for (const record of records) {
        await chapterPersistenceService.markChapterAsDownloaded(record);
      }

      const downloaded = await chapterPersistenceService.getDownloadedChapters();
      expect(downloaded).toHaveLength(2);
    });

    it('should remove a downloaded chapter', async () => {
      const record: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        downloadedAt: Date.now(),
        format: 'cbz',
      };

      await chapterPersistenceService.markChapterAsDownloaded(record);
      await chapterPersistenceService.removeDownloadedChapter('ch1');

      const downloaded = await chapterPersistenceService.getDownloadedChapters();
      expect(downloaded).toHaveLength(0);
    });

    it('should replace existing record when re-downloading chapter', async () => {
      const record1: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        downloadedAt: 1000,
        format: 'zip',
      };

      const record2: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        downloadedAt: 2000,
        format: 'cbz',
      };

      await chapterPersistenceService.markChapterAsDownloaded(record1);
      await chapterPersistenceService.markChapterAsDownloaded(record2);

      const downloaded = await chapterPersistenceService.getDownloadedChapters();
      expect(downloaded).toHaveLength(1);
      expect(downloaded[0].downloadedAt).toBe(2000);
      expect(downloaded[0].format).toBe('cbz');
    });
  });

  describe('Series-Specific Operations', () => {
    it('should get downloaded chapters for a specific series', async () => {
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
        {
          chapterId: 'series1-ch2',
          url: 'https://example.com/series1/ch2',
          title: 'Chapter 2',
          seriesId: 'series-1',
          seriesTitle: 'Manga A',
          downloadedAt: Date.now(),
          format: 'cbz',
        },
      ];

      for (const record of records) {
        await chapterPersistenceService.markChapterAsDownloaded(record);
      }

      const series1Chapters = await chapterPersistenceService.getDownloadedChaptersForSeries('series-1');
      expect(series1Chapters).toHaveLength(2);
      expect(series1Chapters.every((ch: DownloadedChapterRecord) => ch.seriesId === 'series-1')).toBe(true);
    });

    it('should get series history', async () => {
      const record: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        chapterNumber: 1,
        downloadedAt: Date.now(),
        format: 'cbz',
      };

      await chapterPersistenceService.markChapterAsDownloaded(record);

      const history = await chapterPersistenceService.getSeriesHistory('series-1');
      expect(history).not.toBeNull();
      expect(history?.seriesId).toBe('series-1');
      expect(history?.downloadedChapters).toHaveLength(1);
    });

    it('should return null for non-existent series history', async () => {
      const history = await chapterPersistenceService.getSeriesHistory('non-existent');
      expect(history).toBeNull();
    });

    it('should update series history on new download', async () => {
      const record1: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        chapterNumber: 1,
        downloadedAt: 1000,
        format: 'cbz',
      };

      const record2: DownloadedChapterRecord = {
        chapterId: 'ch2',
        url: 'https://example.com/ch2',
        title: 'Chapter 2',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        chapterNumber: 2,
        downloadedAt: 2000,
        format: 'cbz',
      };

      await chapterPersistenceService.markChapterAsDownloaded(record1);
      await chapterPersistenceService.markChapterAsDownloaded(record2);

      const history = await chapterPersistenceService.getSeriesHistory('series-1');
      expect(history?.downloadedChapters).toHaveLength(2);
      expect(history?.lastUpdated).toBe(2000);
    });

    it('should sort chapters by title in series history', async () => {
      const records: DownloadedChapterRecord[] = [
        {
          chapterId: 'ch10',
          url: 'https://example.com/ch10',
          title: 'Chapter 10',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          chapterNumber: 10,
          downloadedAt: Date.now(),
          format: 'cbz',
        },
        {
          chapterId: 'ch2',
          url: 'https://example.com/ch2',
          title: 'Chapter 2',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          chapterNumber: 2,
          downloadedAt: Date.now(),
          format: 'cbz',
        },
        {
          chapterId: 'ch1',
          url: 'https://example.com/ch1',
          title: 'Chapter 1',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          chapterNumber: 1,
          downloadedAt: Date.now(),
          format: 'cbz',
        },
      ];

      for (const record of records) {
        await chapterPersistenceService.markChapterAsDownloaded(record);
      }

      const history = await chapterPersistenceService.getSeriesHistory('series-1');
      expect(history?.downloadedChapters[0].title).toBe('Chapter 1');
      expect(history?.downloadedChapters[1].title).toBe('Chapter 2');
      expect(history?.downloadedChapters[2].title).toBe('Chapter 10');
    });
  });
}
