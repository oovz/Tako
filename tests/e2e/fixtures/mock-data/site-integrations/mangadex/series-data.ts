/**
 * @file series-data.ts
 * @description MangaDex series/manga metadata mock data
 *
 * Series URLs follow pattern: https://mangadex.test/title/[series-uuid]/[slug]
 */

import captured from "@/tests/fixtures/site-integrations/mangadex/captured-api.json" with { type: "json" }

import type {
  SiteIntegrationSeriesData,
  SiteIntegrationSeriesDataset,
} from "../../types"

// ============================================================================
// Series Datasets
// ============================================================================

/**
 * Captured Hunter x Hunter metadata for representative tests
 */
export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: "MANGADEX_BASIC_SERIES",
  description: "Captured Hunter x Hunter series metadata",
  series: {
    siteId: "mangadex",
    seriesId: "db692d58-4b13-4174-ae8c-30c515c0689c",
    seriesTitle: "Hunter x Hunter",
    author: "Togashi Yoshihiro",
    artist: "Togashi Yoshihiro",
    status: captured.data.metadata.data.attributes.status,
    description: captured.data.metadata.data.attributes.description.en,
    coverUrl:
      "https://uploads.mangadex.org/covers/db692d58-4b13-4174-ae8c-30c515c0689c/aa112927-f1e5-4fe4-a4db-7fd4a1536e3c.jpg",
  },
  chapterDatasetId: "MANGADEX_BASIC",
}

/**
 * Synthetic minimal metadata variant (only required fields)
 */
export const MINIMAL_SERIES: SiteIntegrationSeriesDataset = {
  id: "MANGADEX_MINIMAL_SERIES",
  description: "Minimal series with only required fields",
  series: {
    siteId: "mangadex",
    seriesId: "936f0ba5-ca65-4de4-99b1-528c02a4454d",
    seriesTitle: "Hunter x Hunter (Official Colored)",
  },
  chapterDatasetId: "MANGADEX_SMALL",
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a custom series with overrides
 */
export function createMangadexSeries(
  overrides: Partial<SiteIntegrationSeriesData>
): SiteIntegrationSeriesData {
  return {
    siteId: overrides.siteId || "mangadex",
    seriesId: overrides.seriesId || "db692d58-4b13-4174-ae8c-30c515c0689c",
    seriesTitle: overrides.seriesTitle || "Hunter x Hunter",
    author: overrides.author,
    artist: overrides.artist,
    status: overrides.status,
    description: overrides.description,
    coverUrl: overrides.coverUrl,
  }
}
