import { vi } from 'vitest';

export type DownloadedChapterRecord = import('@/src/storage/chapter-persistence-service').DownloadedChapterRecord;

export const mockStorageData: Record<string, any> = {};

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
      }),
    },
  },
} as any;

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

export let chapterPersistenceService: any;

export async function resetChapterPersistenceServiceTestEnvironment(): Promise<void> {
  vi.clearAllMocks();
  Object.keys(mockStorageData).forEach(key => delete mockStorageData[key]);
  const module = await import('@/src/storage/chapter-persistence-service');
  chapterPersistenceService = module.chapterPersistenceService;
}
