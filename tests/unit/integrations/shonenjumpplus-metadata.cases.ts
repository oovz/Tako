import { describe, expect, it, vi } from 'vitest';
import {
  captureBrowserGlobals,
  restoreBrowserGlobals,
  setTestDocument,
  setTestWindow,
} from './shonenjumpplus-test-setup';

export function registerShonenJumpPlusMetadataCases(): void {
  describe('Shonen Jump+ integration', () => {
    it('extracts series metadata from episode-json and DOM selectors', async () => {
      const snapshot = captureBrowserGlobals();

      setTestWindow({ location: { pathname: '/episode/10834108156648240735' } });
      setTestDocument({
        title: '[1話]SPY×FAMILY - 遠藤達哉 | 少年ジャンプ＋',
        querySelector: vi.fn((selector: string) => {
          if (selector === 'script#episode-json') {
            return {
              getAttribute: (name: string) => (
                name === 'data-value'
                  ? '{&quot;readableProduct&quot;:{&quot;series&quot;:{&quot;title&quot;:&quot;SPY×FAMILY&quot;,&quot;thumbnailUri&quot;:&quot;https://cdn-ak-img.shonenjumpplus.com/public/series-thumbnail/json-cover.png&quot;}}}'
                  : null
              ),
            };
          }
          if (selector === '.series-header-author') {
            return { textContent: '遠藤達哉' };
          }
          if (selector === '.series-header-description') {
            return { textContent: 'スパイ×アクション×特殊家族コメディ！' };
          }
          if (selector === 'meta[property="og:description"]') {
            return { getAttribute: () => 'OG fallback description' };
          }
          if (selector === 'meta[property="og:image"]') {
            return { getAttribute: () => 'https://cdn-ak-img.shonenjumpplus.com/public/series-thumbnail/og-cover.png' };
          }
          return null;
        }),
      });

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
      const extractSeriesMetadata = shonenJumpPlusIntegration.content.series.extractSeriesMetadata;
      expect(extractSeriesMetadata).toBeDefined();
      if (!extractSeriesMetadata) {
        throw new Error('Expected extractSeriesMetadata to be defined');
      }
      const metadata = extractSeriesMetadata();

      expect(metadata).toMatchObject({
        title: 'SPY×FAMILY',
        author: '遠藤達哉',
        description: 'スパイ×アクション×特殊家族コメディ！',
        coverUrl: 'https://cdn-ak-img.shonenjumpplus.com/public/series-thumbnail/json-cover.png',
        language: 'ja',
        readingDirection: 'rtl',
      });

      restoreBrowserGlobals(snapshot);
    });

    it('falls back to series-header DOM metadata when episode-json is unavailable', async () => {
      const snapshot = captureBrowserGlobals();

      setTestWindow({ location: { pathname: '/episode/10834108156648240735' } });
      setTestDocument({
        title: 'fallback title',
        querySelector: vi.fn((selector: string) => {
          if (selector === 'script#episode-json') {
            return null;
          }
          if (selector === '.series-header-title') {
            return { textContent: 'DOM Series Title' };
          }
          if (selector === '.series-header-author') {
            return { textContent: 'DOM Author' };
          }
          if (selector === '.series-header-description') {
            return { textContent: 'DOM Description' };
          }
          if (selector === 'meta[property="og:image"]') {
            return { getAttribute: () => 'https://cdn-ak-img.shonenjumpplus.com/public/series-thumbnail/dom-cover.png' };
          }
          return null;
        }),
      });

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
      const extractSeriesMetadata = shonenJumpPlusIntegration.content.series.extractSeriesMetadata;
      expect(extractSeriesMetadata).toBeDefined();
      if (!extractSeriesMetadata) {
        throw new Error('Expected extractSeriesMetadata to be defined');
      }
      const metadata = extractSeriesMetadata();

      expect(metadata).toMatchObject({
        title: 'DOM Series Title',
        author: 'DOM Author',
        description: 'DOM Description',
        coverUrl: 'https://cdn-ak-img.shonenjumpplus.com/public/series-thumbnail/dom-cover.png',
        language: 'ja',
        readingDirection: 'rtl',
      });

      restoreBrowserGlobals(snapshot);
    });

    it('extracts episode id from /episode/{id}', async () => {
      const snapshot = captureBrowserGlobals();
      setTestWindow({ location: { pathname: '/episode/10834108156648240735' } });

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
      expect(shonenJumpPlusIntegration.content.series.getSeriesId()).toBe('10834108156648240735');

      restoreBrowserGlobals(snapshot);
    });
  });
}
