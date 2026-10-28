/**
 * @file chapter-data.ts
 * @description MangaDex chapter mock data with realistic URLs
 *
 * Chapter URLs follow pattern: https://mangadex.test/chapter/[chapter-uuid]
 * Series URLs follow pattern: https://mangadex.test/title/[series-uuid]/[slug]
 */

import captured from "@/tests/fixtures/site-integrations/mangadex/captured-api.json" with { type: "json" }

import type {
  SiteIntegrationChapterData,
  SiteIntegrationChapterDataset,
} from "../../types"

// ============================================================================
// Chapter Datasets
// ============================================================================

/** Captured downloadable catalog window, retaining response order. */
export const BASIC_CHAPTERS: SiteIntegrationChapterDataset = {
  id: "MANGADEX_BASIC",
  description:
    "Captured Hunter x Hunter catalog window (82 downloadable entries)",
  chapters: captured.data.feed.data
    .filter(
      (entry) => entry.attributes.pages > 0 && !entry.attributes.externalUrl
    )
    .map((entry, index) => ({
      id: entry.id,
      url: `https://mangadex.org/chapter/${entry.id}`,
      title: entry.attributes.title || `Chapter ${entry.attributes.chapter}`,
      index: index + 1,
      chapterNumber: Number(entry.attributes.chapter),
      chapterLabel: entry.attributes.chapter,
      language: entry.attributes.translatedLanguage,
      status: "queued" as const,
      lastUpdated: 0,
    })),
}

/**
 * Synthetic five-chapter variant for focused UI tests
 */
export const SMALL_SERIES: SiteIntegrationChapterDataset = {
  id: "MANGADEX_SMALL",
  description: "Small 5-chapter series",
  chapters: [
    {
      id: "afaebc64-83df-4f11-b2b0-5ef4fcc8144c",
      url: "https://mangadex.test/chapter/afaebc64-83df-4f11-b2b0-5ef4fcc8144c",
      title: "The Day of Departure",
      index: 1,
      chapterNumber: 1,
      volumeNumber: 1,
      status: "queued",
      lastUpdated: Date.now(),
    },
    {
      id: "8505488a-2ff1-4023-ad39-0893f1886adf",
      url: "https://mangadex.test/chapter/8505488a-2ff1-4023-ad39-0893f1886adf",
      title: "An Encounter In The Storm",
      index: 2,
      chapterNumber: 2,
      volumeNumber: 1,
      status: "queued",
      lastUpdated: Date.now(),
    },
    {
      id: "77aeb3dc-59da-4aae-854e-709abb43c480",
      url: "https://mangadex.test/chapter/77aeb3dc-59da-4aae-854e-709abb43c480",
      title: "The Ultimate Choice",
      index: 3,
      chapterNumber: 3,
      volumeNumber: 1,
      status: "queued",
      lastUpdated: Date.now(),
    },
    {
      id: "d9d564bc-968c-4fd6-9773-ce9d050eb1cb",
      url: "https://mangadex.test/chapter/d9d564bc-968c-4fd6-9773-ce9d050eb1cb",
      title: "Wicked Magical Vulpes",
      index: 4,
      chapterNumber: 4,
      volumeNumber: 1,
      status: "queued",
      lastUpdated: Date.now(),
    },
    {
      id: "b3ab1347-5929-4fad-8bba-ca7bbc1f2527",
      url: "https://mangadex.test/chapter/b3ab1347-5929-4fad-8bba-ca7bbc1f2527",
      title: "The First Phase Begins: Part 1",
      index: 5,
      chapterNumber: 5,
      volumeNumber: 1,
      status: "queued",
      lastUpdated: Date.now(),
    },
  ],
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a single chapter with custom overrides
 */
export function createMangadexChapter(
  overrides: Partial<SiteIntegrationChapterData>
): SiteIntegrationChapterData {
  const chapterId = overrides.id || "99999999-9999-9999-9999-999999999999"
  return {
    id: chapterId,
    url: overrides.url || `https://mangadex.test/chapter/${chapterId}`,
    title: overrides.title || "Test Chapter",
    index: overrides.index ?? 1,
    chapterNumber: overrides.chapterNumber,
    volumeNumber: overrides.volumeNumber,
    volumeLabel: overrides.volumeLabel,
    status: overrides.status || "queued",
    lastUpdated: overrides.lastUpdated || Date.now(),
    errorMessage: overrides.errorMessage,
  }
}

/**
 * Create multiple chapters with UUID-like IDs
 */
export function createMangadexChapters(
  count: number
): SiteIntegrationChapterData[] {
  return Array.from({ length: count }, (_, i) => {
    const chNum = i + 1
    const uuid = `${String(chNum).padStart(8, "0")}-0000-0000-0000-000000000000`
    return {
      requestedPath: "Tako/Chapter.cbz",
      id: uuid,
      url: `https://mangadex.test/chapter/${uuid}`,
      title: `Chapter ${chNum}`,
      index: chNum,
      chapterNumber: chNum,
      status: "queued" as const,
      lastUpdated: Date.now(),
    }
  })
}
