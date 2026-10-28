/**
 * @file series-data.ts
 * @description Pixiv Comic series/work metadata mock data.
 *
 * Series URLs follow the pattern: https://comic.pixiv.net/works/{workId}
 */

import type {
  SiteIntegrationSeriesData,
  SiteIntegrationSeriesDataset,
} from "../../types"
import captured from "@/tests/fixtures/site-integrations/pixiv-comic/captured-work.json" with { type: "json" }

const work = captured.data.workV5.data.official_work

export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: "PIXIV_COMIC_BASIC_SERIES",
  description: "Captured pixivコミック work 9830",
  series: {
    siteId: "pixiv-comic",
    seriesId: String(work.id),
    seriesTitle: work.name,
    author: work.author,
    description: work.description,
    coverUrl: work.image.main_big,
  },
  chapterDatasetId: "PIXIV_COMIC_BASIC",
}

export const MINIMAL_SERIES: SiteIntegrationSeriesDataset = {
  id: "PIXIV_COMIC_MINIMAL_SERIES",
  description: "Synthetic navigation control with only required fields",
  series: {
    siteId: "pixiv-comic",
    seriesId: "9999002",
    seriesTitle: "Minimal Work",
  },
  chapterDatasetId: "PIXIV_COMIC_SMALL",
}

export function createPixivComicSeries(
  overrides: Partial<SiteIntegrationSeriesData>
): SiteIntegrationSeriesData {
  return {
    siteId: overrides.siteId || "pixiv-comic",
    seriesId: overrides.seriesId || BASIC_SERIES.series.seriesId,
    seriesTitle: overrides.seriesTitle || BASIC_SERIES.series.seriesTitle,
    author: overrides.author,
    description: overrides.description,
    coverUrl: overrides.coverUrl,
  }
}
