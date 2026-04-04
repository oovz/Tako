import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import { DOWNLOAD_ROOT_HANDLE_ID } from '@/src/storage/fs-access';
import type { ExtensionSettings } from '@/src/storage/settings-types';
import { SETTINGS_LIMITS, SETTINGS_STORAGE_KEY } from '@/src/storage/settings-service';
import { mockStorageData, settingsService } from './settings-service-test-setup';

export function registerSettingsServicePersistenceAndValidationCases(): void {
  describe('Default Initialization', () => {
    it('should initialize with default settings on first load', async () => {
      const settings = await settingsService.getSettings();

      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(mockStorageData[SETTINGS_STORAGE_KEY]).toEqual(DEFAULT_SETTINGS);
    });

    it('should return cached settings on subsequent calls', async () => {
      const settings1 = await settingsService.getSettings();
      const settings2 = await settingsService.getSettings();

      expect(settings1).toStrictEqual(settings2);
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('Settings Persistence', () => {
    it('should load existing settings from storage', async () => {
      const customSettings: ExtensionSettings = {
        ...DEFAULT_SETTINGS,
        downloads: {
          ...DEFAULT_SETTINGS.downloads,
          maxConcurrentChapters: 5,
        },
      };

      mockStorageData[SETTINGS_STORAGE_KEY] = customSettings;

      const settings = await settingsService.reload();

      expect(settings.downloads.maxConcurrentChapters).toBe(5);
    });

    it('should canonicalize partial persisted settings documents on reload', async () => {
      mockStorageData[SETTINGS_STORAGE_KEY] = {
        downloads: {
          defaultFormat: 'zip',
        },
      };

      const settings = await settingsService.reload();

      expect(settings.downloads.defaultFormat).toBe('zip');
      expect(settings.downloads.pathTemplate).toBe(DEFAULT_SETTINGS.downloads.pathTemplate);
      expect(settings.globalPolicy).toEqual(DEFAULT_SETTINGS.globalPolicy);
      expect(settings.notifications).toBe(DEFAULT_SETTINGS.notifications);
    });

    it('should recover the fixed persisted folder handle id for legacy custom-folder settings on reload', async () => {
      mockStorageData[SETTINGS_STORAGE_KEY] = {
        downloads: {
          downloadMode: 'custom',
          customDirectoryEnabled: true,
          customDirectoryHandleId: null,
        },
      };

      const settings = await settingsService.reload();

      expect(settings.downloads.customDirectoryEnabled).toBe(true);
      expect(settings.downloads.customDirectoryHandleId).toBe(DOWNLOAD_ROOT_HANDLE_ID);
    });

    it('should ignore malformed nested persisted branches while preserving valid typed leaves on reload', async () => {
      mockStorageData[SETTINGS_STORAGE_KEY] = {
        downloads: 'bad-branch',
        globalPolicy: {
          image: 'bad-image-policy',
          chapter: { concurrency: 7, delayMs: 250 },
        },
        globalRetries: {
          image: 4,
          chapter: 'bad-retry-count',
        },
        notifications: false,
        advanced: {
          logLevel: 'debug',
          storageCleanupDays: 'bad-cleanup-days',
        },
      };

      const settings = await settingsService.reload();

      expect(settings.downloads).toEqual(DEFAULT_SETTINGS.downloads);
      expect(settings.globalPolicy.image).toEqual(DEFAULT_SETTINGS.globalPolicy.image);
      expect(settings.globalPolicy.chapter).toEqual({ concurrency: 7, delayMs: 250 });
      expect(settings.globalRetries.image).toBe(4);
      expect(settings.globalRetries.chapter).toBe(DEFAULT_SETTINGS.globalRetries.chapter);
      expect(settings.notifications).toBe(false);
      expect(settings.advanced.logLevel).toBe('debug');
      expect(settings.advanced.storageCleanupDays).toBe(DEFAULT_SETTINGS.advanced.storageCleanupDays);
    });

    it('should persist settings updates to storage', async () => {
      await settingsService.updateSettings({
        downloads: {
          maxConcurrentChapters: 4,
        },
      });

      expect(mockStorageData[SETTINGS_STORAGE_KEY].downloads.maxConcurrentChapters).toBe(4);
    });

    it('should merge partial updates with existing settings', async () => {
      await settingsService.updateSettings({
        downloads: {
          maxConcurrentChapters: 3,
        },
      });

      const settings = await settingsService.getSettings();

      expect(settings.downloads.maxConcurrentChapters).toBe(3);
      expect(settings.downloads.defaultFormat).toBe(DEFAULT_SETTINGS.downloads.defaultFormat);
      expect(settings.globalPolicy).toEqual(DEFAULT_SETTINGS.globalPolicy);
    });
  });

  describe('Settings Validation and Normalization', () => {
    it('should clamp concurrency within limits', async () => {
      await settingsService.updateSettings({
        downloads: {
          maxConcurrentChapters: 999,
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.maxConcurrentChapters).toBe(SETTINGS_LIMITS.MAX_CONCURRENCY);
    });

    it('should enforce minimum concurrency', async () => {
      await settingsService.updateSettings({
        downloads: {
          maxConcurrentChapters: 0,
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.maxConcurrentChapters).toBe(SETTINGS_LIMITS.MIN_CONCURRENCY);
    });

    it('should clamp global policy concurrency', async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 999, delayMs: 100 },
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.globalPolicy.image.concurrency).toBe(SETTINGS_LIMITS.MAX_CONCURRENCY);
    });

    it('should enforce minimum delay', async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 2, delayMs: -100 },
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.globalPolicy.image.delayMs).toBeGreaterThanOrEqual(SETTINGS_LIMITS.MIN_DELAY_MS);
    });

    it('should clamp retry counts', async () => {
      await settingsService.updateSettings({
        globalRetries: {
          image: 999,
          chapter: -1,
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.globalRetries.image).toBe(SETTINGS_LIMITS.MAX_RETRIES);
      expect(settings.globalRetries.chapter).toBe(SETTINGS_LIMITS.MIN_RETRIES);
    });

    it('should validate download mode enum', async () => {
      await settingsService.updateSettings({
        downloads: {
          downloadMode: 'invalid-mode' as any,
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.downloadMode).toBe(DEFAULT_SETTINGS.downloads.downloadMode);
    });

    it('should validate archive format enum', async () => {
      await settingsService.updateSettings({
        downloads: {
          defaultFormat: 'invalid-format' as any,
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.defaultFormat).toBe(DEFAULT_SETTINGS.downloads.defaultFormat);
    });

    it('should ensure boolean flags', async () => {
      await settingsService.updateSettings({
        downloads: {
          includeComicInfo: 'not-a-boolean' as any,
        },
      });

      const settings = await settingsService.getSettings();
      expect(typeof settings.downloads.includeComicInfo).toBe('boolean');
      expect(settings.downloads.includeComicInfo).toBe(DEFAULT_SETTINGS.downloads.includeComicInfo);
    });

    it('should normalize malformed includeCoverImage values to the default boolean', async () => {
      await settingsService.updateSettings({
        downloads: {
          includeCoverImage: 'not-a-boolean' as any,
        },
      });

      const settings = await settingsService.getSettings();
      expect(typeof settings.downloads.includeCoverImage).toBe('boolean');
      expect(settings.downloads.includeCoverImage).toBe(DEFAULT_SETTINGS.downloads.includeCoverImage);
    });

    it('should normalize malformed download scalar settings to canonical defaults', async () => {
      await settingsService.updateSettings({
        downloads: {
          overwriteExisting: 'not-a-boolean' as any,
          pathTemplate: '' as any,
          fileNameTemplate: '' as any,
          normalizeImageFilenames: 'not-a-boolean' as any,
          imagePaddingDigits: 'invalid-padding' as any,
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.overwriteExisting).toBe(DEFAULT_SETTINGS.downloads.overwriteExisting);
      expect(settings.downloads.pathTemplate).toBe(DEFAULT_SETTINGS.downloads.pathTemplate);
      expect(settings.downloads.fileNameTemplate).toBe(DEFAULT_SETTINGS.downloads.fileNameTemplate);
      expect(settings.downloads.normalizeImageFilenames).toBe(DEFAULT_SETTINGS.downloads.normalizeImageFilenames);
      expect(settings.downloads.imagePaddingDigits).toBe(DEFAULT_SETTINGS.downloads.imagePaddingDigits);
    });

    it('should normalize malformed custom destination settings to canonical types', async () => {
      await settingsService.updateSettings({
        downloads: {
          customDirectoryEnabled: 'false' as any,
          customDirectoryHandleId: 42 as any,
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.customDirectoryEnabled).toBe(DEFAULT_SETTINGS.downloads.customDirectoryEnabled);
      expect(settings.downloads.customDirectoryHandleId).toBe(DEFAULT_SETTINGS.downloads.customDirectoryHandleId);
    });
  });
}
