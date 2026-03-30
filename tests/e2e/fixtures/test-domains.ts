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
export const MANGADEX_ORDER_TEST_SERIES_ID = '11111111-1111-4111-8111-111111111111';
export const MANGADEX_VIEW_TOGGLE_SERIES_ID = '22222222-2222-4222-8222-222222222222';
export const MANGADEX_STRESS_TOGGLE_SERIES_ID = '33333333-3333-4333-8333-333333333333';
export const MANGADEX_GROUPED_COLLAPSE_SERIES_ID = '44444444-4444-4444-8444-444444444444';
export const MANGADEX_LOCKED_SELECTION_SERIES_ID = '55555555-5555-4555-8555-555555555555';
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

type CustomMangadexFixtureChapter = {
  id: string;
  url: string;
  title: string;
  chapterNumber?: number;
  volumeNumber?: number;
  locked?: boolean;
};

type CustomMangadexSeriesFixture = {
  seriesTitle: string;
  chapters: CustomMangadexFixtureChapter[];
};

const CUSTOM_MANGADEX_SERIES_FIXTURES: Record<string, CustomMangadexSeriesFixture> = {
  [MANGADEX_ORDER_TEST_SERIES_ID]: {
    seriesTitle: 'Ordering Test Series',
    chapters: [
      { id: 'standalone-1', url: buildExampleUrl('/standalone-1'), title: 'Standalone chapter 1' },
      { id: 'v2-c3', url: buildExampleUrl('/v2-c3'), title: 'Volume 2 Chapter 3', chapterNumber: 3, volumeNumber: 2 },
      { id: 'standalone-2', url: buildExampleUrl('/standalone-2'), title: 'Standalone chapter 2' },
      { id: 'v2-c4', url: buildExampleUrl('/v2-c4'), title: 'Volume 2 Chapter 4', chapterNumber: 4, volumeNumber: 2 },
      { id: 'v2-c5', url: buildExampleUrl('/v2-c5'), title: 'Volume 2 Chapter 5', chapterNumber: 5, volumeNumber: 2 },
      { id: 'standalone-3', url: buildExampleUrl('/standalone-3'), title: 'Standalone chapter 3' },
      { id: 'v2-c6', url: buildExampleUrl('/v2-c6'), title: 'Volume 2 Chapter 6', chapterNumber: 6, volumeNumber: 2 },
    ],
  },
  [MANGADEX_VIEW_TOGGLE_SERIES_ID]: {
    seriesTitle: 'View Toggle Series',
    chapters: Array.from({ length: 32 }, (_, index) => {
      const chapterNumber = index + 1;
      const volumeNumber = chapterNumber <= 16 ? 1 : 2;
      return {
        id: `toggle-${chapterNumber}`,
        url: buildExampleUrl(`/toggle-${chapterNumber}`),
        title: `Volume ${volumeNumber} Chapter ${chapterNumber}`,
        chapterNumber,
        volumeNumber,
      };
    }),
  },
  [MANGADEX_STRESS_TOGGLE_SERIES_ID]: {
    seriesTitle: 'Stress Toggle Series',
    chapters: Array.from({ length: 36 }, (_, index) => {
      const chapterNumber = index + 1;
      const volumeNumber = chapterNumber <= 18 ? 1 : 2;
      return {
        id: `stress-${chapterNumber}`,
        url: buildExampleUrl(`/stress-${chapterNumber}`),
        title: `Volume ${volumeNumber} Chapter ${chapterNumber}`,
        chapterNumber,
        volumeNumber,
      };
    }),
  },
  [MANGADEX_GROUPED_COLLAPSE_SERIES_ID]: {
    seriesTitle: 'Grouped Collapse Series',
    chapters: [
      { id: 'v1-c1', url: buildExampleUrl('/collapse-v1-c1'), title: 'Volume 1 Chapter 1', chapterNumber: 1, volumeNumber: 1 },
      { id: 'v1-c2', url: buildExampleUrl('/collapse-v1-c2'), title: 'Volume 1 Chapter 2', chapterNumber: 2, volumeNumber: 1 },
      { id: 'v2-c3', url: buildExampleUrl('/collapse-v2-c3'), title: 'Volume 2 Chapter 3', chapterNumber: 3, volumeNumber: 2 },
    ],
  },
  [MANGADEX_LOCKED_SELECTION_SERIES_ID]: {
    seriesTitle: 'Locked Selection Series',
    chapters: [
      { id: 'locked-chapter-1', url: buildExampleUrl('/locked-chapter-1'), title: 'Locked Chapter 1', locked: true },
      { id: 'open-chapter-1', url: buildExampleUrl('/open-chapter-1'), title: 'Open Chapter 1' },
    ],
  },
};

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
    const customSeriesFixture = CUSTOM_MANGADEX_SERIES_FIXTURES[mangaId as keyof typeof CUSTOM_MANGADEX_SERIES_FIXTURES];

    if (isFeed) {
      const dataset = customSeriesFixture
        ? customSeriesFixture.chapters
        : mangaId === Mangadex.BASIC_SERIES.series.seriesId
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
          pages: ch.locked === true ? 0 : 1,
          externalUrl: ch.locked === true ? ch.url : undefined,
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

    const meta = customSeriesFixture
      ? {
          siteId: 'mangadex',
          seriesId: mangaId,
          seriesTitle: customSeriesFixture.seriesTitle,
          author: 'Test Author',
          coverUrl: `https://uploads.mangadex.org/covers/${mangaId}/cover.jpg`,
        }
      : mangaId === Mangadex.BASIC_SERIES.series.seriesId
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
