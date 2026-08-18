import type { SiteIntegrationChapterDataset } from "../../types"

export const BASIC_CHAPTERS: SiteIntegrationChapterDataset = {
  id: "MANGAMILLION_BASIC",
  description: "Basic MangaMillion One Piece chapter dataset",
  chapters: [
    {
      id: "6736",
      url: "https://mangamillion.shueisha.co.jp/en/title/1/chapter/6736",
      title: "Chapter 1:Romance Dawn",
      index: 1,
      chapterNumber: 1,
      chapterLabel: "#001",
      locked: false,
      status: "queued",
      lastUpdated: Date.now(),
    },
    {
      id: "6739",
      url: "https://mangamillion.shueisha.co.jp/en/title/1/chapter/6739",
      title: "Chapter 2:They Call Him “Straw Hat Luffy”",
      index: 2,
      chapterNumber: 2,
      chapterLabel: "#002",
      locked: false,
      status: "queued",
      lastUpdated: Date.now(),
    },
    {
      id: "6742",
      url: "https://mangamillion.shueisha.co.jp/en/title/1/chapter/6742",
      title: "Chapter 3:Enter Zolo: Pirate Hunter",
      index: 3,
      chapterNumber: 3,
      chapterLabel: "#003",
      locked: false,
      status: "queued",
      lastUpdated: Date.now(),
    },
  ],
}
