/**
 * @file image-fixtures.ts
 * @description MangaDex at-home server response builder + image host
 * configuration used by Phase-3 download-workflow mocks.
 *
 * The production MangaDex chapter-image pipeline looks up
 * `GET https://api.mangadex.org/at-home/server/{chapterId}` which returns:
 *
 * ```
 * {
 *   baseUrl: 'https://uploads.mangadex.org',
 *   chapter: {
 *     hash: '<chapter-hash>',
 *     data: ['1-abc.jpg', '2-def.jpg', ...],
 *     dataSaver: ['1-abc.jpg', ...]
 *   }
 * }
 * ```
 *
 * We route the JSON via `registerMangadexRoutes` and map every candidate
 * filename to the shared 1x1 PNG fixture. The chapter-hash is deterministic
 * per chapter id so tests can assert against stable URLs if needed.
 */

import type { SiteIntegrationChapterData } from '../../types';
import { BASIC_CHAPTERS, SMALL_SERIES } from './chapter-data';
import { BASIC_SERIES, MINIMAL_SERIES } from './series-data';
import { CUSTOM_MANGADEX_SERIES_FIXTURES } from './api-fixtures';

export const MANGADEX_UPLOADS_DOMAIN = 'uploads.mangadex.org';
export const MANGADEX_UPLOADS_BASE_URL = `https://${MANGADEX_UPLOADS_DOMAIN}`;

/**
 * One image per chapter keeps the mock pipeline negligible; the real
 * pipeline handles many (50-200) pages per chapter but the state machine
 * is identical regardless of page count.
 */
export const MOCK_IMAGES_PER_CHAPTER = 1;

/**
 * Deterministic 32-hex chapter-hash derivable from a chapter id without a
 * hash import. Only the mock needs this; production parses the real hash
 * out of the at-home response.
 */
export function buildMangadexChapterHash(chapterId: string): string {
  const normalized = chapterId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return (`${normalized}${'0'.repeat(32)}`).slice(0, 32);
}

/**
 * Mock page filenames a given chapter exposes. Production uses real image
 * hashes here; the mock only needs stable filenames that match between
 * the at-home JSON and the image-host route handler.
 */
export function buildMangadexChapterImageFilenames(
  chapterId: string,
  count: number = MOCK_IMAGES_PER_CHAPTER,
): string[] {
  const hash = buildMangadexChapterHash(chapterId);
  return Array.from({ length: count }, (_, index) => `${index + 1}-${hash.slice(0, 8)}.png`);
}

export interface MockAtHomeResponse {
  baseUrl: string;
  chapter: {
    hash: string;
    data: string[];
    dataSaver: string[];
  };
}

export function buildAtHomeServerResponse(
  chapterId: string,
  count: number = MOCK_IMAGES_PER_CHAPTER,
): MockAtHomeResponse {
  const hash = buildMangadexChapterHash(chapterId);
  const files = buildMangadexChapterImageFilenames(chapterId, count);
  return {
    baseUrl: MANGADEX_UPLOADS_BASE_URL,
    chapter: {
      hash,
      data: files,
      dataSaver: files,
    },
  };
}

/**
 * Chapter ids the downloader test uses are scoped per series. Production
 * accepts arbitrary ids; the mock only needs to know which ones must resolve
 * so routes can return stable at-home responses.
 */
export function resolveMangadexDownloadableChapterIds(mangaId: string): string[] {
  const custom = CUSTOM_MANGADEX_SERIES_FIXTURES[mangaId];
  if (custom) {
    return custom.chapters
      .filter((chapter) => chapter.locked !== true)
      .map((chapter) => chapter.id);
  }

  const dataset = pickBuiltInDatasetForDownload(mangaId);
  return dataset.map((chapter) => chapter.id);
}

function pickBuiltInDatasetForDownload(mangaId: string): ReadonlyArray<SiteIntegrationChapterData> {
  // Match the api-fixtures series resolution order so downloads work for
  // every series mapped through `buildMangadexSeriesResponse`.
  if (mangaId === BASIC_SERIES.series.seriesId) return BASIC_CHAPTERS.chapters;
  if (mangaId === MINIMAL_SERIES.series.seriesId) return SMALL_SERIES.chapters;
  return [];
}
