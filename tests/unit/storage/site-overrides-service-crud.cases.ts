import { describe, expect, it, vi } from 'vitest';
import { mockStorageData, siteOverridesService } from './site-overrides-service-test-setup';

export function registerSiteOverridesCrudCases(): void {
  describe('getAll', () => {
    it('should return empty object when no overrides exist', async () => {
      const overrides = await siteOverridesService.getAll();
      expect(overrides).toEqual({});
    });

    it('should return stored overrides', async () => {
      mockStorageData.siteOverrides = {
        'pixiv-comic': { outputFormat: 'cbz' as const },
        mangadex: { pathTemplate: '/manga/{series_title}' },
      };

      const overrides = await siteOverridesService.getAll();
      expect(overrides).toEqual({
        'pixiv-comic': { outputFormat: 'cbz' },
        mangadex: { pathTemplate: '/manga/{series_title}' },
      });
    });

    it('should return empty object on storage error', async () => {
      const originalGet = globalThis.chrome.storage.local.get;
      globalThis.chrome.storage.local.get = vi.fn().mockRejectedValue(new Error('Storage error'));

      const overrides = await siteOverridesService.getAll();
      expect(overrides).toEqual({});

      globalThis.chrome.storage.local.get = originalGet;
    });
  });

  describe('setAll', () => {
    it('should store overrides map', async () => {
      const overridesMap = {
        'pixiv-comic': { outputFormat: 'zip' as const },
        mangadex: { imagePolicy: { concurrency: 3, delayMs: 200 } },
      };

      await siteOverridesService.setAll(overridesMap);

      expect(mockStorageData.siteOverrides).toEqual(overridesMap);
    });

    it('should overwrite existing overrides', async () => {
      mockStorageData.siteOverrides = {
        'pixiv-comic': { pathTemplate: '/legacy/path' },
        mangadex: { outputFormat: 'cbz' as const },
      };

      const newMap = {
        mangadex: { outputFormat: 'zip' as const },
        manganato: { pathTemplate: '/new/path' },
      };

      await siteOverridesService.setAll(newMap);

      expect(mockStorageData.siteOverrides).toEqual(newMap);
      expect(mockStorageData.siteOverrides['pixiv-comic']).toBeUndefined();
    });
  });

  describe('updateForSite', () => {
    it('should create override for new site', async () => {
      await siteOverridesService.updateForSite('pixiv-comic', {
        outputFormat: 'cbz',
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['pixiv-comic']).toEqual({
        outputFormat: 'cbz',
      });
    });

    it('should merge updates with existing override', async () => {
      mockStorageData.siteOverrides = {
        'pixiv-comic': { outputFormat: 'zip' as const },
      };

      await siteOverridesService.updateForSite('pixiv-comic', {
        pathTemplate: '/custom/path',
        imagePolicy: { concurrency: 5 },
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['pixiv-comic']).toEqual({
        outputFormat: 'zip',
        pathTemplate: '/custom/path',
        imagePolicy: { concurrency: 5 },
      });
    });

    it('should update nested policy objects', async () => {
      mockStorageData.siteOverrides = {
        mangadex: { imagePolicy: { concurrency: 3 } },
      };

      await siteOverridesService.updateForSite('mangadex', {
        imagePolicy: { delayMs: 150 },
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides.mangadex).toEqual({
        imagePolicy: { delayMs: 150 },
      });
    });

    it('should not affect other sites', async () => {
      mockStorageData.siteOverrides = {
        'pixiv-comic': { outputFormat: 'cbz' as const },
        mangadex: { outputFormat: 'zip' as const },
      };

      await siteOverridesService.updateForSite('pixiv-comic', {
        pathTemplate: '/new/path',
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides.mangadex).toEqual({ outputFormat: 'zip' });
    });
  });

  describe('removeSite', () => {
    it('should remove site override', async () => {
      mockStorageData.siteOverrides = {
        'pixiv-comic': { outputFormat: 'cbz' as const },
        mangadex: { outputFormat: 'zip' as const },
      };

      await siteOverridesService.removeSite('pixiv-comic');

      const overrides = await siteOverridesService.getAll();
      expect(overrides['pixiv-comic']).toBeUndefined();
      expect(overrides.mangadex).toEqual({ outputFormat: 'zip' });
    });

    it('should not error when removing non-existent site', async () => {
      mockStorageData.siteOverrides = {
        mangadex: { outputFormat: 'cbz' as const },
      };

      await expect(siteOverridesService.removeSite('non-existent')).resolves.not.toThrow();

      const overrides = await siteOverridesService.getAll();
      expect(overrides.mangadex).toEqual({ outputFormat: 'cbz' });
    });

    it('should handle removal from empty overrides', async () => {
      await expect(siteOverridesService.removeSite('any-site')).resolves.not.toThrow();

      const overrides = await siteOverridesService.getAll();
      expect(overrides).toEqual({});
    });
  });

  describe('clear', () => {
    it('should clear all overrides', async () => {
      mockStorageData.siteOverrides = {
        'pixiv-comic': { outputFormat: 'cbz' as const },
        mangadex: { outputFormat: 'zip' as const },
        manganato: { pathTemplate: '/path' },
      };

      await siteOverridesService.clear();

      const overrides = await siteOverridesService.getAll();
      expect(overrides).toEqual({});
    });

    it('should not error when clearing already empty overrides', async () => {
      await expect(siteOverridesService.clear()).resolves.not.toThrow();

      const overrides = await siteOverridesService.getAll();
      expect(overrides).toEqual({});
    });
  });
}
