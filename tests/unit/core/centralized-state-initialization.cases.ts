import { describe, expect, it } from 'vitest';
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys';
import type { GlobalAppState } from '@/src/types/queue-state';
import type { MangaPageState } from '@/src/types/tab-state';
import { mockLocalStorage, mockSessionStorage, makeDownloadTask } from './centralized-state-test-setup';

export function registerCentralizedStateInitializationCases(): void {
  describe('State Initialization', () => {
    it('initializes with setAccessLevel call', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      expect(chrome.storage.session.setAccessLevel).toHaveBeenCalledWith({
        accessLevel: 'TRUSTED_CONTEXTS',
      });
    });

    it('creates global state on initialization', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      expect(mockSessionStorage[SESSION_STORAGE_KEYS.globalState]).toBeDefined();
      const globalState = mockSessionStorage[SESSION_STORAGE_KEYS.globalState] as GlobalAppState;
      expect(globalState.downloadQueue).toEqual([]);
      expect(globalState.settings).toBeDefined();
    });

    it('hydrates session global state from persisted local download queue on initialization', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      mockLocalStorage.downloadQueue = [
        makeDownloadTask({ id: 'persisted-task', mangaId: 'series-1', seriesTitle: 'Persisted Series', created: 123 }),
      ];

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      const globalState = mockSessionStorage[SESSION_STORAGE_KEYS.globalState] as GlobalAppState;
      expect(globalState.downloadQueue).toEqual(mockLocalStorage.downloadQueue);
    });
  });

  describe('Tab State Operations', () => {
    it('creates and retrieves tab state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      const tabState: Partial<MangaPageState> = {
        siteIntegrationId: 'mangadex',
        mangaId: 'test-123',
        seriesTitle: 'Test Manga',
        chapters: [],
        volumes: [],
      };

      await stateManager.updateTabState(1, tabState);

      const retrieved = await stateManager.getTabState(1);
      expect(retrieved).toBeDefined();
      expect(retrieved?.siteIntegrationId).toBe('mangadex');
      expect(retrieved?.mangaId).toBe('test-123');
      expect(retrieved?.seriesTitle).toBe('Test Manga');
    });

    it('accepts canonical manga page state field names', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.updateTabState(3, {
        siteIntegrationId: 'mangadex',
        mangaId: 'canonical-123',
        seriesTitle: 'Canonical Manga',
        chapters: [],
        volumes: [],
      } as unknown as Partial<MangaPageState>);

      const retrieved = await stateManager.getTabState(3);
      expect(retrieved).toEqual(
        expect.objectContaining({
          siteIntegrationId: 'mangadex',
          mangaId: 'canonical-123',
          seriesTitle: 'Canonical Manga',
          volumes: [],
        }),
      );
    });

    it('stores canonical tab state fields when initializing a series tab', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.initializeTabState(
        4,
        'mangadex',
        'canonical-series',
        'Canonical Series',
        [],
      );

      expect(mockSessionStorage.tab_4).toEqual(
        expect.objectContaining({
          siteIntegrationId: 'mangadex',
          mangaId: 'canonical-series',
          seriesTitle: 'Canonical Series',
          volumes: [],
        }),
      );
    });

    it('derives canonical volume state from chapter metadata during tab initialization', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.initializeTabState(
        44,
        'mangadex',
        'volume-series',
        'Volume Series',
        [
          {
            id: 'chapter-1',
            url: 'https://example.com/chapter-1',
            title: 'Chapter 1',
            index: 1,
            volumeNumber: 2,
            volumeLabel: 'Vol. 2',
          },
          {
            id: 'chapter-2',
            url: 'https://example.com/chapter-2',
            title: 'Chapter 2',
            index: 2,
            volumeNumber: 1,
            volumeLabel: 'Vol. 1',
          },
          {
            id: 'chapter-3',
            url: 'https://example.com/chapter-3',
            title: 'Chapter 3',
            index: 3,
            volumeNumber: 2,
            volumeLabel: 'Vol. 2',
          },
        ],
      );

      expect(mockSessionStorage.tab_44).toEqual(
        expect.objectContaining({
          siteIntegrationId: 'mangadex',
          mangaId: 'volume-series',
          seriesTitle: 'Volume Series',
          volumes: [
            { id: 'volume-1', title: 'Vol. 1', label: 'Vol. 1' },
            { id: 'volume-2', title: 'Vol. 2', label: 'Vol. 2' },
          ],
        }),
      );
    });

    it('preserves explicit integration-provided volumes during tab initialization', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.initializeTabState(
        45,
        'shonenjumpplus',
        'custom-volume-series',
        'Custom Volume Series',
        [
          {
            id: 'chapter-1',
            url: 'https://example.com/chapter-1',
            title: 'Chapter 1',
            index: 1,
            volumeNumber: 2,
            volumeLabel: 'Arc B',
          },
        ],
        undefined,
        [
          { id: 'custom-volume-b', title: 'Arc B', label: 'Arc B' },
          { id: 'custom-volume-a', title: 'Arc A', label: 'Arc A' },
        ],
      );

      expect(mockSessionStorage.tab_45).toEqual(
        expect.objectContaining({
          siteIntegrationId: 'shonenjumpplus',
          mangaId: 'custom-volume-series',
          seriesTitle: 'Custom Volume Series',
          volumes: [
            { id: 'custom-volume-b', title: 'Arc B', label: 'Arc B' },
            { id: 'custom-volume-a', title: 'Arc A', label: 'Arc A' },
          ],
        }),
      );
    });

    it('isolates state between tabs', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'manga-1',
        seriesTitle: 'Manga 1',
        chapters: [],
        volumes: [],
      });

      await stateManager.updateTabState(2, {
        siteIntegrationId: 'mangadex',
        mangaId: 'manga-2',
        seriesTitle: 'Manga 2',
        chapters: [],
        volumes: [],
      });

      const tab1State = await stateManager.getTabState(1);
      const tab2State = await stateManager.getTabState(2);

      expect(tab1State?.mangaId).toBe('manga-1');
      expect(tab2State?.mangaId).toBe('manga-2');
    });

    it('updates existing tab state', async () => {
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

      await stateManager.updateTabState(1, {
        mangaId: 'test-updated',
      });

      const tabState = await stateManager.getTabState(1);
      expect(tabState?.mangaId).toBe('test-updated');
      expect(tabState?.seriesTitle).toBe('Test');
    });

    it('does not expose the removed per-tab format action in the runtime enum', async () => {
      const { StateAction } = await import('@/src/types/state-actions');

      expect('SET_TAB_DOWNLOAD_FORMAT' in StateAction).toBe(false);
    });

    it('preserves declared tab-state fields without runtime compatibility transforms', async () => {
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

      await stateManager.updateTabState(1, {
        metadata: {
          author: 'Author',
        },
      });

      const tabState = await stateManager.getTabState(1);
      expect(tabState).toEqual(
        expect.objectContaining({
          mangaId: 'test',
          seriesTitle: 'Test',
          metadata: {
            author: 'Author',
          },
        }),
      );
    });

    it('returns null for non-existent tab', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      const tabState = await stateManager.getTabState(999);
      expect(tabState).toBeNull();
    });

    it('clears tab state', async () => {
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

      await stateManager.clearTabState(1);

      const tabState = await stateManager.getTabState(1);
      expect(tabState).toBeNull();
      expect(mockSessionStorage.tab_1).toBeUndefined();
    });
  });
}
