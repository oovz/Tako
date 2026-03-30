import { describe, expect, it, vi } from 'vitest';
import { mockStorageData, siteOverridesService } from './site-overrides-service-test-setup';

export function registerSiteOverridesStructureAndIntegrationCases(): void {
  describe('Override Structure Validation', () => {
    it('should store format override (outputFormat)', async () => {
      await siteOverridesService.updateForSite('mangadex', {
        outputFormat: 'none',
      });

      const overrides = await siteOverridesService.getAll();
      expect(overrides.mangadex.outputFormat).toBe('none');
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
      expect(overrides.mangadex.imagePolicy).toEqual({
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
      expect(overrides.mangadex.retries).toEqual({
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
      expect(overrides.mangadex).toEqual({
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
      expect(mockStorageData.siteOverrides).toHaveProperty('mangadex');
    });
  });
}
