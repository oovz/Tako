import type { SiteIntegrationSeriesDataset } from "../../types"
import { BASIC_CHAPTERS } from "./chapter-data"

export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: "COMICTROPICS_BASIC_SERIES",
  description: "Captured COMIC熱帯 work 煙たい話",
  series: {
    siteId: "comictropics",
    seriesId: "9",
    seriesTitle: "煙たい話",
    author: "林史也",
    description:
      "友人とも、恋人とも、家族とも違う。それでも共に生きることを選ぶ武田と有田。この関係に答えは━━。",
    coverUrl:
      "https://cdn.comicnettai.com/9_c2b3fc5aa6547df94ec500f29b54c231/books/9/content_banner_Kemutai_Hanashi_Ver2.jpg",
  },
  chapterDatasetId: BASIC_CHAPTERS.id,
}
