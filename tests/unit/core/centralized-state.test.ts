/**
 * @file centralized-state.test.ts
 * @description Unit tests for centralized state management
 * 
 * Tests:
 * - StateManager initialization  
 * - Tab state CRUD operations
 * - Global state management
 * - Active tab context synchronization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import type { DownloadTaskState, GlobalAppState } from '@/src/types/queue-state';
import type { MangaPageState } from '@/src/types/tab-state';
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys';

// Mock chrome.storage.session
const mockSessionStorage: Record<string, unknown> = {};
const mockLocalStorage: Record<string, unknown> = {};

globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn().mockImplementation((keys?: string | string[] | null) => {
        if (keys === undefined || keys === null) {
          return Promise.resolve(mockLocalStorage);
        }
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: mockLocalStorage[keys] });
        }
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in mockLocalStorage) {
            result[key] = mockLocalStorage[key];
          }
        }
        return Promise.resolve(result);
      }),
      set: vi.fn().mockImplementation((items: Record<string, unknown>) => {
        Object.assign(mockLocalStorage, items);
        return Promise.resolve();
      }),
      remove: vi.fn().mockImplementation((keys: string | string[]) => {
        const keysArray = typeof keys === 'string' ? [keys] : keys;
        keysArray.forEach(key => delete mockLocalStorage[key]);
        return Promise.resolve();
      }),
      clear: vi.fn().mockImplementation(() => {
        Object.keys(mockLocalStorage).forEach(key => delete mockLocalStorage[key]);
        return Promise.resolve();
      }),
    },
    session: {
      get: vi.fn().mockImplementation((keys?: string | string[] | null) => {
        if (keys === undefined || keys === null) {
          return Promise.resolve(mockSessionStorage);
        }
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: mockSessionStorage[keys] });
        }
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in mockSessionStorage) {
            result[key] = mockSessionStorage[key];
          }
        }
        return Promise.resolve(result);
      }),
      set: vi.fn().mockImplementation((items: Record<string, unknown>) => {
        Object.assign(mockSessionStorage, items);
        return Promise.resolve();
      }),
      remove: vi.fn().mockImplementation((keys: string | string[]) => {
        const keysArray = typeof keys === 'string' ? [keys] : keys;
        keysArray.forEach(key => delete mockSessionStorage[key]);
        return Promise.resolve();
      }),
      clear: vi.fn().mockImplementation(() => {
        Object.keys(mockSessionStorage).forEach(key => delete mockSessionStorage[key]);
        return Promise.resolve();
      }),
      setAccessLevel: vi.fn().mockResolvedValue(undefined),
    },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
  },
} as unknown as typeof chrome;

function makeDownloadTask(overrides: Partial<DownloadTaskState> = {}): DownloadTaskState {
  const siteIntegrationId = overrides.siteIntegrationId ?? 'mangadex';
  return {
    id: 'task-1',
    siteIntegrationId,
    mangaId: 'series-1',
    seriesTitle: 'Test',
    chapters: [],
    status: 'queued',
    created: Date.now(),
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
    ...overrides,
  };
}

describe('Centralized State Management', () => {
  beforeEach(() => {
    // Clear mock storage before each test
    Object.keys(mockSessionStorage).forEach(key => delete mockSessionStorage[key]);
    Object.keys(mockLocalStorage).forEach(key => delete mockLocalStorage[key]);
    vi.clearAllMocks();
  });

  describe('State Initialization', () => {
    it('initializes with setAccessLevel call', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      expect(chrome.storage.session.setAccessLevel).toHaveBeenCalledWith({
        accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
      });
    });

    it('creates global state on initialization', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      expect(mockSessionStorage.global_state).toBeDefined();
      const globalState = mockSessionStorage.global_state as GlobalAppState;
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

      const globalState = mockSessionStorage.global_state as GlobalAppState;
      expect(globalState.downloadQueue).toEqual(mockLocalStorage.downloadQueue);
    });
  });

  describe('Tab State Operations', () => {
   it('creates and retrieves tab state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      // Create tab state
      const tabState: Partial<MangaPageState> = {
        siteIntegrationId: 'mangadex',
        mangaId: 'test-123',
        seriesTitle: 'Test Manga',
        chapters: [],
        volumes: [],
      };

      await stateManager.updateTabState(1, tabState);

      // Retrieve tab state
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

      // Create state for tab 1
      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'manga-1',
        seriesTitle: 'Manga 1',
        chapters: [],
        volumes: [],
      });

      // Create state for tab 2
      await stateManager.updateTabState(2, {
        siteIntegrationId: 'mangadex',
        mangaId: 'manga-2',
        seriesTitle: 'Manga 2',
        chapters: [],
        volumes: [],
      });

      // Verify both states exist and are independent
      const tab1State = await stateManager.getTabState(1);
      const tab2State = await stateManager.getTabState(2);

      expect(tab1State?.mangaId).toBe('manga-1');
      expect(tab2State?.mangaId).toBe('manga-2');
    });

    it('updates existing tab state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      // Create initial state
      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'test',
        seriesTitle: 'Test',
        chapters: [],
        volumes: [],
      });

      // Update state
      await stateManager.updateTabState(1, {
        mangaId: 'test-updated',
      });

      // Verify update
      const tabState = await stateManager.getTabState(1);
      expect(tabState?.mangaId).toBe('test-updated');
      expect(tabState?.seriesTitle).toBe('Test'); // Original value preserved
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

      // Create state
      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'test',
        seriesTitle: 'Test',
        chapters: [],
        volumes: [],
      });

      // Clear state
      await stateManager.clearTabState(1);

      // Verify cleared
      const tabState = await stateManager.getTabState(1);
      expect(tabState).toBeNull();
      expect(mockSessionStorage.tab_1).toBeUndefined();
    });
  });

  describe('Global State Operations', () => {
    it('retrieves global state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      const globalState = await stateManager.getGlobalState();
      expect(globalState).toBeDefined();
      expect(globalState.downloadQueue).toEqual([]);
      expect(globalState.settings).toBeDefined();
    });

    it('updates global state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      // Update global state
      await stateManager.updateGlobalState({
        downloadQueue: [
          makeDownloadTask({ id: 'task-1', mangaId: 'test' }),
        ],
      });

      // Verify update
      const globalState = await stateManager.getGlobalState();
      expect(globalState.downloadQueue).toHaveLength(1);
      expect(globalState.downloadQueue[0].id).toBe('task-1');
      expect(mockLocalStorage.downloadQueue).toEqual(globalState.downloadQueue);
    });

    it('updates lastActivity timestamp on global state changes', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      const beforeUpdate = Date.now();
      await new Promise(resolve => setTimeout(resolve, 10));

      await stateManager.updateGlobalState({ downloadQueue: [] });

      const globalState = await stateManager.getGlobalState();
      expect(globalState.lastActivity).toBeGreaterThan(beforeUpdate);
    });
  });

  describe('Download Task Management', () => {
    it('adds download task to queue', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      const task = makeDownloadTask({
        id: 'task-1',
        mangaId: 'test-series',
        seriesTitle: 'Test Manga',
        status: 'queued' as const,
      });

      await stateManager.addDownloadTask(task);

      const globalState = await stateManager.getGlobalState();
      expect(globalState.downloadQueue).toHaveLength(1);
      expect(globalState.downloadQueue[0]).toEqual(task);
      expect(mockLocalStorage.downloadQueue).toEqual(globalState.downloadQueue);
    });

    it('updates download task status', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      // Add task
      await stateManager.addDownloadTask(makeDownloadTask({ id: 'task-1', mangaId: 'test' }));

      // Update task
      await stateManager.updateDownloadTask('task-1', {
        status: 'downloading',
      });

      const globalState = await stateManager.getGlobalState();
      expect(globalState.downloadQueue[0].status).toBe('downloading');
    });

    it('removes download task from queue', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      // Add task
      await stateManager.addDownloadTask(makeDownloadTask({ id: 'task-1', mangaId: 'test' }));

      // Remove task
      await stateManager.removeDownloadTask('task-1');

      const globalState = await stateManager.getGlobalState();
      expect(globalState.downloadQueue).toHaveLength(0);
    });

    it('handles updating non-existent task gracefully', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      // Should not throw
      await expect(stateManager.updateDownloadTask('non-existent', { status: 'completed' }))
        .resolves.toBeUndefined();
    });

    it('preserves concurrent chapter status mutations without dropping earlier updates', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'task-concurrent',
        mangaId: 'test',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, status: 'queued', lastUpdated: Date.now() },
          { id: 'ch2', url: 'ch2', title: 'Chapter 2', index: 2, status: 'queued', lastUpdated: Date.now() },
        ],
        status: 'downloading',
      }));

      await Promise.all([
        stateManager.updateDownloadTaskChapter('task-concurrent', 'ch1', 'completed'),
        stateManager.updateDownloadTaskChapter('task-concurrent', 'ch2', 'completed'),
      ]);

      const globalState = await stateManager.getGlobalState();
      const task = globalState.downloadQueue.find(t => t.id === 'task-concurrent');

      expect(task?.chapters.map(chapter => chapter.status)).toEqual(['completed', 'completed']);
    });
  });

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

      // Create tab state with chapters
      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'test',
        seriesTitle: 'Test',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, chapterNumber: 1, status: 'queued', lastUpdated: Date.now() },
        ],
        volumes: [],
      });

      // Update chapter status
      await stateManager.updateChapterState(1, 'ch1', 'downloading', { progress: 50 });

      const tabState = await stateManager.getTabState(1);
      expect(tabState?.chapters[0].status).toBe('downloading');
      expect(tabState?.chapters[0].progress).toBe(50);
    });

    it('prevents downgrading completed status', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      // Create tab state with completed chapter
      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'test',
        seriesTitle: 'Test',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, chapterNumber: 1, status: 'completed', lastUpdated: Date.now() },
        ],
        volumes: [],
      });

      // Attempt to change status to downloading
      await stateManager.updateChapterState(1, 'ch1', 'downloading');

      const tabState = await stateManager.getTabState(1);
      expect(tabState?.chapters[0].status).toBe('completed'); // Status preserved
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

      // Should not throw
      await expect(stateManager.updateChapterState(1, 'non-existent', 'downloading'))
        .resolves.toBeUndefined();
    });
  });

  describe('per-image progress for active task', () => {
    it('stores image progress within chapter state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      // Create tab state with chapters
      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'test',
        seriesTitle: 'Test',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, chapterNumber: 1, status: 'downloading', lastUpdated: Date.now() },
        ],
        volumes: [],
      });

      // Update chapter with per-image progress
      await stateManager.updateChapterState(1, 'ch1', 'downloading', {
        progress: 50,
      });

      const tabState = await stateManager.getTabState(1);
      expect(tabState?.chapters[0].status).toBe('downloading');
      expect(tabState?.chapters[0].progress).toBe(50);
      // Per-image progress fields may be stored if implementation supports them
    });

    it('tracks progress for single-chapter downloads', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      // Single chapter task - per-image progress crucial here
      await stateManager.updateTabState(1, {
        siteIntegrationId: 'mangadex',
        mangaId: 'single-chapter-series',
        seriesTitle: 'One-shot Manga',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Oneshot', index: 1, chapterNumber: 1, status: 'queued', lastUpdated: Date.now() },
        ],
        volumes: [],
      });

      // Progress updates for single chapter
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

  describe('downloadId constraints for task states', () => {
    it('lastSuccessfulDownloadId is only set on completed tasks', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      // Add completed task with lastSuccessfulDownloadId
      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'completed-task',
        mangaId: 'test',
        status: 'completed',
        completed: Date.now(),
        lastSuccessfulDownloadId: 12345,
      }));

      const globalState = await stateManager.getGlobalState();
      const task = globalState.downloadQueue.find(t => t.id === 'completed-task');
      
      expect(task?.status).toBe('completed');
      expect(task?.lastSuccessfulDownloadId).toBe(12345);
    });

    it('queued/downloading tasks do not have lastSuccessfulDownloadId', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'active-task',
        mangaId: 'test',
        status: 'downloading',
      }));

      const globalState = await stateManager.getGlobalState();
      const task = globalState.downloadQueue.find(t => t.id === 'active-task');
      
      expect(task?.lastSuccessfulDownloadId).toBeUndefined();
    });
  });

  describe('task audit trail storage', () => {
    it('stores chapter outcomes in task state', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'audit-task',
        mangaId: 'test',
        chapters: [
          { id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, status: 'completed', lastUpdated: Date.now() },
          { id: 'ch2', url: 'ch2', title: 'Chapter 2', index: 2, status: 'failed', lastUpdated: Date.now(), errorMessage: 'Network error' },
          { id: 'ch3', url: 'ch3', title: 'Chapter 3', index: 3, status: 'completed', lastUpdated: Date.now() },
        ],
        status: 'partial_success',
        completed: Date.now(),
      }));

      const globalState = await stateManager.getGlobalState();
      const task = globalState.downloadQueue.find(t => t.id === 'audit-task');
      
      // Chapters contain the audit trail information
      expect(task?.chapters).toHaveLength(3);
      expect(task?.chapters[0].status).toBe('completed');
      expect(task?.chapters[1].status).toBe('failed');
      expect(task?.chapters[1].errorMessage).toBe('Network error');
    });
  });

  describe('multiple tasks for the same series', () => {
    it('allows multiple tasks for the same series', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      
      const stateManager = new CentralizedStateManager();
      await stateManager.initialize();

      // Add first task for series
      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'task-1',
        mangaId: 'same-series',
        seriesTitle: 'Same Manga',
        chapters: [{ id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 1, status: 'queued', lastUpdated: Date.now() }],
      }));

      // Add second task for same series - should be allowed
      await stateManager.addDownloadTask(makeDownloadTask({
        id: 'task-2',
        mangaId: 'same-series',
        seriesTitle: 'Same Manga',
        chapters: [{ id: 'ch2', url: 'ch2', title: 'Chapter 2', index: 2, status: 'queued', lastUpdated: Date.now() }],
      }));

      const globalState = await stateManager.getGlobalState();
      expect(globalState.downloadQueue).toHaveLength(2);
      
      const sameSeriesTasks = globalState.downloadQueue.filter(t => t.mangaId === 'same-series');
      expect(sameSeriesTasks).toHaveLength(2);
    });
  });

  describe('Lock Management', () => {
    it('allows sequential lock acquisition for the same key', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      const acquireLock = (stateManager as unknown as { acquireLock: (lockKey: string, timeoutMs?: number) => Promise<() => void> }).acquireLock.bind(stateManager);

      const release1 = await acquireLock('global_state_mutation');
      release1();

      const release2 = await acquireLock('global_state_mutation');
      release2();
    });

    it('serializes concurrent lock acquisition for the same key', async () => {
      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

      const stateManager = new CentralizedStateManager();
      const acquireLock = (stateManager as unknown as { acquireLock: (lockKey: string, timeoutMs?: number) => Promise<() => void> }).acquireLock.bind(stateManager);
      const events: string[] = [];

      const release1 = await acquireLock('global_state_mutation');
      events.push('lock1-acquired');

      const lock2Promise = acquireLock('global_state_mutation').then((release: () => void) => {
        events.push('lock2-acquired');
        return release;
      });

      await Promise.resolve();
      events.push('before-release1');
      release1();

      const release2 = await lock2Promise;
      events.push('after-lock2');
      release2();

      expect(events).toEqual([
        'lock1-acquired',
        'before-release1',
        'lock2-acquired',
        'after-lock2',
      ]);
    });

    it('times out when a lock is held too long', async () => {
      vi.useFakeTimers();

      try {
        const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

        const stateManager = new CentralizedStateManager();
        const acquireLock = (stateManager as unknown as { acquireLock: (lockKey: string, timeoutMs?: number) => Promise<() => void> }).acquireLock.bind(stateManager);

        await acquireLock('global_state_mutation');

        const waitingLock = acquireLock('global_state_mutation', 100);
        const rejection = expect(waitingLock).rejects.toThrow('Lock timeout: global_state_mutation');
        await vi.advanceTimersByTimeAsync(100);

        await rejection;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Error Handling', () => {
    it('throws error when created without chrome.storage', async () => {
      const originalChrome = globalThis.chrome;
      // @ts-expect-error Testing error condition
      globalThis.chrome = undefined;

      await expect(async () => {
        const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
        new CentralizedStateManager();
      }).rejects.toThrow();

      globalThis.chrome = originalChrome;
    });

    it('handles initialization failure gracefully', async () => {
      // Temporarily break setAccessLevel
      const originalSetAccessLevel = chrome.storage.session.setAccessLevel;
      vi.mocked(chrome.storage.session.setAccessLevel).mockRejectedValueOnce(new Error('Storage error'));

      const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');
      const stateManager = new CentralizedStateManager();

      await expect(stateManager.initialize()).rejects.toThrow('Storage error');

      // Restore
      chrome.storage.session.setAccessLevel = originalSetAccessLevel;
    });
  });
});

