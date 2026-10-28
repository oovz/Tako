import type { SiteIntegrationSeriesDataset } from "../../types"
import capturedTitle from "@/tests/fixtures/site-integrations/mangamillion/captured-title.json" with { type: "json" }

export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: "MANGAMILLION_BASIC_SERIES",
  description:
    "Captured English One Piece title metadata and first ten visible chapters",
  series: {
    siteId: "mangamillion",
    seriesId: "1",
    seriesTitle: capturedTitle.serviceTitleName,
    author: capturedTitle.authorName,
    description: capturedTitle.description,
    coverUrl: capturedTitle.coverUrl,
  },
  chapterDatasetId: "MANGAMILLION_BASIC",
}
