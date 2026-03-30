import { vi } from 'vitest';

export const mockStorageData: Record<string, any> = {};
export const mockOnChangedListeners: Array<(changes: any, area: string) => void> = [];

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
        const changes: Record<string, { oldValue?: any; newValue: any }> = {};
        Object.entries(items).forEach(([key, newValue]) => {
          const oldValue = mockStorageData[key];
          mockStorageData[key] = newValue;
          changes[key] = { oldValue, newValue };
        });
        mockOnChangedListeners.forEach(listener => listener(changes, 'local'));
        return Promise.resolve();
      }),
    },
    onChanged: {
      addListener: vi.fn((callback: (changes: any, area: string) => void) => {
        mockOnChangedListeners.push(callback);
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
  applyAdvancedLoggerSettings: vi.fn(),
}));

export let settingsService: any;

export async function resetSettingsServiceTestEnvironment(): Promise<void> {
  vi.clearAllMocks();
  Object.keys(mockStorageData).forEach(key => delete mockStorageData[key]);
  mockOnChangedListeners.length = 0;
  vi.resetModules();
  const module = await import('@/src/storage/settings-service');
  settingsService = module.settingsService;
}
