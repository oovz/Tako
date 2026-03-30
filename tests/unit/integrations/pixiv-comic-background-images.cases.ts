import { describe, expect, it, vi } from 'vitest';
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot';
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings';
import { makeHtmlResponse, mockRateLimitedFetch } from './pixiv-comic-test-setup';

export function registerPixivComicBackgroundImageCases(): void {
  describe('Pixiv Comic integration', () => {
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
        }
      );

      expect(urls).toEqual([
        'https://img.pixiv.net/chapters/100/001.jpg#tmdPixivKey=azE%3D',
        'https://img.pixiv.net/chapters/100/002.jpg#tmdPixivKey=azI%3D',
      ]);

      const calls = mockRateLimitedFetch.mock.calls.map(call => String(call[0]));
      expect(calls.some(url => url.includes('/_next/data/build-old/viewer/stories/100.json'))).toBe(true);
      expect(calls.some(url => url.includes('/_next/data/build-new/viewer/stories/100.json'))).toBe(true);
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
        }
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
        }
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
        'https://img-comic.pximg.net/c/q90_gridshuffle32:32/images/page/136645/jEPBvqSTmG1KdJJGxzSS/1.jpg?20230208180812#tmdPixivKey=azE%3D'
      );

      expect(mockRateLimitedFetch).toHaveBeenCalledTimes(1);
      const [requestedUrl] = mockRateLimitedFetch.mock.calls[0] as [string, string, RequestInit];
      expect(requestedUrl).toBe('https://img-comic.pximg.net/c/q90_gridshuffle32:32/images/page/136645/jEPBvqSTmG1KdJJGxzSS/1.jpg?20230208180812');
      expect(requestedUrl.includes('?20230208180812=')).toBe(false);
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
        }
      );

      const readV4Call = mockRateLimitedFetch.mock.calls.find(call => String(call[0]).includes('/api/app/episodes/101/read_v4'));
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
        }
      );

      const readV4Call = mockRateLimitedFetch.mock.calls.find(call => String(call[0]).includes('/api/app/episodes/102/read_v4'));
      const requestInit = readV4Call?.[2] as { headers?: HeadersInit } | undefined;
      const headers = requestInit?.headers;
      const actualHash = headers instanceof Headers
        ? headers.get('x-client-hash')
        : (headers as Record<string, string> | undefined)?.['x-client-hash'];

      const payload = '2026-03-01T11:22:33Zsalt-for-hash';
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
      const expectedHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      expect(actualHash).toBe(expectedHash);
    });
  });
}
