import { vi } from 'vitest';

export const mockStorageData: Record<string, any> = {};

globalThis.chrome = {
  storage: {
    local: {
      async get(keys: string | string[]) {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, any> = {};
        for (const key of keyArray) {
          if (key in mockStorageData) {
            result[key] = mockStorageData[key];
          }
        }
        return result;
      },
      async set(items: Record<string, any>) {
        Object.assign(mockStorageData, items);
      },
      async remove(keys: string | string[]) {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        for (const key of keyArray) {
          delete mockStorageData[key];
        }
      },
      async clear() {
        Object.keys(mockStorageData).forEach(key => delete mockStorageData[key]);
      },
    },
  },
} as any;

export let siteOverridesService: typeof import('@/src/storage/site-overrides-service').siteOverridesService;

export async function resetSiteOverridesServiceTestEnvironment(): Promise<void> {
  vi.clearAllMocks();
  Object.keys(mockStorageData).forEach(key => delete mockStorageData[key]);
  vi.resetModules();
  const module = await import('@/src/storage/site-overrides-service');
  siteOverridesService = module.siteOverridesService;
}
