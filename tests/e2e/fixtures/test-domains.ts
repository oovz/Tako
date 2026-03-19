import type { BrowserContext, Route } from '@playwright/test';
import { Mangadex } from './mock-data';

// Real-site defaults so E2E covers production behavior unless mocks are explicitly enabled.
export const EXAMPLE_TEST_DOMAIN = process.env.TMD_TEST_EXAMPLE_DOMAIN ?? 'example.com';
export const EXAMPLE_BASE_URL = `https://${EXAMPLE_TEST_DOMAIN}`;

export const MANGADEX_TEST_DOMAIN = process.env.TMD_TEST_MANGADEX_DOMAIN ?? 'mangadex.org';
export const MANGADEX_BASE_URL = `https://${MANGADEX_TEST_DOMAIN}`;
export const MANGADEX_DEFAULT_SERIES_PATH = '/title/db692d58-4b13-4174-ae8c-30c515c0689c/hunter-x-hunter';
export const MANGADEX_TEST_SERIES_URL = new URL(MANGADEX_DEFAULT_SERIES_PATH, MANGADEX_BASE_URL).toString();
export const MANGADEX_GENERIC_SERIES_URL = new URL(MANGADEX_DEFAULT_SERIES_PATH, MANGADEX_BASE_URL).toString();
export const LIVE_MANGADEX_REFERENCE_URL = process.env.TMD_LIVE_MANGADEX_URL
  ?? 'https://mangadex.org/title/b28525ae-ef8a-47aa-a120-5917a351be2d/kemutai-hanashi';

export const PIXIV_COMIC_TEST_DOMAIN = process.env.TMD_TEST_PIXIV_COMIC_DOMAIN ?? 'comic.pixiv.net';
export const PIXIV_COMIC_BASE_URL = `https://${PIXIV_COMIC_TEST_DOMAIN}`;
export const LIVE_PIXIV_COMIC_REFERENCE_URL = process.env.TMD_LIVE_PIXIV_COMIC_URL
  ?? 'https://comic.pixiv.net/works/9012';
export const LIVE_PIXIV_COMIC_DUPLICATE_TITLE_URL = process.env.TMD_LIVE_PIXIV_COMIC_DUPLICATE_TITLE_URL
  ?? 'https://comic.pixiv.net/works/6842';
export const LIVE_PIXIV_COMIC_DUAL_TITLE_URL = process.env.TMD_LIVE_PIXIV_COMIC_DUAL_TITLE_URL
  ?? 'https://comic.pixiv.net/works/6289';

export const SHONENJUMPPLUS_TEST_DOMAIN = process.env.TMD_TEST_SHONENJUMPPLUS_DOMAIN ?? 'shonenjumpplus.com';
export const SHONENJUMPPLUS_BASE_URL = `https://${SHONENJUMPPLUS_TEST_DOMAIN}`;
export const LIVE_SHONENJUMPPLUS_REFERENCE_URL = process.env.TMD_LIVE_SHONENJUMPPLUS_URL
  ?? 'https://shonenjumpplus.com/episode/3269754496649675685';

const MANGADEX_API_BASE = process.env.TMD_TEST_MANGADEX_API_BASE ?? 'https://api.mangadex.org';
export const MANGADEX_API_DOMAIN = new URL(MANGADEX_API_BASE).hostname;

export function buildMangadexUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalized, MANGADEX_BASE_URL).toString();
}

export function buildExampleUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalized, EXAMPLE_BASE_URL).toString();
}

const DEFAULT_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body>Test Page</body></html>';
const MANGADEX_HOME_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>MangaDex</title></head><body>MangaDex Home</body></html>';

// Ref: https://github.com/microsoft/playwright.dev/blob/main/nodejs/versioned_docs/version-stable/network.mdx
export async function registerTestRoutes(
  context: BrowserContext,
  options?: { useMocks?: boolean; allowNetwork?: boolean },
): Promise<void> {
  const useMocks = options?.useMocks === true;
  const allowNetwork = options?.allowNetwork === true;

  if (!useMocks) {
    if (!allowNetwork) {
      throw new Error(
        'registerTestRoutes: invalid route policy (useMocks=false, allowNetwork=false).',
      );
    }
    return;
  }

  await context.route(`https://${MANGADEX_API_DOMAIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());

    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    const parts = url.pathname.split('/').filter(Boolean);
    const isMangaEndpoint = parts[0] === 'manga' && typeof parts[1] === 'string';

    if (!isMangaEndpoint) {
      return json({ result: 'error', message: 'not mocked' });
    }

    const mangaId = parts[1];
    const isFeed = parts.length >= 3 && parts[2] === 'feed';

    if (isFeed) {
      const dataset = mangaId === Mangadex.BASIC_SERIES.series.seriesId
        ? Mangadex.BASIC_CHAPTERS.chapters
        : mangaId === Mangadex.MINIMAL_SERIES.series.seriesId
          ? Mangadex.SMALL_SERIES.chapters
          : [];

      const data = dataset.map((ch) => ({
        id: ch.id,
        type: 'chapter',
        attributes: {
          volume: ch.volumeNumber !== undefined ? String(ch.volumeNumber) : null,
          chapter: ch.chapterNumber !== undefined ? String(ch.chapterNumber) : null,
          title: ch.title,
          translatedLanguage: 'en',
          pages: 1,
        },
      }));

      return json({
        result: 'ok',
        data,
        total: data.length,
        offset: 0,
        limit: data.length,
      });
    }

    const meta = mangaId === Mangadex.BASIC_SERIES.series.seriesId
      ? Mangadex.BASIC_SERIES.series
      : mangaId === Mangadex.MINIMAL_SERIES.series.seriesId
        ? Mangadex.MINIMAL_SERIES.series
        : { siteId: 'mangadex', seriesId: mangaId, seriesTitle: 'Unknown' };

    const coverFileName = (() => {
      if (typeof meta.coverUrl !== 'string') return 'cover.jpg';
      try {
        return new URL(meta.coverUrl).pathname.split('/').pop() || 'cover.jpg';
      } catch {
        return 'cover.jpg';
      }
    })();

    return json({
      result: 'ok',
      data: {
        id: mangaId,
        type: 'manga',
        attributes: {
          title: { en: meta.seriesTitle },
          altTitles: [],
          description: { en: typeof meta.description === 'string' ? meta.description : '' },
          status: typeof meta.status === 'string' ? meta.status.toLowerCase() : 'ongoing',
          tags: [],
        },
        relationships: [
          {
            id: 'author-1',
            type: 'author',
            attributes: { name: typeof meta.author === 'string' ? meta.author : 'Author' },
          },
          {
            id: 'cover-1',
            type: 'cover_art',
            attributes: { fileName: coverFileName },
          },
        ],
      },
    });
  });

  const domains = [EXAMPLE_TEST_DOMAIN, MANGADEX_TEST_DOMAIN];
  await Promise.all(
    domains.map(async (domain) => {
      const pattern = `https://${domain}/**`;
      await context.route(pattern, async (route: Route) => {
        if (domain === MANGADEX_TEST_DOMAIN) {
          const url = new URL(route.request().url());
          if (url.pathname.startsWith('/title/')) {
            await route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: Mangadex.SERIES_PAGE_HTML,
            });
            return;
          }
          if (url.pathname.startsWith('/chapter/')) {
            await route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: Mangadex.CHAPTER_PAGE_HTML,
            });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: MANGADEX_HOME_HTML,
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: DEFAULT_HTML,
        });
      });
    })
  );
}
