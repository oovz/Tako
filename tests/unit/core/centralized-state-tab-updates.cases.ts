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

}
