import { describe, expect, it, vi } from 'vitest';
import { chapterPersistenceService } from './chapter-persistence-service-test-setup';
import type { DownloadedChapterRecord } from './chapter-persistence-service-test-setup';

export function registerChapterPersistenceStatusAndErrorCases(): void {
  describe('Downloaded Status Checks', () => {
    it('should distinguish downloaded chapters from undownloaded chapters', async () => {
      const downloadedRecord: DownloadedChapterRecord = {
        chapterId: 'ch1',
        url: 'https://example.com/ch1',
        title: 'Chapter 1',
        seriesId: 'series-1',
        seriesTitle: 'Test Manga',
        downloadedAt: Date.now(),
        format: 'cbz',
      };

      await chapterPersistenceService.markChapterAsDownloaded(downloadedRecord);

      const isChapter1Downloaded = await chapterPersistenceService.isChapterDownloaded('ch1');
      expect(isChapter1Downloaded).toBe(true);

      const isChapter2Downloaded = await chapterPersistenceService.isChapterDownloaded('ch2');
      expect(isChapter2Downloaded).toBe(false);
    });

    it('should support list-level downloaded status checks', async () => {
      const downloaded: DownloadedChapterRecord[] = [
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
          chapterId: 'ch3',
          url: 'https://example.com/ch3',
          title: 'Chapter 3',
          seriesId: 'series-1',
          seriesTitle: 'Test Manga',
          downloadedAt: Date.now(),
          format: 'cbz',
        },
      ];

      for (const record of downloaded) {
        await chapterPersistenceService.markChapterAsDownloaded(record);
      }

      const chapterList = [
        { id: 'ch1', url: 'https://example.com/ch1', title: 'Chapter 1' },
        { id: 'ch2', url: 'https://example.com/ch2', title: 'Chapter 2' },
        { id: 'ch3', url: 'https://example.com/ch3', title: 'Chapter 3' },
      ];

      const downloadedStatus = await Promise.all(
        chapterList.map(async (ch) => ({
          ...ch,
          isDownloaded: await chapterPersistenceService.isChapterDownloaded(ch.id),
        })),
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
      expect(isDownloaded).toBe(false);
    });

    it('should handle storage errors gracefully when getting series chapters', async () => {
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage error'));

      const chapters = await chapterPersistenceService.getDownloadedChaptersForSeries('series-1');
      expect(chapters).toEqual([]);
    });

    it('should handle storage errors gracefully when getting stats', async () => {
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage error'));

      const stats = await chapterPersistenceService.getStorageStats();
      expect(stats.totalChapters).toBe(0);
      expect(stats.totalSeries).toBe(0);
    });
  });
}
