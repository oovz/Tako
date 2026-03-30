import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import { settingsService } from './settings-service-test-setup';

export function registerSettingsServiceUpdatesAndHelpersCases(): void {
  describe('Partial Update Deep Merge', () => {
    it('should update nested downloads fields', async () => {
      await settingsService.updateSettings({
        downloads: {
          pathTemplate: 'custom/path',
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.pathTemplate).toBe('custom/path');
      expect(settings.downloads.maxConcurrentChapters).toBe(DEFAULT_SETTINGS.downloads.maxConcurrentChapters);
    });

    it('should update nested globalPolicy image settings', async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 5, delayMs: 200 },
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.globalPolicy.image.concurrency).toBe(5);
      expect(settings.globalPolicy.image.delayMs).toBe(200);
      expect(settings.globalPolicy.chapter).toEqual(DEFAULT_SETTINGS.globalPolicy.chapter);
    });

    it('should update nested globalPolicy chapter settings', async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          chapter: { concurrency: 3, delayMs: 300 },
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.globalPolicy.chapter.concurrency).toBe(3);
      expect(settings.globalPolicy.chapter.delayMs).toBe(300);
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
          logLevel: 'debug',
        },
      });

      const settings = await settingsService.getSettings();
      expect(settings.advanced.logLevel).toBe('debug');
    });
  });

  describe('Helper Methods', () => {
    it('should get global policy', async () => {
      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 5, delayMs: 200 },
        },
      });

      const policy = await settingsService.getGlobalPolicy();
      expect(policy.image.concurrency).toBe(5);
      expect(policy.image.delayMs).toBe(200);
    });

    it('should get global retries', async () => {
      await settingsService.updateSettings({
        globalRetries: {
          image: 5,
          chapter: 3,
        },
      });

      const retries = await settingsService.getGlobalRetries();
      expect(retries.image).toBe(5);
      expect(retries.chapter).toBe(3);
    });
  });

  describe('Complex Update Scenarios', () => {
    it('should handle multiple sequential updates', async () => {
      await settingsService.updateSettings({
        downloads: { maxConcurrentChapters: 3 },
      });

      await settingsService.updateSettings({
        downloads: { defaultFormat: 'zip' },
      });

      await settingsService.updateSettings({
        globalRetries: { image: 5 },
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.maxConcurrentChapters).toBe(3);
      expect(settings.downloads.defaultFormat).toBe('zip');
      expect(settings.globalRetries.image).toBe(5);
    });

    it('should handle updating all top-level sections', async () => {
      await settingsService.updateSettings({
        downloads: { maxConcurrentChapters: 4 },
      });

      await settingsService.updateSettings({
        globalPolicy: {
          image: { concurrency: 3, delayMs: 150 },
          chapter: { concurrency: 2, delayMs: 250 },
        },
      });

      await settingsService.updateSettings({
        globalRetries: { image: 4, chapter: 3 },
      });

      await settingsService.updateSettings({
        notifications: false,
      });

      await settingsService.updateSettings({
        advanced: { logLevel: 'debug' },
      });

      const settings = await settingsService.getSettings();
      expect(settings.downloads.maxConcurrentChapters).toBe(4);
      expect(settings.globalPolicy.image.concurrency).toBe(3);
      expect(settings.globalRetries.image).toBe(4);
      expect(settings.notifications).toBe(false);
      expect(settings.advanced.logLevel).toBe('debug');
    });
  });
}
