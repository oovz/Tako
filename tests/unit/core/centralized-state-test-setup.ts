import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import type { DownloadTaskState } from '@/src/types/queue-state';
import { vi } from 'vitest';

export const mockSessionStorage: Record<string, unknown> = {};
export const mockLocalStorage: Record<string, unknown> = {};

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

export function makeDownloadTask(overrides: Partial<DownloadTaskState> = {}): DownloadTaskState {
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

export function resetCentralizedStateTestEnvironment(): void {
  Object.keys(mockSessionStorage).forEach(key => delete mockSessionStorage[key]);
  Object.keys(mockLocalStorage).forEach(key => delete mockLocalStorage[key]);
  vi.clearAllMocks();
}
