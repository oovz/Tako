import { describe, expect, it, vi } from 'vitest';
import type { MangaPageState } from '@/src/types/tab-state';
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys';
import { mockSessionStorage } from './centralized-state-test-setup';

export function registerCentralizedStateTabUpdateCases(): void {
  describe('Selection Drift Guards', () => {
    it('keeps activeTabContext synchronized without shared selection flags', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      vi.mocked(chrome.tabs.query).mockResolvedValueOnce([{ id: 1 } as chrome.tabs.Tab]);

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-active',
        seriesTitle: 'Active Series',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, chapterNumber: 1, status: 'queued', lastUpdated: Date.now() },
          { id: 'ch2', url: 'ch2', title: 'Chapter 2', index: 2, chapterNumber: 2, status: 'queued', lastUpdated: Date.now() },
        ],
        volumes: [],
      });

      const activeTabContext = mockSessionStorage[SESSION_STORAGE_KEYS.activeTabContext] as MangaPageState | undefined;
      expect(activeTabContext?.mangaId).toBe('series-active');
      expect('selected' in (activeTabContext?.chapters[0] ?? {})).toBe(false);
      expect('selected' in (activeTabContext?.chapters[1] ?? {})).toBe(false);
    });

    it('ignores stale session selection keys during tab initialization', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      mockSessionStorage['selection:mangadex:stale-series'] = ['ch1'];

      await stateManager.initializeTabState(
        7,
        'mangadex',
        'stale-series',
        'Stale Selection Test',
        [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, chapterNumber: 1 },
          { id: 'ch2', url: 'ch2', title: 'Chapter 2', index: 2, chapterNumber: 2 },
        ],
      );

      const tabState = await stateManager.getTabState(7);
      expect('selected' in (tabState?.chapters[0] ?? {})).toBe(false);
      expect('selected' in (tabState?.chapters[1] ?? {})).toBe(false);
    });
  });

  describe('Chapter State Updates', () => {
    it('updates chapter status', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'test',
        seriesTitle: 'Test',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, chapterNumber: 1, status: 'queued', lastUpdated: Date.now() },
        ],
        volumes: [],
      });

      await stateManager.updateChapterState(1, 'ch1', 'downloading', { progress: 50 });

      const tabState = await stateManager.getTabState(1);
      expect(tabState?.chapters[0].status).toBe('downloading');
      expect(tabState?.chapters[0].progress).toBe(50);
    });

    it('prevents downgrading completed status', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'test',
        seriesTitle: 'Test',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, chapterNumber: 1, status: 'completed', lastUpdated: Date.now() },
        ],
        volumes: [],
      });

      await stateManager.updateChapterState(1, 'ch1', 'downloading');

      const tabState = await stateManager.getTabState(1);
      expect(tabState?.chapters[0].status).toBe('completed');
    });

    it('handles updating non-existent chapter gracefully', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'test',
        seriesTitle: 'Test',
        chapters: [],
        volumes: [],
      });

      await expect(stateManager.updateChapterState(1, 'non-existent', 'downloading'))
        .resolves.toBeUndefined();
    });
  });

  describe('per-image progress for active task', () => {
    it('stores image progress within chapter state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'test',
        seriesTitle: 'Test',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, chapterNumber: 1, status: 'downloading', lastUpdated: Date.now() },
        ],
        volumes: [],
      });

      await stateManager.updateChapterState(1, 'ch1', 'downloading', {
        progress: 50,
      });

      const tabState = await stateManager.getTabState(1);
      expect(tabState?.chapters[0].status).toBe('downloading');
      expect(tabState?.chapters[0].progress).toBe(50);
    });

    it('tracks progress for single-chapter downloads', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'single-chapter-series',
        seriesTitle: 'One-shot Manga',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Oneshot', index: 1, chapterNumber: 1, status: 'queued', lastUpdated: Date.now() },
        ],
        volumes: [],
      });

      await stateManager.updateChapterState(1, 'ch1', 'downloading', { progress: 0 });
      let tabState = await stateManager.getTabState(1);
      expect(tabState?.chapters[0].progress).toBe(0);

      await stateManager.updateChapterState(1, 'ch1', 'downloading', { progress: 50 });
      tabState = await stateManager.getTabState(1);
      expect(tabState?.chapters[0].progress).toBe(50);

      await stateManager.updateChapterState(1, 'ch1', 'completed', { progress: 100 });
      tabState = await stateManager.getTabState(1);
      expect(tabState?.chapters[0].status).toBe('completed');
      expect(tabState?.chapters[0].progress).toBe(100);
    });

    it('drops legacy chapter progress and downloadId when reinitializing the same tab state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'legacy-progress-series',
        seriesTitle: 'Legacy Progress Series',
        chapters: [
          {
            id: 'ch1',
            url: 'https://example.com/ch1',
            title: 'Chapter 1',
            index: 1,
            chapterNumber: 1,
            status: 'downloading',
            progress: 50,
            downloadId: 'download-1',
            lastUpdated: Date.now(),
          },
        ],
        volumes: [],
      });

      await stateManager.initializeTabState(
        1,
        'mangadex',
        'legacy-progress-series',
        'Legacy Progress Series',
        [
          {
            id: 'ch1',
            url: 'https://example.com/ch1',
            title: 'Chapter 1',
            index: 1,
            chapterNumber: 1,
          },
        ],
      );

      const tabState = await stateManager.getTabState(1);
      expect(tabState?.chapters[0].status).toBe('downloading');
      expect(tabState?.chapters[0]).not.toHaveProperty('progress');
      expect(tabState?.chapters[0]).not.toHaveProperty('downloadId');
    });
  });
}
