/**
 * Unit tests for site-overrides-service.ts
 * Tests CRUD operations, chrome.storage.local persistence, and override structure validation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome.storage.local
const mockStorageData: Record<string, any> = {};
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
        Object.keys(mockStorageData).forEach((key) => delete mockStorageData[key]);
      },
    },
  },
} as any;

describe('site-overrides-service', () => {
  let siteOverridesService: typeof import('@/src/storage/site-overrides-service').siteOverridesService;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear mock storage
    Object.keys(mockStorageData).forEach((key) => delete mockStorageData[key]);

    // Reset module to clear any cached state
    vi.resetModules();
    const module = await import('@/src/storage/site-overrides-service');
    siteOverridesService = module.siteOverridesService;
  });

  describe('getAll', () => {
    it('should return empty object when no overrides exist', async () => {
      const overrides = await siteOverridesService.getAll();
      expect(overrides).toEqual({});
    });

    it('should return stored overrides', async () => {
      mockStorageData['siteOverrides'] = {
        'pixiv-comic': { outputFormat: 'cbz' as const },
        'mangadex': { pathTemplate: '/manga/{series_title}' },
      };

      const overrides = await siteOverridesService.getAll();
      expect(overrides).toEqual({
        'pixiv-comic': { outputFormat: 'cbz' },
        'mangadex': { pathTemplate: '/manga/{series_title}' },
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
        'mangadex': { imagePolicy: { concurrency: 3, delayMs: 200 } },
      };

      await siteOverridesService.setAll(overridesMap);

      expect(mockStorageData['siteOverrides']).toEqual(overridesMap);
    });

    it('should overwrite existing overrides', async () => {
      mockStorageData['siteOverrides'] = {
        'pixiv-comic': { autoInjectUI: true },
        'mangadex': { outputFormat: 'cbz' as const },
      };

      const newMap = {
        'mangadex': { outputFormat: 'zip' as const },
        'manganato': { pathTemplate: '/new/path' },
      };

      await siteOverridesService.setAll(newMap);

      expect(mockStorageData['siteOverrides']).toEqual(newMap);
      expect(mockStorageData['siteOverrides']['pixiv-comic']).toBeUndefined();
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
      mockStorageData['siteOverrides'] = {
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
      mockStorageData['siteOverrides'] = {
        'mangadex': { imagePolicy: { concurrency: 3 } },
      };

      await siteOverridesService.updateForSite('mangadex', {
        imagePolicy: { delayMs: 150 },
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['mangadex']).toEqual({
        imagePolicy: { delayMs: 150 },
      });
    });

    it('should not affect other sites', async () => {
      mockStorageData['siteOverrides'] = {
        'pixiv-comic': { outputFormat: 'cbz' as const },
        'mangadex': { outputFormat: 'zip' as const },
      };

      await siteOverridesService.updateForSite('pixiv-comic', {
        pathTemplate: '/new/path',
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['mangadex']).toEqual({ outputFormat: 'zip' });
    });
  });

  describe('removeSite', () => {
    it('should remove site override', async () => {
      mockStorageData['siteOverrides'] = {
        'pixiv-comic': { outputFormat: 'cbz' as const },
        'mangadex': { outputFormat: 'zip' as const },
      };

      await siteOverridesService.removeSite('pixiv-comic');

      const overrides = await siteOverridesService.getAll();
      expect(overrides['pixiv-comic']).toBeUndefined();
      expect(overrides['mangadex']).toEqual({ outputFormat: 'zip' });
    });

    it('should not error when removing non-existent site', async () => {
      mockStorageData['siteOverrides'] = {
        'mangadex': { outputFormat: 'cbz' as const },
      };

      await expect(
        siteOverridesService.removeSite('non-existent')
      ).resolves.not.toThrow();

      const overrides = await siteOverridesService.getAll();
      expect(overrides['mangadex']).toEqual({ outputFormat: 'cbz' });
    });

    it('should handle removal from empty overrides', async () => {
      await expect(
        siteOverridesService.removeSite('any-site')
      ).resolves.not.toThrow();

      const overrides = await siteOverridesService.getAll();
      expect(overrides).toEqual({});
    });
  });

  describe('clear', () => {
    it('should clear all overrides', async () => {
      mockStorageData['siteOverrides'] = {
        'pixiv-comic': { outputFormat: 'cbz' as const },
        'mangadex': { outputFormat: 'zip' as const },
        'manganato': { pathTemplate: '/path' },
      };

      await siteOverridesService.clear();

      const overrides = await siteOverridesService.getAll();
      expect(overrides).toEqual({});
    });

    it('should not error when clearing already empty overrides', async () => {
      await expect(
        siteOverridesService.clear()
      ).resolves.not.toThrow();

      const overrides = await siteOverridesService.getAll();
      expect(overrides).toEqual({});
    });
  });

  describe('Override Structure Validation', () => {
    it('should store format override (outputFormat)', async () => {
      await siteOverridesService.updateForSite('mangadex', {
        outputFormat: 'none',
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['mangadex'].outputFormat).toBe('none');
    });

    it('should store path override (pathTemplate)', async () => {
      const customPath = '/custom/{series_title}/{chapter_number}';
      await siteOverridesService.updateForSite('pixiv-comic', {
        pathTemplate: customPath,
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['pixiv-comic'].pathTemplate).toBe(customPath);
    });



    it('should store image policy override', async () => {
      await siteOverridesService.updateForSite('mangadex', {
        imagePolicy: { concurrency: 8, delayMs: 100 },
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['mangadex'].imagePolicy).toEqual({
        concurrency: 8,
        delayMs: 100,
      });
    });

    it('should store chapter policy override', async () => {
      await siteOverridesService.updateForSite('pixiv-comic', {
        chapterPolicy: { concurrency: 2, delayMs: 500 },
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['pixiv-comic'].chapterPolicy).toEqual({
        concurrency: 2,
        delayMs: 500,
      });
    });

    it('should store retry overrides', async () => {
      await siteOverridesService.updateForSite('mangadex', {
        retries: { image: 5, chapter: 2 },
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['mangadex'].retries).toEqual({
        image: 5,
        chapter: 2,
      });
    });



    it('should store multiple override fields together', async () => {
      await siteOverridesService.updateForSite('mangadex', {
        outputFormat: 'cbz',
        pathTemplate: '/manga/{series_title}',
        imagePolicy: { concurrency: 5, delayMs: 200 },
        chapterPolicy: { concurrency: 3 },
        retries: { image: 4, chapter: 2 },
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['mangadex']).toEqual({
        outputFormat: 'cbz',
        pathTemplate: '/manga/{series_title}',
        imagePolicy: { concurrency: 5, delayMs: 200 },
        chapterPolicy: { concurrency: 3 },
        retries: { image: 4, chapter: 2 },
      });
    });
  });

  describe('chrome.storage.local Integration', () => {
    it('should persist overrides across service calls', async () => {
      await siteOverridesService.updateForSite('pixiv-comic', {
        outputFormat: 'cbz',
      });

      // Reset module to simulate new service instance
      vi.resetModules();
      const newModule = await import('@/src/storage/site-overrides-service');
      const newService = newModule.siteOverridesService;

      const overrides = await newService.getAll();
      expect(overrides['pixiv-comic']).toEqual({ outputFormat: 'cbz' });
    });

    it('should use correct storage key', async () => {
      await siteOverridesService.updateForSite('mangadex', {
        outputFormat: 'zip',
      });

      expect(mockStorageData).toHaveProperty('siteOverrides');
      expect(mockStorageData['siteOverrides']).toHaveProperty('mangadex');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty override object', async () => {
      await siteOverridesService.updateForSite('pixiv-comic', {});

      const overrides = await siteOverridesService.getAll();
      expect(overrides['pixiv-comic']).toEqual({});
    });

    it('should handle override with only partial policy fields', async () => {
      await siteOverridesService.updateForSite('mangadex', {
        imagePolicy: { concurrency: 3 },
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['mangadex'].imagePolicy).toEqual({ concurrency: 3 });
      expect(overrides['mangadex'].imagePolicy?.delayMs).toBeUndefined();
    });

    it('should handle special characters in site ID', async () => {
      const siteId = 'site-with-dashes_and_underscores.dots';
      await siteOverridesService.updateForSite(siteId, {
        outputFormat: 'cbz',
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides[siteId]).toEqual({ outputFormat: 'cbz' });
    });

    it('should handle rapid sequential updates', async () => {
      await siteOverridesService.updateForSite('pixiv-comic', {
        outputFormat: 'cbz',
      });
      await siteOverridesService.updateForSite('pixiv-comic', {
        pathTemplate: '/path',
      });
      await siteOverridesService.updateForSite('pixiv-comic', {
        imagePolicy: { concurrency: 5 },
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides['pixiv-comic']).toEqual({
        outputFormat: 'cbz',
        pathTemplate: '/path',
        imagePolicy: { concurrency: 5 },
      });
    });
  });
});
