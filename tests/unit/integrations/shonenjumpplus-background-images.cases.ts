import { describe, expect, it } from 'vitest';
import { makeHtmlResponse, mockRateLimitedFetch } from './shonenjumpplus-test-setup';

export function registerShonenJumpPlusBackgroundImageCases(): void {
  describe('Shonen Jump+ integration', () => {
    it('resolves ordered image urls and seed token from episode-json script in HTML', async () => {
      mockRateLimitedFetch.mockResolvedValue(makeHtmlResponse([
        '<script id="episode-json" type="text/json" data-value="',
        '{&quot;readableProduct&quot;:{&quot;pageStructure&quot;:{&quot;pages&quot;:[',
        '{&quot;type&quot;:&quot;link&quot;},',
        '{&quot;type&quot;:&quot;main&quot;,&quot;src&quot;:&quot;https://cdn-ak-img.shonenjumpplus.com/public/page/2/10834108156648241044-31ea188b967b3694d8fcda5d2fba3bec&quot;,&quot;contentStart&quot;:&quot;ec130631&quot;},',
        '{&quot;type&quot;:&quot;main&quot;,&quot;src&quot;:&quot;https://cdn-ak-img.shonenjumpplus.com/public/page/2/10834108156648241045-cde6916c0ddbf4d2d6cd08e7a5547a98&quot;}',
        ']}}}',
        '"></script>',
      ].join('')));

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
      const urls = await shonenJumpPlusIntegration.background.chapter.parseImageUrlsFromHtml?.({
        chapterId: '10834108156648240735',
        chapterUrl: 'https://shonenjumpplus.com/episode/10834108156648240735',
        chapterHtml: [
          '<script id="episode-json" type="text/json" data-value="',
          '{&quot;readableProduct&quot;:{&quot;pageStructure&quot;:{&quot;pages&quot;:[',
          '{&quot;type&quot;:&quot;link&quot;},',
          '{&quot;type&quot;:&quot;main&quot;,&quot;src&quot;:&quot;https://cdn-ak-img.shonenjumpplus.com/public/page/2/10834108156648241044-31ea188b967b3694d8fcda5d2fba3bec&quot;,&quot;contentStart&quot;:&quot;ec130631&quot;},',
          '{&quot;type&quot;:&quot;main&quot;,&quot;src&quot;:&quot;https://cdn-ak-img.shonenjumpplus.com/public/page/2/10834108156648241045-cde6916c0ddbf4d2d6cd08e7a5547a98&quot;}',
          ']}}}',
          '"></script>',
        ].join(''),
      });

      expect(urls).toBeDefined();
      expect(urls).toHaveLength(2);
      expect(urls![0]).toMatch(/^https:\/\/cdn-ak-img\.shonenjumpplus\.com\/public\/page\/2\/10834108156648241044-31ea188b967b3694d8fcda5d2fba3bec\?sjpSeed=/);
      expect(urls![1]).toMatch(/^https:\/\/cdn-ak-img\.shonenjumpplus\.com\/public\/page\/2\/10834108156648241045-cde6916c0ddbf4d2d6cd08e7a5547a98\?sjpSeed=/);
    });

    it('returns an empty array when episode-json script is unavailable', async () => {
      mockRateLimitedFetch.mockResolvedValue(makeHtmlResponse([
        '"src":"https://cdn-ak-img.shonenjumpplus.com/public/page/2/10834108156648241044-31ea188b967b3694d8fcda5d2fba3bec"',
        '"src":"https://cdn-ak-img.shonenjumpplus.com/public/page/2/10834108156648241045-cde6916c0ddbf4d2d6cd08e7a5547a98"',
      ].join(',')));

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
      const urls = await shonenJumpPlusIntegration.background.chapter.parseImageUrlsFromHtml?.({
        chapterId: '10834108156648240735',
        chapterUrl: 'https://shonenjumpplus.com/episode/10834108156648240735',
        chapterHtml: [
          '"src":"https://cdn-ak-img.shonenjumpplus.com/public/page/2/10834108156648241044-31ea188b967b3694d8fcda5d2fba3bec"',
          '"src":"https://cdn-ak-img.shonenjumpplus.com/public/page/2/10834108156648241045-cde6916c0ddbf4d2d6cd08e7a5547a98"',
        ].join(','),
      });

      expect(urls).toEqual([]);
    });

    it('downloads chapter image through rate-limited fetch', async () => {
      const payload = new Uint8Array([1, 2, 3, 4]).buffer;
      mockRateLimitedFetch.mockResolvedValue({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null) },
        arrayBuffer: async () => payload,
      });

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
      const image = await shonenJumpPlusIntegration.background.chapter.downloadImage('https://cdn-ak.shonenjumpplus.com/pages/001.jpg');

      expect(image.filename).toBe('001.jpg');
      expect(image.mimeType).toBe('image/jpeg');
      expect(image.data.byteLength).toBe(4);
    });

    it('rejects non-raster image responses before returning downloaded image data', async () => {
      mockRateLimitedFetch.mockResolvedValue({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'text/html; charset=utf-8' : null) },
        arrayBuffer: async () => new TextEncoder().encode('<html>captcha</html>').buffer,
      });

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');

      await expect(
        shonenJumpPlusIntegration.background.chapter.downloadImage('https://cdn-ak.shonenjumpplus.com/pages/001.jpg'),
      ).rejects.toThrow('Unsupported MIME type: text/html');
    });

    it('resolveImageUrls uses episode-json script and does not call legacy JSON fallback', async () => {
      mockRateLimitedFetch.mockResolvedValue(makeHtmlResponse([
        '<script id="episode-json" type="text/json" data-value="',
        '{&quot;readableProduct&quot;:{&quot;pageStructure&quot;:{&quot;pages&quot;:[',
        '{&quot;type&quot;:&quot;main&quot;,&quot;src&quot;:&quot;https://cdn-ak-img.shonenjumpplus.com/public/page/2/10834108156648241044-31ea188b967b3694d8fcda5d2fba3bec&quot;,&quot;contentStart&quot;:&quot;ec130631&quot;}',
        ']}}}',
        '"></script>',
      ].join('')));

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
      const urls = await shonenJumpPlusIntegration.background.chapter.resolveImageUrls?.({
        id: '10834108156648240735',
        url: 'https://shonenjumpplus.com/episode/10834108156648240735',
      });

      expect(urls).toHaveLength(1);
      expect(urls?.[0]).toMatch(/^https:\/\/cdn-ak-img\.shonenjumpplus\.com\/public\/page\/2\/10834108156648241044-31ea188b967b3694d8fcda5d2fba3bec\?sjpSeed=/);
      expect(mockRateLimitedFetch).toHaveBeenCalledTimes(1);
      expect(mockRateLimitedFetch).toHaveBeenCalledWith('https://shonenjumpplus.com/episode/10834108156648240735', 'chapter');
    });
  });
}
