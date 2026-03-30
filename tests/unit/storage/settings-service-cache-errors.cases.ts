import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import { SETTINGS_STORAGE_KEY } from '@/src/storage/settings-service';
import {
  mockOnChangedListeners,
  mockStorageData,
  settingsService,
} from './settings-service-test-setup';

export function registerSettingsServiceCacheAndErrorCases(): void {
  describe('Cache Management', () => {
    it('should reload settings from storage', async () => {
      await settingsService.getSettings();

      mockStorageData[SETTINGS_STORAGE_KEY] = {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          maxConcurrentChapters: 7,
        },
      };

      const settings = await settingsService.reload();
      expect(settings.downloads.maxConcurrentChapters).toBe(7);
    });

    it('should sync cache when storage changes externally', async () => {
      await settingsService.getSettings();

      const updatedSettings = {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          maxConcurrentChapters: 8,
        },
      };

      const changes = {
        [SETTINGS_STORAGE_KEY]: {
          oldValue: DEFAULT_SETTINGS,
          newValue: updatedSettings,
        },
      };

      mockOnChangedListeners.forEach(listener => listener(changes, 'local'));

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
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage error'));
      const settings1 = await settingsService.getSettings();

      const settings2 = await settingsService.getSettings();
      expect(settings1).toBe(settings2);
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    });
  });
}
