import type {
  SiteIntegrationSeriesData,
  SiteIntegrationSeriesDataset,
} from "../../types"
import capturedEpisode from "@/tests/fixtures/site-integrations/shonenjumpplus/captured-episode.json" with { type: "json" }

export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: "SHONENJUMPPLUS_BASIC_SERIES",
  description: "Captured SPY×FAMILY episode and public guest catalog",
  series: {
    siteId: "shonenjumpplus",
    seriesId: capturedEpisode.readableProduct.id,
    seriesTitle: capturedEpisode.readableProduct.series.title,
    author: "遠藤達哉",
    coverUrl: capturedEpisode.readableProduct.series.thumbnailUri,
  },
  chapterDatasetId: "SHONENJUMPPLUS_BASIC",
}

// Controlled second context for navigation reset coverage, derived from the
// captured episode. This is not a second captured publication.
export const MINIMAL_SERIES: SiteIntegrationSeriesDataset = {
  id: "SHONENJUMPPLUS_MINIMAL_SERIES",
  description:
    "Synthetic one-chapter navigation context derived from SPY×FAMILY",
  series: {
    siteId: "shonenjumpplus",
    seriesId: "3269754496649675702",
    seriesTitle: "Minimal Series",
  },
  chapterDatasetId: "SHONENJUMPPLUS_SMALL",
}

export const SERIES_AGGREGATE_IDS: Record<string, string> = {
  [BASIC_SERIES.series.seriesId]: capturedEpisode.readableProduct.series.id,
  [MINIMAL_SERIES.series.seriesId]: "4402",
}

export function createShonenJumpPlusSeries(
  overrides: Partial<SiteIntegrationSeriesData>
): SiteIntegrationSeriesData {
  return {
    siteId: overrides.siteId ?? "shonenjumpplus",
    seriesId: overrides.seriesId ?? BASIC_SERIES.series.seriesId,
    seriesTitle: overrides.seriesTitle ?? BASIC_SERIES.series.seriesTitle,
    author: overrides.author,
    description: overrides.description,
    coverUrl: overrides.coverUrl,
  }
}
