import { describe, expect, it } from 'vitest';
import { siteOverridesService } from './site-overrides-service-test-setup';

export function registerSiteOverridesEdgeCases(): void {
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
      expect(overrides.mangadex.imagePolicy).toEqual({ concurrency: 3 });
      expect(overrides.mangadex.imagePolicy?.delayMs).toBeUndefined();
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
}
