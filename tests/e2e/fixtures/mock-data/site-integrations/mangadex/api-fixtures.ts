/**
 * @file api-fixtures.ts
 * @description Custom MangaDex series fixtures + API response builders used
 * by the MangaDex route registrar. Kept separate from `routes.ts` so specs
 * can import the fixture metadata (series IDs, chapter shapes) without
 * pulling Playwright's BrowserContext into their bundle.
 */

import {
  EXAMPLE_BASE_URL,
  MANGADEX_GROUPED_COLLAPSE_SERIES_ID,
  MANGADEX_LOCKED_SELECTION_SERIES_ID,
  MANGADEX_ORDER_TEST_SERIES_ID,
  MANGADEX_STRESS_TOGGLE_SERIES_ID,
  MANGADEX_VIEW_TOGGLE_SERIES_ID,
} from '../../../test-domains-constants';
import { BASIC_CHAPTERS, SMALL_SERIES } from './chapter-data';
import { BASIC_SERIES, MINIMAL_SERIES } from './series-data';

const MANGADEX_API_BASE = 'https://api.mangadex.org';
export const MANGADEX_API_DOMAIN = new URL(MANGADEX_API_BASE).hostname;

export interface CustomMangadexFixtureChapter {
  id: string;
  url: string;
  title: string;
  chapterNumber?: number;
  volumeNumber?: number;
  locked?: boolean;
}

export interface CustomMangadexSeriesFixture {
  seriesTitle: string;
  chapters: CustomMangadexFixtureChapter[];
}

function buildExampleUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalized, EXAMPLE_BASE_URL).toString();
}

/**
 * Bespoke MangaDex series fixtures used by the grouped-collapse,
 * order-test, view-toggle, stress-toggle, and locked-selection specs. Each
 * entry is keyed by the synthetic UUID that the spec navigates to.
 */
export const CUSTOM_MANGADEX_SERIES_FIXTURES: Record<string, CustomMangadexSeriesFixture> = {
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

/**
 * Build a `GET /manga/{id}/feed` response body that matches the real
 * MangaDex API shape. `chapters` is the fixture dataset for the series.
 */
export function buildMangadexFeedResponse(
  chapters: ReadonlyArray<CustomMangadexFixtureChapter>,
): Record<string, unknown> {
  const data = chapters.map((ch) => ({
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

  return {
    result: 'ok',
    data,
    total: data.length,
    offset: 0,
    limit: data.length,
  };
}

/**
 * Build a `GET /manga/{id}` response body that matches the real MangaDex
 * API shape. Uses either a `CustomMangadexSeriesFixture`, a known dataset
 * series (`BASIC_SERIES` / `MINIMAL_SERIES`), or a synthesized default.
 */
export function buildMangadexSeriesResponse(mangaId: string): Record<string, unknown> {
  const customFixture = CUSTOM_MANGADEX_SERIES_FIXTURES[mangaId];

  const meta = customFixture
    ? {
        siteId: 'mangadex',
        seriesId: mangaId,
        seriesTitle: customFixture.seriesTitle,
        author: 'Test Author',
        coverUrl: `https://uploads.mangadex.org/covers/${mangaId}/cover.jpg`,
      }
    : mangaId === BASIC_SERIES.series.seriesId
    ? BASIC_SERIES.series
    : mangaId === MINIMAL_SERIES.series.seriesId
      ? MINIMAL_SERIES.series
      : { siteId: 'mangadex', seriesId: mangaId, seriesTitle: 'Unknown' };

  const coverFileName = (() => {
    if (typeof meta.coverUrl !== 'string') return 'cover.jpg';
    try {
      return new URL(meta.coverUrl).pathname.split('/').pop() || 'cover.jpg';
    } catch {
      return 'cover.jpg';
    }
  })();

  return {
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
  };
}

/**
 * Resolve the chapter dataset for a manga ID. Prefers custom fixtures, then
 * falls back to the shared datasets. Returns an empty array for unknown IDs
 * so the feed endpoint mocks return a well-formed empty result.
 */
export function resolveMangadexChapterDataset(
  mangaId: string,
): ReadonlyArray<CustomMangadexFixtureChapter> {
  const customFixture = CUSTOM_MANGADEX_SERIES_FIXTURES[mangaId];
  if (customFixture) {
    return customFixture.chapters;
  }

  if (mangaId === BASIC_SERIES.series.seriesId) {
    return BASIC_CHAPTERS.chapters.map((ch) => ({
      id: ch.id,
      url: ch.url,
      title: ch.title,
      chapterNumber: ch.chapterNumber,
      volumeNumber: ch.volumeNumber,
    }));
  }

  if (mangaId === MINIMAL_SERIES.series.seriesId) {
    return SMALL_SERIES.chapters.map((ch) => ({
      id: ch.id,
      url: ch.url,
      title: ch.title,
      chapterNumber: ch.chapterNumber,
      volumeNumber: ch.volumeNumber,
    }));
  }

  return [];
}
