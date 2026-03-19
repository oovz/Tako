import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRateLimitedFetch = vi.fn();

const makeHtmlResponse = (html: string, contentType = 'text/html; charset=utf-8') => ({
  ok: true,
  headers: {
    get: (name: string) => (name === 'content-type' ? contentType : null),
  },
  arrayBuffer: async () => new TextEncoder().encode(html).buffer,
});

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/src/runtime/rate-limit', () => ({
  rateLimitedFetchByUrlScope: (...args: unknown[]) => mockRateLimitedFetch(...args),
}));

vi.mock('@/src/site-integrations/manifest', () => ({
  getPatternBySiteIntegrationId: vi.fn(() => ({
    domains: ['shonenjumpplus.com'],
    seriesMatches: ['/episode/*'],
  })),
}));

vi.mock('@/src/types/site-integrations', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/src/types/site-integrations')>();
  return {
    ...original,
    IntegrationContextValidator: {
      validateContentScriptContext: vi.fn(),
      validateBackgroundOrOffscreenContext: vi.fn(),
    },
  };
});

describe('Shonen Jump+ integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitedFetch.mockReset();
  });

  it('extracts series metadata from episode-json and DOM selectors', async () => {
    const originalWindow = global.window;
    const originalDocument = global.document;

    Object.defineProperty(global, 'window', {
      value: { location: { pathname: '/episode/10834108156648240735' } },
      configurable: true,
    });
    Object.defineProperty(global, 'document', {
      value: {
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
      },
      configurable: true,
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

    Object.defineProperty(global, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(global, 'document', { value: originalDocument, configurable: true });
  });

  it('falls back to series-header DOM metadata when episode-json is unavailable', async () => {
    const originalWindow = global.window;
    const originalDocument = global.document;

    Object.defineProperty(global, 'window', {
      value: { location: { pathname: '/episode/10834108156648240735' } },
      configurable: true,
    });
    Object.defineProperty(global, 'document', {
      value: {
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
      },
      configurable: true,
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

    Object.defineProperty(global, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(global, 'document', { value: originalDocument, configurable: true });
  });

  it('extracts episode id from /episode/{id}', async () => {
    const originalWindow = global.window;
    Object.defineProperty(global, 'window', {
      value: { location: { pathname: '/episode/10834108156648240735' } },
      configurable: true,
    });

    const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
    expect(shonenJumpPlusIntegration.content.series.getSeriesId()).toBe('10834108156648240735');

    Object.defineProperty(global, 'window', {
      value: originalWindow,
      configurable: true,
    });
  });

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

  it('exposes chapter extraction on the canonical content.series hook', async () => {
    const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
    expect(typeof shonenJumpPlusIntegration.content.series.extractChapterList).toBe('function');
  });

  it('throws when chapter pagination API context is missing', async () => {
    const originalWindow = global.window;
    const originalDocument = global.document;

    Object.defineProperty(global, 'window', {
      value: { location: { origin: 'https://shonenjumpplus.com', pathname: '/episode/10834108156648240735' } },
      configurable: true,
    });
    Object.defineProperty(global, 'document', {
      value: {
        querySelector: vi.fn(() => null),
      },
      configurable: true,
    });

    const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');

    await expect(
      shonenJumpPlusIntegration.content.series.extractChapterList?.()
    ).rejects.toThrow('Shonen Jump+ episode pagination context not found in DOM');

    Object.defineProperty(global, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(global, 'document', { value: originalDocument, configurable: true });
  });

  it('fetches full chapter list via pagination API and marks paid chapters as locked', async () => {
    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalFetch = global.fetch;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/readable_product_pagination_information')) {
        return {
          ok: true,
          json: async () => ({ per_page: 2, readable_products_count: 3 }),
        } as Response;
      }

      if (url.includes('offset=0')) {
        return {
          ok: true,
          json: async () => ([
            {
              readable_product_id: '300',
              viewer_uri: '/episode/300',
              title: '3話',
              status: { label: 'is_rentable', rental_price: 40 },
            },
            {
              readable_product_id: '200',
              viewer_uri: '/episode/200',
              title: '2話',
              status: { label: 'is_free', rental_price: null },
            },
          ]),
        } as Response;
      }

      if (url.includes('offset=2')) {
        return {
          ok: true,
          json: async () => ([
            {
              readable_product_id: '100',
              viewer_uri: '/episode/100',
              title: '1話',
              status: { label: 'is_buyable', buy_price: 120 },
            },
          ]),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response;
    });

    Object.defineProperty(global, 'window', {
      value: {
        location: {
          origin: 'https://shonenjumpplus.com',
          pathname: '/episode/10834108156648240735',
        },
      },
      configurable: true,
    });
    Object.defineProperty(global, 'document', {
      value: {
        querySelector: vi.fn((selector: string) => (
          selector === '.js-readable-products-pagination'
            ? { getAttribute: (name: string) => (name === 'data-aggregate-id' ? '10834108156648240732' : null) }
            : null
        )),
      },
      configurable: true,
    });
    Object.defineProperty(global, 'fetch', {
      value: fetchMock,
      configurable: true,
    });

    const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
    const chapterResult = await shonenJumpPlusIntegration.content.series.extractChapterList?.();
    const chapters = Array.isArray(chapterResult) ? chapterResult : (chapterResult?.chapters ?? []);

    expect(chapters).toHaveLength(3);
    expect(chapters.map((chapter) => chapter.id)).toEqual(['300', '200', '100']);
    expect(chapters.map((chapter) => chapter.locked)).toEqual([true, false, true]);
    expect(chapters.every((chapter) => chapter.volumeLabel === undefined && chapter.volumeNumber === undefined)).toBe(true);

    Object.defineProperty(global, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(global, 'document', { value: originalDocument, configurable: true });
    Object.defineProperty(global, 'fetch', { value: originalFetch, configurable: true });
  });

  it('ignores non-episode entries to keep episodes-only support', async () => {
    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalFetch = global.fetch;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/readable_product_pagination_information')) {
        return {
          ok: true,
          json: async () => ({ per_page: 50, readable_products_count: 2 }),
        } as Response;
      }

      if (url.includes('/pagination_readable_products')) {
        return {
          ok: true,
          json: async () => ([
            {
              readable_product_id: '900',
              viewer_uri: '/episode/900',
              title: '900話',
              status: { label: 'is_free' },
            },
            {
              readable_product_id: '901',
              viewer_uri: '/volume/901',
              title: '単行本1',
              status: { label: 'is_buyable', buy_price: 600 },
            },
          ]),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response;
    });

    Object.defineProperty(global, 'window', {
      value: {
        location: {
          origin: 'https://shonenjumpplus.com',
          pathname: '/episode/10834108156648240735',
        },
      },
      configurable: true,
    });
    Object.defineProperty(global, 'document', {
      value: {
        querySelector: vi.fn((selector: string) => (
          selector === '.js-readable-products-pagination'
            ? { getAttribute: (name: string) => (name === 'data-aggregate-id' ? '10834108156648240732' : null) }
            : null
        )),
      },
      configurable: true,
    });
    Object.defineProperty(global, 'fetch', {
      value: fetchMock,
      configurable: true,
    });

    const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
    const chapterResult = await shonenJumpPlusIntegration.content.series.extractChapterList?.();
    const chapters = Array.isArray(chapterResult) ? chapterResult : (chapterResult?.chapters ?? []);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({
      id: '900',
      url: 'https://shonenjumpplus.com/episode/900',
      locked: false,
    });

    Object.defineProperty(global, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(global, 'document', { value: originalDocument, configurable: true });
    Object.defineProperty(global, 'fetch', { value: originalFetch, configurable: true });
  });

  it('logs invariant error when duplicate chapter ids are returned with different URLs', async () => {
    const logger = await import('@/src/runtime/logger');
    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalFetch = global.fetch;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/readable_product_pagination_information')) {
        return {
          ok: true,
          json: async () => ({ per_page: 50, readable_products_count: 2 }),
        } as Response;
      }

      if (url.includes('/pagination_readable_products')) {
        return {
          ok: true,
          json: async () => ([
            {
              readable_product_id: '901',
              viewer_uri: '/episode/901',
              title: '901話',
              status: { label: 'is_free' },
            },
            {
              readable_product_id: '901',
              viewer_uri: '/episode/901?from=alt',
              title: '901話 重複',
              status: { label: 'is_buyable', buy_price: 120 },
            },
          ]),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response;
    });

    Object.defineProperty(global, 'window', {
      value: {
        location: {
          origin: 'https://shonenjumpplus.com',
          pathname: '/episode/10834108156648240735',
        },
      },
      configurable: true,
    });
    Object.defineProperty(global, 'document', {
      value: {
        querySelector: vi.fn((selector: string) => (
          selector === '.js-readable-products-pagination'
            ? { getAttribute: (name: string) => (name === 'data-aggregate-id' ? '10834108156648240732' : null) }
            : null
        )),
      },
      configurable: true,
    });
    Object.defineProperty(global, 'fetch', {
      value: fetchMock,
      configurable: true,
    });

    const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
    const extractChapterList = shonenJumpPlusIntegration.content.series.extractChapterList;
    expect(extractChapterList).toBeDefined();
    if (!extractChapterList) {
      throw new Error('Expected extractChapterList to be defined');
    }
    const chapterResult = await extractChapterList();
    const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

    expect(chapters).toHaveLength(1);
    expect(chapters[0].id).toBe('901');
    expect(logger.default.error).toHaveBeenCalledWith(
      '[shonenjumpplus] Duplicate chapter ids detected in fetchChapterList',
      expect.objectContaining({
        aggregateId: '10834108156648240732',
        duplicateChapterIds: ['901'],
      }),
    );

    Object.defineProperty(global, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(global, 'document', { value: originalDocument, configurable: true });
    Object.defineProperty(global, 'fetch', { value: originalFetch, configurable: true });
  });
});

