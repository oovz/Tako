/**
 * @file navigation-state-transitions.spec.ts
 * @description Unit tests for navigation state transitions
 * 
 * Tests the state management behavior during page navigation scenarios:
 * - State clearing when navigating away from a supported page
 * - Race condition prevention (INITIALIZE_TAB after CLEAR_TAB_STATE)
 * - State restoration on bfcache restoration
 * 
 * These tests complement the E2E tests in bfcache-navigation.spec.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
// Types used for documentation purposes
// import type { MangaPageState, GlobalAppState } from '@/src/types/state';

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
} as unknown as typeof chrome;

describe('Navigation State Transitions', () => {
    beforeEach(() => {
        // Clear mock storage before each test
        Object.keys(mockSessionStorage).forEach(key => delete mockSessionStorage[key]);
        Object.keys(mockLocalStorage).forEach(key => delete mockLocalStorage[key]);
        vi.clearAllMocks();
    });

    describe('State clearing on navigation away', () => {
        it('clears tab state successfully', async () => {
            const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

            const stateManager = new CentralizedStateManager();
            await stateManager.initialize();

            // Create tab state
            await stateManager.updateTabState(123, {
                siteIntegrationId: 'mangadex',
                mangaId: 'test-series',
                seriesTitle: 'Test Manga',
                chapters: [],
                volumes: [],
            });

            // Verify state exists
            let state = await stateManager.getTabState(123);
            expect(state).toBeDefined();
            expect(state?.seriesTitle).toBe('Test Manga');

            // Clear state (simulating pagehide/navigation away)
            await stateManager.clearTabState(123);

            // Verify state is cleared
            state = await stateManager.getTabState(123);
            expect(state).toBeNull();
        });

        it('clear followed by initialize creates fresh state', async () => {
            const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

            const stateManager = new CentralizedStateManager();
            await stateManager.initialize();

            // Create initial state
            await stateManager.updateTabState(123, {
                siteIntegrationId: 'mangadex',
                mangaId: 'old-series',
                seriesTitle: 'Old Manga',
                chapters: [],
                volumes: [],
            });

            // Clear state
            await stateManager.clearTabState(123);

            // Initialize with new state
            await stateManager.initializeTabState(
                123,
                'pixiv-comic',
                'new-series',
                'New Manga',
                [{ id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 0, chapterNumber: 1 }],
            );

            // Verify new state replaces old
            const state = await stateManager.getTabState(123);
            expect(state).toBeDefined();
            expect(state?.mangaId).toBe('new-series');
            expect(state?.seriesTitle).toBe('New Manga');
            expect(state?.siteIntegrationId).toBe('pixiv-comic');
        });
    });

    describe('Race condition scenarios', () => {
        it('initialize after clear creates desired state (no race)', async () => {
            const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

            const stateManager = new CentralizedStateManager();
            await stateManager.initialize();

            // Sequence: clear -> initialize (desired order)
            await stateManager.clearTabState(456);

            await stateManager.initializeTabState(
                456,
                'mangadex',
                'correct-series',
                'Correct Manga',
                [{ id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 0, chapterNumber: 1 }],
            );

            const state = await stateManager.getTabState(456);
            expect(state?.mangaId).toBe('correct-series');
            expect(state?.seriesTitle).toBe('Correct Manga');
        });

        it('multiple rapid state updates converge to final state', async () => {
            const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

            const stateManager = new CentralizedStateManager();
            await stateManager.initialize();

            // Simulate rapid state changes (e.g., fast navigation)
            const tabId = 789;

            // First navigation - create state
            await stateManager.initializeTabState(
                tabId,
                'site1',
                'series1',
                'Manga 1',
                [],
            );

            // Second navigation - clear and create new
            await stateManager.clearTabState(tabId);
            await stateManager.initializeTabState(
                tabId,
                'site2',
                'series2',
                'Manga 2',
                [],
            );

            // Third navigation - clear again
            await stateManager.clearTabState(tabId);

            // Final state should be cleared
            const state = await stateManager.getTabState(tabId);
            expect(state).toBeNull();
        });
    });

    describe('State isolation between tabs', () => {
        it('clearing one tab does not affect other tabs', async () => {
            const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

            const stateManager = new CentralizedStateManager();
            await stateManager.initialize();

            // Create state for two tabs
            await stateManager.updateTabState(111, {
                siteIntegrationId: 'mangadex',
                mangaId: 'series-111',
                seriesTitle: 'Manga 111',
                chapters: [],
                volumes: [],
            });

            await stateManager.updateTabState(222, {
                siteIntegrationId: 'mangadex',
                mangaId: 'series-222',
                seriesTitle: 'Manga 222',
                chapters: [],
                volumes: [],
            });

            // Clear only tab 111
            await stateManager.clearTabState(111);

            // Tab 111 should be cleared
            const state111 = await stateManager.getTabState(111);
            expect(state111).toBeNull();

            // Tab 222 should still have state
            const state222 = await stateManager.getTabState(222);
            expect(state222).toBeDefined();
            expect(state222?.seriesTitle).toBe('Manga 222');
        });

        it('back navigation to one tab does not affect other tabs', async () => {
            const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

            const stateManager = new CentralizedStateManager();
            await stateManager.initialize();

            // Tab 1: Navigate to supported page
            await stateManager.initializeTabState(
                1,
                'mangadex',
                'tab1-series',
                'Tab 1 Manga',
                [{ id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 0, chapterNumber: 1 }],
            );

            // Tab 2: Navigate to supported page
            await stateManager.initializeTabState(
                2,
                'mangadex',
                'tab2-series',
                'Tab 2 Manga',
                [{ id: 'ch2', url: 'ch2', title: 'Chapter 2', index: 0, chapterNumber: 1 }],
            );

            // Tab 1: Navigate away (clear state)
            await stateManager.clearTabState(1);

            // Tab 1: Navigate back (reinitialize)
            await stateManager.initializeTabState(
                1,
                'mangadex',
                'tab1-series-restored',
                'Tab 1 Manga Restored',
                [{ id: 'ch1', url: 'ch1', title: 'Chapter 1', index: 0, chapterNumber: 1 }],
            );

            // Verify Tab 1 has restored state
            const state1 = await stateManager.getTabState(1);
            expect(state1?.mangaId).toBe('tab1-series-restored');

            // Verify Tab 2 is unaffected
            const state2 = await stateManager.getTabState(2);
            expect(state2?.mangaId).toBe('tab2-series');
            expect(state2?.seriesTitle).toBe('Tab 2 Manga');
        });
    });

    describe('Global state isolation during navigation', () => {
        it('tab state changes do not affect download queue', async () => {
            const { CentralizedStateManager } = await import('@/src/runtime/centralized-state');

            const stateManager = new CentralizedStateManager();
            await stateManager.initialize();

            // Add a download task to global state
            await stateManager.addDownloadTask({
                id: 'task-1',
                siteIntegrationId: 'mangadex',
                mangaId: 'downloading-series',
                seriesTitle: 'Downloading Manga',
                chapters: [],
                status: 'downloading',
                created: Date.now(),
                settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'mangadex'),
            });

            // Create tab state
            await stateManager.initializeTabState(
                123,
                'mangadex',
                'downloading-series',
                'Downloading Manga',
                [],
            );

            // Navigate away (clear tab state)
            await stateManager.clearTabState(123);

            // Download task should still exist
            const globalState = await stateManager.getGlobalState();
            expect(globalState.downloadQueue).toHaveLength(1);
            expect(globalState.downloadQueue[0].id).toBe('task-1');
            expect(globalState.downloadQueue[0].status).toBe('downloading');
        });
    });
});

