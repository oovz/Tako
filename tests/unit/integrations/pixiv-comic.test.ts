import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';

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
    domains: ['comic.pixiv.net'],
    seriesMatches: ['/works/*'],
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

describe('Pixiv Comic integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitedFetch.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('extracts work id from /works/{id}', async () => {
    const originalWindow = global.window;
    Object.defineProperty(global, 'window', {
      value: { location: { pathname: '/works/9012' } },
      configurable: true,
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    expect(pixivComicIntegration.content.series.getSeriesId()).toBe('9012');

    Object.defineProperty(global, 'window', {
      value: originalWindow,
      configurable: true,
    });
  });

  it('extracts work id from og:url metadata when on viewer route', async () => {
    const originalWindow = global.window;
    const originalDocument = global.document;

    Object.defineProperty(global, 'window', {
      value: {
        location: {
          origin: 'https://comic.pixiv.net',
          pathname: '/viewer/stories/44495',
        },
      },
      configurable: true,
    });

    Object.defineProperty(global, 'document', {
      value: {
        querySelector: vi.fn((selector: string) => {
          if (selector === 'meta[property="og:url"]') {
            return { getAttribute: () => 'https://comic.pixiv.net/works/9012' };
          }
          return null;
        }),
        querySelectorAll: vi.fn(() => []),
      },
      configurable: true,
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    expect(pixivComicIntegration.content.series.getSeriesId()).toBe('9012');

    Object.defineProperty(global, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(global, 'document', { value: originalDocument, configurable: true });
  });

  it('waitForPageReady resolves immediately when the work id is already in the pathname', async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();

    class MockMutationObserver {
      observe = observe;
      disconnect = disconnect;

      constructor(_callback: MutationCallback) {}
    }

    vi.stubGlobal('window', {
      location: {
        origin: 'https://comic.pixiv.net',
        pathname: '/works/9012',
      },
    });

    vi.stubGlobal('document', {
      querySelector: vi.fn(() => null),
      documentElement: {},
      body: {},
      head: {},
    });

    vi.stubGlobal('MutationObserver', MockMutationObserver);

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');

    await expect(pixivComicIntegration.content.series.waitForPageReady?.()).resolves.toBeUndefined();
    expect(observe).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('waitForPageReady resolves when Pixiv metadata hydrates via DOM mutation', async () => {
    vi.useFakeTimers();

    let metadataUrl: string | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    let mutationCallback: MutationCallback | undefined;

    class MockMutationObserver {
      observe = observe;
      disconnect = disconnect;

      constructor(callback: MutationCallback) {
        mutationCallback = callback;
      }
    }

    vi.stubGlobal('window', {
      location: {
        origin: 'https://comic.pixiv.net',
        pathname: '/viewer/stories/44495',
      },
    });

    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => {
        if (selector === 'meta[property="og:url"]') {
          return metadataUrl ? { getAttribute: () => metadataUrl } : null;
        }

        return null;
      }),
      documentElement: {},
      body: {},
      head: {},
    });

    vi.stubGlobal('MutationObserver', MockMutationObserver);

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');

    const readyPromise = pixivComicIntegration.content.series.waitForPageReady?.();
    await Promise.resolve();

    expect(observe).toHaveBeenCalledTimes(1);
    expect(mutationCallback).toBeTypeOf('function');

    metadataUrl = 'https://comic.pixiv.net/works/9012';
    mutationCallback?.([], {} as MutationObserver);

    await expect(readyPromise).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('builds dispatch cookie header when pixiv cookies exist', async () => {
    const chromeMock = {
      cookies: {
        getAll: vi.fn(async () => ([
          { name: 'PHPSESSID', value: 'abc' },
          { name: 'foo', value: 'bar' },
        ])),
      },
    };
    (globalThis as { chrome?: unknown }).chrome = chromeMock;

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    const context = await pixivComicIntegration.background.prepareDispatchContext?.({
      taskId: 'task-1',
      seriesKey: 'pixiv-comic#9012',
      chapter: { id: 'c1', url: 'https://comic.pixiv.net/viewer/stories/1', title: 'Episode 1', comicInfo: {} },
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'pixiv-comic'),
      },
    });

    expect(context).toEqual({ cookieHeader: 'PHPSESSID=abc; foo=bar' });
  });

  it('downloads image through rate-limited fetch', async () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;
    mockRateLimitedFetch.mockResolvedValue({
      ok: true,
      headers: { get: (name: string) => (name === 'content-type' ? 'image/webp' : null) },
      arrayBuffer: async () => payload,
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    const result = await pixivComicIntegration.background.chapter.downloadImage('https://img.pixiv.net/a/b/c/page01.webp');

    expect(result.mimeType).toBe('image/webp');
    expect(result.filename).toBe('page01.webp');
    expect(result.data.byteLength).toBe(3);
  });

  it('resolves image urls via Pixiv API and refreshes stale build id on 404', async () => {
    mockRateLimitedFetch
      .mockResolvedValueOnce(makeHtmlResponse('<script src="/_next/static/build-old/_buildManifest.js"></script>'))
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
      })
      .mockResolvedValueOnce(makeHtmlResponse('<script src="/_next/static/build-new/_buildManifest.js"></script>'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pageProps: {
            story: {
              reading_episode: {
                pages: [
                  { src: 'https://img.pixiv.net/chapters/100/001.jpg', key: 'k1' },
                  { src: 'https://img.pixiv.net/chapters/100/002.jpg', key: 'k2' },
                ],
              },
            },
            salt: 'salt-value',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pages: [
            { url: 'https://img.pixiv.net/chapters/100/001.jpg', key: 'k1' },
            { url: 'https://img.pixiv.net/chapters/100/002.jpg', key: 'k2' },
          ],
        }),
      });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    const urls = await pixivComicIntegration.background.chapter.resolveImageUrls?.(
      {
        id: '100',
        url: 'https://comic.pixiv.net/viewer/stories/100',
      },
      {
        taskId: 'task-100',
        cookieHeader: 'PHPSESSID=abc',
      },
    );

    expect(urls).toEqual([
      'https://img.pixiv.net/chapters/100/001.jpg#tmdPixivKey=azE%3D',
      'https://img.pixiv.net/chapters/100/002.jpg#tmdPixivKey=azI%3D',
    ]);

    const calls = mockRateLimitedFetch.mock.calls.map((call) => String(call[0]));
    expect(calls.some((url) => url.includes('/_next/data/build-old/viewer/stories/100.json'))).toBe(true);
    expect(calls.some((url) => url.includes('/_next/data/build-new/viewer/stories/100.json'))).toBe(true);
  });

  it('resolves image urls when read_v4 returns pages under data.reading_episode', async () => {
    mockRateLimitedFetch
      .mockResolvedValueOnce(makeHtmlResponse('<script src="/_next/static/build-3/_buildManifest.js"></script>'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pageProps: {
            salt: 'salt-value',
            story: {
              reading_episode: {
                pages: [],
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            reading_episode: {
              pages: [
                { src: 'https://img.pixiv.net/chapters/103/001.jpg', key: 'k1' },
                { src: 'https://img.pixiv.net/chapters/103/002.jpg', key: 'k2' },
              ],
            },
          },
        }),
      });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    const urls = await pixivComicIntegration.background.chapter.resolveImageUrls?.(
      {
        id: '103',
        url: 'https://comic.pixiv.net/viewer/stories/103',
      },
      {
        taskId: 'task-103',
      },
    );

    expect(urls).toEqual([
      'https://img.pixiv.net/chapters/103/001.jpg#tmdPixivKey=azE%3D',
      'https://img.pixiv.net/chapters/103/002.jpg#tmdPixivKey=azI%3D',
    ]);
  });

  it('logs debug details when image descrambling is applied during download', async () => {
    mockRateLimitedFetch.mockResolvedValue({
      ok: true,
      headers: { get: (name: string) => (name === 'content-type' ? 'image/webp' : null) },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    await pixivComicIntegration.background.chapter.downloadImage('https://img.pixiv.net/a/b/c/page01.webp#tmdPixivKey=azE%3D');
  });

  it('sets fetch referrer metadata and sends gridshuffle key header when downloading chapter images from pixiv CDN', async () => {
    mockRateLimitedFetch.mockResolvedValue({
      ok: true,
      headers: { get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null) },
      arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer,
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    const abortController = new AbortController();
    await pixivComicIntegration.background.chapter.downloadImage(
      'https://img-comic.pximg.net/a/b/c/page01.jpg?foo=bar#tmdPixivKey=azE%3D',
      {
        signal: abortController.signal,
        context: {
          cookieHeader: 'PHPSESSID=abc123',
        },
      },
    );

    expect(mockRateLimitedFetch).toHaveBeenCalledTimes(1);
    const [, scope, requestInit] = mockRateLimitedFetch.mock.calls[0] as [string, string, RequestInit];
    expect(scope).toBe('image');
    expect(requestInit.credentials).toBe('include');
    expect(requestInit.referrer).toBe('https://comic.pixiv.net/');
    expect(requestInit.referrerPolicy).toBe('strict-origin-when-cross-origin');
    expect(requestInit.signal).toBe(abortController.signal);

    expect(requestInit.headers).toEqual({
      referer: 'https://comic.pixiv.net/',
      'x-cobalt-thumber-parameter-gridshuffle-key': 'k1',
    });
  });

  it('preserves key-only signed query params when fetching chapter image URLs', async () => {
    mockRateLimitedFetch.mockResolvedValue({
      ok: true,
      headers: { get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null) },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    await pixivComicIntegration.background.chapter.downloadImage(
      'https://img-comic.pximg.net/c/q90_gridshuffle32:32/images/page/136645/jEPBvqSTmG1KdJJGxzSS/1.jpg?20230208180812#tmdPixivKey=azE%3D',
    );

    expect(mockRateLimitedFetch).toHaveBeenCalledTimes(1);
    const [requestedUrl] = mockRateLimitedFetch.mock.calls[0] as [string, string, RequestInit];
    expect(requestedUrl).toBe('https://img-comic.pximg.net/c/q90_gridshuffle32:32/images/page/136645/jEPBvqSTmG1KdJJGxzSS/1.jpg?20230208180812');
    expect(requestedUrl.includes('?20230208180812=')).toBe(false);
  });

  it('omits optional content-side chapter and metadata extractors because Pixiv uses API extraction', async () => {
    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');

    expect(pixivComicIntegration.content.series.extractChapterList).toBeUndefined();
    expect(pixivComicIntegration.content.series.extractSeriesMetadata).toBeUndefined();
  });

  it('fetches series metadata from works/v5 API including author', async () => {
    mockRateLimitedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          official_work: {
            id: 9012,
            name: '煙たい話',
            author: '林史也',
            description: '★コミックス①〜⑥巻好評発売中★<br><br>恋じゃない。',
            image: {
              main_big: 'https://img-comic.pximg.net/images/work_main/9012.jpg',
              thumbnail: 'https://public-img-comic.pximg.net/images/work_thumbnail/9012.jpg',
            },
          },
        },
      }),
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    const metadata = await pixivComicIntegration.background.series!.fetchSeriesMetadata('9012');

    expect(metadata).toMatchObject({
      title: '煙たい話',
      author: '林史也',
      description: '★コミックス①〜⑥巻好評発売中★ 恋じゃない。',
      coverUrl: 'https://img-comic.pximg.net/images/work_main/9012.jpg',
    });
  });

  it('fetches chapter list from episodes/v2 API and maps readable/locked entries', async () => {
    mockRateLimitedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          episodes: [
            {
              state: 'readable',
              episode: {
                id: 136645,
                numbering_title: '第1話',
                sub_title: '',
                viewer_path: '/viewer/stories/136645',
              },
            },
            {
              state: 'unreadable',
              episode: {
                id: 200001,
                numbering_title: '第2話',
                sub_title: '有料',
                viewer_path: '/viewer/stories/200001',
              },
            },
          ],
        },
      }),
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    const chapterResult = await pixivComicIntegration.background.series!.fetchChapterList('9012');
    const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({
      id: '136645',
      url: 'https://comic.pixiv.net/viewer/stories/136645',
      title: '第1話',
      locked: false,
      chapterNumber: 1,
    });
    expect(chapters[1]).toMatchObject({
      id: '200001',
      url: 'https://comic.pixiv.net/viewer/stories/200001',
      title: '第2話 有料',
      locked: true,
      chapterNumber: 2,
    });
  });

  it('keeps repeated Pixiv chapter titles as separate chapters when ids and urls differ', async () => {
    mockRateLimitedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          episodes: [
            {
              state: 'readable',
              episode: {
                id: 79887,
                numbering_title: '第1話',
                sub_title: '',
                viewer_path: '/viewer/stories/79887',
              },
            },
            {
              state: 'readable',
              episode: {
                id: 126686,
                numbering_title: '第1話',
                sub_title: '',
                viewer_path: '/viewer/stories/126686',
              },
            },
          ],
        },
      }),
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    const chapterResult = await pixivComicIntegration.background.series!.fetchChapterList('6842');
    const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

    expect(chapters).toHaveLength(2);
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第1話', '第1話']);
    expect(chapters.map((chapter) => chapter.chapterNumber)).toEqual([1, 1]);
    expect(chapters.map((chapter) => chapter.id)).toEqual(['79887', '126686']);
  });

  it('combines numbering title and subtitle while parsing full-width Pixiv chapter numerals', async () => {
    mockRateLimitedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          episodes: [
            {
              state: 'readable',
              episode: {
                id: 68314,
                numbering_title: '第１話',
                sub_title: '岡野部長は友達がいない(1)',
                viewer_path: '/viewer/stories/68314',
              },
            },
          ],
        },
      }),
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    const chapterResult = await pixivComicIntegration.background.series!.fetchChapterList('6289');
    const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({
      id: '68314',
      url: 'https://comic.pixiv.net/viewer/stories/68314',
      title: '第１話 岡野部長は友達がいない(1)',
      chapterLabel: '第１話',
      chapterNumber: 1,
      locked: false,
    });
  });

  it('requests chapter list using ascending order to match 最初から order', async () => {
    mockRateLimitedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { episodes: [] } }),
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    await pixivComicIntegration.background.series!.fetchChapterList('9012');

    const calls = mockRateLimitedFetch.mock.calls.map((call) => String(call[0]));
    expect(calls.some((url) => url.includes('/api/app/works/9012/episodes/v2?order=asc'))).toBe(true);
  });

  it('sends read_v4 x-client-time header without milliseconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T11:22:33.789Z'));

    mockRateLimitedFetch
      .mockResolvedValueOnce(makeHtmlResponse('<script src="/_next/static/build-1/_buildManifest.js"></script>'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pageProps: {
            story: {
              reading_episode: {
                pages: [{ src: 'https://img.pixiv.net/chapters/101/001.jpg', key: 'k1' }],
              },
            },
            salt: 'salt-value',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pages: [{ url: 'https://img.pixiv.net/chapters/101/001.jpg', key: 'k1' }],
        }),
      });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    await pixivComicIntegration.background.chapter.resolveImageUrls?.(
      {
        id: '101',
        url: 'https://comic.pixiv.net/viewer/stories/101',
      },
      {
        taskId: 'task-101',
        cookieHeader: 'PHPSESSID=abc',
      },
    );

    const readV4Call = mockRateLimitedFetch.mock.calls.find((call) => String(call[0]).includes('/api/app/episodes/101/read_v4'));
    expect(readV4Call).toBeDefined();

    const requestInit = readV4Call?.[2] as { headers?: HeadersInit } | undefined;
    const headers = requestInit?.headers;
    const clientTime = headers instanceof Headers
      ? headers.get('x-client-time')
      : (headers as Record<string, string> | undefined)?.['x-client-time'];
    expect(clientTime).toBe('2026-03-01T11:22:33Z');
  });

  it('derives read_v4 x-client-hash from normalized timestamp and salt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T11:22:33.789Z'));

    mockRateLimitedFetch
      .mockResolvedValueOnce(makeHtmlResponse('<script src="/_next/static/build-2/_buildManifest.js"></script>'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pageProps: {
            story: {
              reading_episode: {
                pages: [{ src: 'https://img.pixiv.net/chapters/102/001.jpg', key: 'k1' }],
              },
            },
            salt: 'salt-for-hash',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pages: [{ url: 'https://img.pixiv.net/chapters/102/001.jpg', key: 'k1' }],
        }),
      });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    await pixivComicIntegration.background.chapter.resolveImageUrls?.(
      {
        id: '102',
        url: 'https://comic.pixiv.net/viewer/stories/102',
      },
      {
        taskId: 'task-102',
        cookieHeader: 'PHPSESSID=abc',
      },
    );

    const readV4Call = mockRateLimitedFetch.mock.calls.find((call) => String(call[0]).includes('/api/app/episodes/102/read_v4'));
    const requestInit = readV4Call?.[2] as { headers?: HeadersInit } | undefined;
    const headers = requestInit?.headers;
    const actualHash = headers instanceof Headers
      ? headers.get('x-client-hash')
      : (headers as Record<string, string> | undefined)?.['x-client-hash'];

    const payload = '2026-03-01T11:22:33Zsalt-for-hash';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    const expectedHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
    expect(actualHash).toBe(expectedHash);
  });

  it('deduplicates chapters by URL and keeps the readable entry', async () => {
    mockRateLimitedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          episodes: [
            {
              state: 'unreadable',
              episode: {
                id: 300001,
                numbering_title: '第3話',
                sub_title: '先行配信',
                viewer_path: '/viewer/stories/300001',
              },
            },
            {
              state: 'readable',
              episode: {
                id: 300001,
                numbering_title: '第3話',
                sub_title: '',
                viewer_path: '/viewer/stories/300001',
              },
            },
          ],
        },
      }),
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    const chapterResult = await pixivComicIntegration.background.series!.fetchChapterList('9012');
    const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({
      id: '300001',
      url: 'https://comic.pixiv.net/viewer/stories/300001',
      locked: false,
    });
  });

  it('logs invariant error when duplicate chapter ids are returned with different URLs', async () => {
    const logger = await import('@/src/runtime/logger');

    mockRateLimitedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          episodes: [
            {
              state: 'readable',
              episode: {
                id: 400001,
                numbering_title: '第4話',
                sub_title: '',
                viewer_path: '/viewer/stories/400001',
              },
            },
            {
              state: 'unreadable',
              episode: {
                id: 400001,
                numbering_title: '第4話',
                sub_title: '有料',
                viewer_path: '/episodes/400001',
              },
            },
          ],
        },
      }),
    });

    const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
    const chapterResult = await pixivComicIntegration.background.series!.fetchChapterList('9012');
    const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

    expect(chapters).toHaveLength(1);
    expect(chapters[0].id).toBe('400001');
    expect(logger.default.error).toHaveBeenCalledWith(
      '[pixiv-comic] Duplicate chapter ids detected in fetchChapterList',
      expect.objectContaining({
        seriesId: '9012',
        duplicateChapterIds: ['400001'],
      }),
    );
  });
});

