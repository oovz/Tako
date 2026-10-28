import type { SiteIntegrationChapterDataset } from "../../types"
import chapters from "@/tests/fixtures/site-integrations/mangamillion/captured-chapters.json" with { type: "json" }

export const BASIC_CHAPTERS: SiteIntegrationChapterDataset = {
  id: "MANGAMILLION_BASIC",
  description:
    "First ten visible One Piece chapter entries captured from the English title page",
  chapters: chapters.map((chapter, index) => ({
    id: String(chapter.translatedChapterId),
    url: chapter.url,
    title: chapter.name,
    index: index + 1,
    chapterNumber: Number(chapter.number.slice(1)),
    chapterLabel: chapter.number,
    locked: false,
    status: "queued",
    lastUpdated: 0,
  })),
}
