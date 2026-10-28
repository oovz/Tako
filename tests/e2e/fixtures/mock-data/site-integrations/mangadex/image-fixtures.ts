/**
 * Captured at-home manifest for the representative reader. Other chapters use
 * controlled filenames and bytes, with page counts from the captured feed.
 */

import captured from "@/tests/fixtures/site-integrations/mangadex/captured-api.json" with { type: "json" }

import type { SiteIntegrationChapterData } from "../../types"
import { BASIC_CHAPTERS, SMALL_SERIES } from "./chapter-data"
import { BASIC_SERIES, MINIMAL_SERIES } from "./series-data"
import { CUSTOM_MANGADEX_SERIES_FIXTURES } from "./api-fixtures"

export const MANGADEX_CAPTURED_READER_ID =
  "86a76ac5-9ea9-4fec-bc23-0720d1ac6f32"
export const MANGADEX_CAPTURED_IMAGE_DOMAIN = new URL(
  captured.data.atHome.baseUrl
).hostname

export const MANGADEX_UPLOADS_DOMAIN = "uploads.mangadex.org"
export const MANGADEX_UPLOADS_BASE_URL = `https://${MANGADEX_UPLOADS_DOMAIN}`

/** Page count for explicit synthetic UI/stress variants. */
export const MOCK_IMAGES_PER_CHAPTER = 1

/**
 * Deterministic 32-hex chapter-hash derivable from a chapter id without a
 * hash import. Only the mock needs this; production parses the real hash
 * out of the at-home response.
 */
export function buildMangadexChapterHash(chapterId: string): string {
  const normalized = chapterId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  return `${normalized}${"0".repeat(32)}`.slice(0, 32)
}

/**
 * Mock page filenames a given chapter exposes. Production uses real image
 * hashes here; the mock only needs stable filenames that match between
 * the at-home JSON and the image-host route handler.
 */
export function buildMangadexChapterImageFilenames(
  chapterId: string,
  count: number = MOCK_IMAGES_PER_CHAPTER
): string[] {
  const hash = buildMangadexChapterHash(chapterId)
  return Array.from(
    { length: count },
    (_, index) => `${index + 1}-${hash.slice(0, 8)}.png`
  )
}

export interface MockAtHomeResponse {
  baseUrl: string
  chapter: {
    hash: string
    data: string[]
    dataSaver: string[]
  }
}

export function buildAtHomeServerResponse(
  chapterId: string,
  count?: number
): MockAtHomeResponse {
  if (chapterId === MANGADEX_CAPTURED_READER_ID && count === undefined) {
    return structuredClone(captured.data.atHome)
  }
  const capturedChapter = captured.data.feed.data.find(
    (entry) => entry.id === chapterId
  )
  const pageCount =
    count ?? capturedChapter?.attributes.pages ?? MOCK_IMAGES_PER_CHAPTER
  const hash = buildMangadexChapterHash(chapterId)
  const files = buildMangadexChapterImageFilenames(chapterId, pageCount)
  return {
    baseUrl: MANGADEX_UPLOADS_BASE_URL,
    chapter: {
      hash,
      data: files,
      dataSaver: files,
    },
  }
}

/**
 * Chapter ids the downloader test uses are scoped per series. Production
 * accepts arbitrary ids; the mock only needs to know which ones must resolve
 * so routes can return stable at-home responses.
 */
export function resolveMangadexDownloadableChapterIds(
  mangaId: string
): string[] {
  const custom = CUSTOM_MANGADEX_SERIES_FIXTURES[mangaId]
  if (custom) {
    return custom.chapters
      .filter((chapter) => chapter.locked !== true)
      .map((chapter) => chapter.id)
  }

  const dataset = pickBuiltInDatasetForDownload(mangaId)
  return dataset.map((chapter) => chapter.id)
}

function pickBuiltInDatasetForDownload(
  mangaId: string
): ReadonlyArray<SiteIntegrationChapterData> {
  // Match the api-fixtures series resolution order so downloads work for
  // every series mapped through `buildMangadexSeriesResponse`.
  if (mangaId === BASIC_SERIES.series.seriesId) return BASIC_CHAPTERS.chapters
  if (mangaId === MINIMAL_SERIES.series.seriesId) return SMALL_SERIES.chapters
  return []
}
