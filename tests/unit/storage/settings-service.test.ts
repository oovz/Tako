/**
 * Unit Tests: Settings Service
 * 
 * Tests settings persistence, default initialization, validation/normalization,
 * partial updates, and chrome.storage.local integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import type { ExtensionSettings } from '@/src/storage/settings-types';
import { SETTINGS_STORAGE_KEY, SETTINGS_LIMITS } from '@/src/storage/settings-service';

// Mock chrome.storage.local
const mockStorageData: Record<string, any> = {};
const mockOnChangedListeners: Array<(changes: any, area: string) => void> = [];

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
        // Trigger onChanged listeners
        mockOnChangedListeners.forEach(listener => listener(changes, 'local'));
        return Promise.resolve();
      })
    },
    onChanged: {
      addListener: vi.fn((callback: (changes: any, area: string) => void) => {
        mockOnChangedListeners.push(callback);
      })
    }
  }
} as any;

// Mock logger
vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  },
  applyAdvancedLoggerSettings: vi.fn(),
}));

// Dynamic import to get the service after mocks are set up
let settingsService: any;

describe('Settings Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear mock storage
    Object.keys(mockStorageData).forEach(key => delete mockStorageData[key]);
    mockOnChangedListeners.length = 0;

    // Clear module cache and re-import to reset in-memory cache
    vi.resetModules();
    const module = await import('@/src/storage/settings-service');
    settingsService = module.settingsService;
  });

  describe('Default Initialization', () => {
    it('should initialize with default settings on first load', async () => {
      const settings = await settingsService.getSettings();

      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(mockStorageData[SETTINGS_STORAGE_KEY]).toEqual(DEFAULT_SETTINGS);
    });

    it('should return cached settings on subsequent calls', async () => {
      const settings1 = await settingsService.getSettings();
      const settings2 = await settingsService.getSettings();

      expect(settings1).toStrictEqual(settings2); // Same values (cached)
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(1); // Only called once
    });
  });

  describe('Settings Persistence', () => {
    it('should load existing settings from storage', async () => {
      const customSettings: ExtensionSettings = {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          maxConcurrentChapters: 5
        }
      };

      mockStorageData[SETTINGS_STORAGE_KEY] = customSettings;

      // Force reload to read from storage
      const settings = await settingsService.reload();

      expect(settings.downloads.maxConcurrentChapters).toBe(5);
    });

    it('should persist settings updates to storage', async () => {
      await settingsService.updateSettings({
        downloads: {
          maxConcurrentChapters: 4
        }
      });

      expect(mockStorageData[SETTINGS_STORAGE_KEY].downloads.maxConcurrentChapters).toBe(4);
    });

    it('should merge partial updates with existing settings', async () => {
      await settingsService.updateSettings({
        downloads: {
          maxConcurrentChapters: 3
        }
      });

      const settings = await settingsService.getSettings();

      // Updated field
      expect(settings.downloads.maxConcurrentChapters).toBe(3);
      // Other fields preserved
      expect(settings.downloads.defaultFormat).toBe(DEFAULT_SETTINGS.downloads.defaultFormat);
      expect(settings.globalPolicy).toEqual(DEFAULT_SETTINGS.globalPolicy);
    });
  });

  describe('Settings Validation and Normalization', () => {
    it('should clamp concurrency within limits', async () => {
      await settingsService.updateSettings({
        downloads: {
          maxConcurrentChapters: 999 // Exceeds MAX_CONCURRENCY
        }
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.maxConcurrentChapters).toBe(SETTINGS_LIMITS.MAX_CONCURRENCY);
    });

    it('should enforce minimum concurrency', async () => {
      await settingsService.updateSettings({
        downloads: {
          maxConcurrentChapters: 0 // Below MIN_CONCURRENCY
        }
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.maxConcurrentChapters).toBe(SETTINGS_LIMITS.MIN_CONCURRENCY);
    });

    it('should clamp global policy concurrency', async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 999, delayMs: 100 }
        }
      });

      const settings = await settingsService.getSettings();
      expect(settings.globalPolicy.image.concurrency).toBe(SETTINGS_LIMITS.MAX_CONCURRENCY);
    });

    it('should enforce minimum delay', async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 2, delayMs: -100 } // Negative delay
        }
      });

      const settings = await settingsService.getSettings();
      expect(settings.globalPolicy.image.delayMs).toBeGreaterThanOrEqual(SETTINGS_LIMITS.MIN_DELAY_MS);
    });

    it('should clamp retry counts', async () => {
      await settingsService.updateSettings({
        globalRetries: {
          image: 999, // Exceeds MAX_RETRIES
          chapter: -1  // Below MIN_RETRIES
        }
      });

      const settings = await settingsService.getSettings();
      expect(settings.globalRetries.image).toBe(SETTINGS_LIMITS.MAX_RETRIES);
      expect(settings.globalRetries.chapter).toBe(SETTINGS_LIMITS.MIN_RETRIES);
    });

    it('should validate download mode enum', async () => {
      await settingsService.updateSettings({
        downloads: {
          downloadMode: 'invalid-mode' as any
        }
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.downloadMode).toBe(DEFAULT_SETTINGS.downloads.downloadMode);
    });

    it('should validate archive format enum', async () => {
      await settingsService.updateSettings({
        downloads: {
          defaultFormat: 'invalid-format' as any
        }
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.defaultFormat).toBe(DEFAULT_SETTINGS.downloads.defaultFormat);
    });

    it('should ensure boolean flags', async () => {
      await settingsService.updateSettings({
        downloads: {
          includeComicInfo: 'not-a-boolean' as any
        }
      });

      const settings = await settingsService.getSettings();
      expect(typeof settings.downloads.includeComicInfo).toBe('boolean');
      expect(settings.downloads.includeComicInfo).toBe(DEFAULT_SETTINGS.downloads.includeComicInfo);
    });
  });

  describe('Partial Update Deep Merge', () => {
    it('should update nested downloads fields', async () => {
      await settingsService.updateSettings({
        downloads: {
          pathTemplate: 'custom/path'
        }
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.pathTemplate).toBe('custom/path');
      expect(settings.downloads.maxConcurrentChapters).toBe(DEFAULT_SETTINGS.downloads.maxConcurrentChapters);
    });

    it('should update nested globalPolicy image settings', async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 5, delayMs: 200 }
        }
      });

      const settings = await settingsService.getSettings();
      expect(settings.globalPolicy.image.concurrency).toBe(5);
      expect(settings.globalPolicy.image.delayMs).toBe(200);
      // Chapter policy unchanged
      expect(settings.globalPolicy.chapter).toEqual(DEFAULT_SETTINGS.globalPolicy.chapter);
    });

    it('should update nested globalPolicy chapter settings', async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          chapter: { concurrency: 3, delayMs: 300 }
        }
      });

      const settings = await settingsService.getSettings();
      expect(settings.globalPolicy.chapter.concurrency).toBe(3);
      expect(settings.globalPolicy.chapter.delayMs).toBe(300);
      // Image policy unchanged
      expect(settings.globalPolicy.image).toEqual(DEFAULT_SETTINGS.globalPolicy.image);
    });

    it('should update notifications setting', async () => {
      await settingsService.updateSettings({
        notifications: false,
      });

      const settings = await settingsService.getSettings();
      expect(settings.notifications).toBe(false);
    });

    it('should update nested advanced settings', async () => {
      await settingsService.updateSettings({
        advanced: {
          logLevel: 'debug'
        }
      });

      const settings = await settingsService.getSettings();
      expect(settings.advanced.logLevel).toBe('debug');
    });
  });

  describe('Helper Methods', () => {
    it('should get global policy', async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 5, delayMs: 200 }
        }
      });

      const policy = await settingsService.getGlobalPolicy();
      expect(policy.image.concurrency).toBe(5);
      expect(policy.image.delayMs).toBe(200);
    });

    it('should get global retries', async () => {
      await settingsService.updateSettings({
        globalRetries: {
          image: 5,
          chapter: 3
        }
      });

      const retries = await settingsService.getGlobalRetries();
      expect(retries.image).toBe(5);
      expect(retries.chapter).toBe(3);
    });
  });

  describe('Cache Management', () => {
    it('should reload settings from storage', async () => {
      // Initial load
      await settingsService.getSettings();

      // Manually update storage (simulating external change)
      mockStorageData[SETTINGS_STORAGE_KEY] = {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          maxConcurrentChapters: 7
        }
      };

      // Reload should fetch from storage
      const settings = await settingsService.reload();
      expect(settings.downloads.maxConcurrentChapters).toBe(7);
    });

    it('should sync cache when storage changes externally', async () => {
      // Initial load
      await settingsService.getSettings();

      // Simulate external storage change via onChanged event
      const updatedSettings = {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          maxConcurrentChapters: 8
        }
      };

      // Trigger onChanged listener
      const changes = {
        [SETTINGS_STORAGE_KEY]: {
          oldValue: DEFAULT_SETTINGS,
          newValue: updatedSettings
        }
      };

      mockOnChangedListeners.forEach(listener => listener(changes, 'local'));

      // Get settings should return updated value from cache
      const settings = await settingsService.getSettings();
      expect(settings.downloads.maxConcurrentChapters).toBe(8);
    });
  });

  describe('Error Handling', () => {
    it('should fallback to defaults on storage error', async () => {
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage error'));

      const settings = await settingsService.getSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should use cached settings after error recovery', async () => {
      // First call fails
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage error'));
      const settings1 = await settingsService.getSettings();

      // Second call should use cache (not call storage again)
      const settings2 = await settingsService.getSettings();
      expect(settings1).toBe(settings2);
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(1); // Only failed call
    });
  });

  describe('Complex Update Scenarios', () => {
    it('should handle multiple sequential updates', async () => {
      await settingsService.updateSettings({
        downloads: { maxConcurrentChapters: 3 }
      });

      await settingsService.updateSettings({
        downloads: { defaultFormat: 'zip' }
      });

      await settingsService.updateSettings({
        globalRetries: { image: 5 }
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.maxConcurrentChapters).toBe(3);
      expect(settings.downloads.defaultFormat).toBe('zip');
      expect(settings.globalRetries.image).toBe(5);
    });

    it('should handle updating all top-level sections', async () => {
      await settingsService.updateSettings({
        downloads: { maxConcurrentChapters: 4 }
      });

      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 3, delayMs: 150 },
          chapter: { concurrency: 2, delayMs: 250 }
        }
      });

      await settingsService.updateSettings({
        globalRetries: { image: 4, chapter: 3 }
      });

      await settingsService.updateSettings({
        notifications: false,
      });

      await settingsService.updateSettings({
        advanced: { logLevel: 'debug' }
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.maxConcurrentChapters).toBe(4);
      expect(settings.globalPolicy.image.concurrency).toBe(3);
      expect(settings.globalRetries.image).toBe(4);
      expect(settings.notifications).toBe(false);
      expect(settings.advanced.logLevel).toBe('debug');
    });
  });
});

