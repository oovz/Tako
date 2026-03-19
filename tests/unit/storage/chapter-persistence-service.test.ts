/**
 * Unit Tests: Chapter Persistence Service
 * 
 * Tests download history tracking, NEW badge logic,
 * CRUD operations, series history, and storage cleanup.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DownloadedChapterRecord } from '@/src/storage/chapter-persistence-service';

// Mock chrome.storage.local
const mockStorageData: Record<string, any> = {};

globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn((keys: string[] | string) => {
        const result: Record<string, any> = {};
        const keyArray = Array.isArray(keys) ? keys : [keys];
        keyArray.forEach(key => {
          if (key in mockStorageData) {
            result[key] = mockStorageData[key];
          }
        });
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, any>) => {
        Object.assign(mockStorageData, items);
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        keyArray.forEach(key => delete mockStorageData[key]);
        return Promise.resolve();
      })
    }
  }
} as any;

// Mock logger
vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  }
}));

// Dynamic import to get the service after mocks are set up
let chapterPersistenceService: any;

describe('Chapter Persistence Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear mock storage
    Object.keys(mockStorageData).forEach(key => delete mockStorageData[key]);
    
    // Import service fresh each test
    const module = await import('@/src/storage/chapter-persistence-service');
    chapterPersistenceService = module.chapterPersistenceService;
  });

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
        format: 'cbz'
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
        format: 'cbz'
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
          format: 'cbz'
        },
        {
          chapterId: 'ch2',
          url: 'https://example.com/ch2',
          title: 'Chapter 2',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          downloadedAt: Date.now(),
          format: 'cbz'
        }
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
        format: 'cbz'
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
        format: 'zip'
      };

      const record2: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        downloadedAt: 2000,
        format: 'cbz'
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
          format: 'cbz'
        },
        {
          chapterId: 'series2-ch1',
          url: 'https://example.com/series2/ch1',
          title: 'Chapter 1',
          seriesId: 'series-2',
          seriesTitle: 'Manga B',
          downloadedAt: Date.now(),
          format: 'cbz'
        },
        {
          chapterId: 'series1-ch2',
          url: 'https://example.com/series1/ch2',
          title: 'Chapter 2',
          seriesId: 'series-1',
          seriesTitle: 'Manga A',
          downloadedAt: Date.now(),
          format: 'cbz'
        }
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
        format: 'cbz'
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
        format: 'cbz'
      };

      const record2: DownloadedChapterRecord = {
        chapterId: 'ch2',
        url: 'https://example.com/ch2',
        title: 'Chapter 2',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        chapterNumber: 2,
        downloadedAt: 2000,
        format: 'cbz'
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
          format: 'cbz'
        },
        {
          chapterId: 'ch2',
          url: 'https://example.com/ch2',
          title: 'Chapter 2',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          chapterNumber: 2,
          downloadedAt: Date.now(),
          format: 'cbz'
        },
        {
          chapterId: 'ch1',
          url: 'https://example.com/ch1',
          title: 'Chapter 1',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          chapterNumber: 1,
          downloadedAt: Date.now(),
          format: 'cbz'
        }
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
          format: 'cbz'
        },
        {
          chapterId: 'ch2',
          url: 'https://example.com/ch2',
          title: 'Chapter 2',
          seriesId: 'series-2',
          seriesTitle: 'Another Manga',
          downloadedAt: Date.now(),
          format: 'cbz'
        }
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
          format: 'cbz'
        },
        {
          chapterId: 'series2-ch1',
          url: 'https://example.com/series2/ch1',
          title: 'Chapter 1',
          seriesId: 'series-2',
          seriesTitle: 'Manga B',
          downloadedAt: Date.now(),
          format: 'cbz'
        }
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
      const old = now - (100 * 24 * 60 * 60 * 1000); // 100 days ago
      const recent = now - (10 * 24 * 60 * 60 * 1000); // 10 days ago

      const records: DownloadedChapterRecord[] = [
        {
          chapterId: 'old',
          url: 'https://example.com/old',
          title: 'Old Chapter',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          downloadedAt: old,
          format: 'cbz'
        },
        {
          chapterId: 'recent',
          url: 'https://example.com/recent',
          title: 'Recent Chapter',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          downloadedAt: recent,
          format: 'cbz'
        }
      ];

      for (const record of records) {
        await chapterPersistenceService.markChapterAsDownloaded(record);
      }

      await chapterPersistenceService.cleanupOldRecords(90); // Remove older than 90 days

      const downloaded = await chapterPersistenceService.getDownloadedChapters();
      expect(downloaded).toHaveLength(1);
      expect(downloaded[0].title).toBe('Recent Chapter');
    });

    it('should not remove records within retention period', async () => {
      const now = Date.now();
      const recent = now - (30 * 24 * 60 * 60 * 1000); // 30 days ago

      const record: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        downloadedAt: recent,
        format: 'cbz'
      };

      await chapterPersistenceService.markChapterAsDownloaded(record);
      await chapterPersistenceService.cleanupOldRecords(90); // Remove older than 90 days

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
          format: 'cbz'
        },
        {
          chapterId: 'series2-ch1',
          url: 'https://example.com/series2/ch1',
          title: 'Chapter 1',
          seriesId: 'series-2',
          seriesTitle: 'Manga B',
          downloadedAt: 2000,
          format: 'cbz'
        }
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

  describe('Downloaded Status Checks', () => {
    it('should distinguish downloaded chapters from undownloaded chapters', async () => {
      // Download chapter 1
      const downloadedRecord: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        downloadedAt: Date.now(),
        format: 'cbz'
      };

      await chapterPersistenceService.markChapterAsDownloaded(downloadedRecord);

      // Check downloaded chapter
      const isChapter1Downloaded = await chapterPersistenceService.isChapterDownloaded('ch1');
      expect(isChapter1Downloaded).toBe(true);

      // Check undownloaded chapter
      const isChapter2Downloaded = await chapterPersistenceService.isChapterDownloaded('ch2');
      expect(isChapter2Downloaded).toBe(false);
    });

    it('should support list-level downloaded status checks', async () => {
      // Download some chapters
      const downloaded: DownloadedChapterRecord[] = [
        {
          chapterId: 'ch1',
          url: 'https://example.com/ch1',
          title: 'Chapter 1',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          downloadedAt: Date.now(),
          format: 'cbz'
        },
        {
          chapterId: 'ch3',
          url: 'https://example.com/ch3',
          title: 'Chapter 3',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          downloadedAt: Date.now(),
          format: 'cbz'
        }
      ];

      for (const record of downloaded) {
        await chapterPersistenceService.markChapterAsDownloaded(record);
      }

      // Simulate checking chapter list
      const chapterList = [
        { id: 'ch1', url: 'https://example.com/ch1', title: 'Chapter 1' },
        { id: 'ch2', url: 'https://example.com/ch2', title: 'Chapter 2' },
        { id: 'ch3', url: 'https://example.com/ch3', title: 'Chapter 3' }
      ];

      const downloadedStatus = await Promise.all(
        chapterList.map(async (ch) => ({
          ...ch,
          isDownloaded: await chapterPersistenceService.isChapterDownloaded(ch.id)
        }))
      );

      expect(downloadedStatus[0].isDownloaded).toBe(true);
      expect(downloadedStatus[1].isDownloaded).toBe(false);
      expect(downloadedStatus[2].isDownloaded).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle storage errors gracefully when checking download status', async () => {
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage error'));

      const isDownloaded = await chapterPersistenceService.isChapterDownloaded('ch1');
      expect(isDownloaded).toBe(false); // Defaults to false on error
    });

    it('should handle storage errors gracefully when getting series chapters', async () => {
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage error'));

      const chapters = await chapterPersistenceService.getDownloadedChaptersForSeries('series-1');
      expect(chapters).toEqual([]); // Returns empty array on error
    });

    it('should handle storage errors gracefully when getting stats', async () => {
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage error'));

      const stats = await chapterPersistenceService.getStorageStats();
      expect(stats.totalChapters).toBe(0);
      expect(stats.totalSeries).toBe(0);
    });
  });
});

