import type { SiteIntegrationSeriesDataset } from "../../types"

export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: "MANGAMILLION_BASIC_SERIES",
  description: "Basic MangaMillion series with full metadata",
  series: {
    siteId: "mangamillion",
    seriesId: "1",
    seriesTitle: "One Piece",
    author: "Eiichiro Oda",
    description: "The story of Monkey D. Luffy and his pirate crew.",
    coverUrl:
      "https://img.mangamillion.shueisha.co.jp/jpn/image/original_title_cover/1.webp",
  },
  chapterDatasetId: "MANGAMILLION_BASIC",
}
