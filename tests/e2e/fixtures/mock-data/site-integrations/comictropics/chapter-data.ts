import type { SiteIntegrationChapterDataset } from "../../types"
import chapters from "@/tests/fixtures/site-integrations/comictropics/captured-chapters.json" with { type: "json" }

export const BASIC_CHAPTERS: SiteIntegrationChapterDataset = {
  id: "COMICTROPICS_BASIC",
  description:
    "51 captured 煙たい話 entries across three pages, with six readable episodes",
  chapters: chapters.map((chapter, index) => ({
    id: chapter.id,
    url:
      chapter.url ??
      `https://www.comicnettai.com/book/9#book-content-${chapter.id}`,
    title: chapter.title,
    index: index + 1,
    chapterLabel: chapter.title,
    chapterNumber: Number(chapter.title.match(/\d+/)?.[0]) || undefined,
    language: "ja",
    locked: chapter.locked,
    status: "queued",
    lastUpdated: 0,
  })),
}
