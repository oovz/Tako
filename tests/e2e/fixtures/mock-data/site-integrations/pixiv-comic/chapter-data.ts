import type { SiteIntegrationChapterDataset } from "../../types"
import captured from "@/tests/fixtures/site-integrations/pixiv-comic/captured-work.json" with { type: "json" }

export const BASIC_CHAPTERS: SiteIntegrationChapterDataset = {
  id: "PIXIV_COMIC_BASIC",
  description: "Six captured readable episodes in the source catalog order",
  chapters: captured.data.episodesV2.data.episodes
    .flatMap((entry) => {
      if (!("episode" in entry) || !entry.episode) return []
      const episode = entry.episode
      return [
        {
          id: String(episode.id),
          url: `https://comic.pixiv.net${episode.viewer_path}`,
          title: [episode.numbering_title, episode.sub_title]
            .filter(Boolean)
            .join(" "),
          index: 0,
          chapterLabel: episode.numbering_title,
          chapterNumber: Number(
            episode.numbering_title.match(/第(\d+)話/)?.[1]
          ),
          locked: entry.state !== "readable",
          status: "queued" as const,
          lastUpdated: 0,
        },
      ]
    })
    .map((chapter, index) => ({ ...chapter, index: index + 1 })),
}

// Synthetic second work used to exercise navigation between different work IDs.
export const SMALL_SERIES: SiteIntegrationChapterDataset = {
  id: "PIXIV_COMIC_SMALL",
  description: "Synthetic single-chapter navigation control",
  chapters: [
    {
      id: "70101",
      url: "https://comic.pixiv.net/viewer/stories/70101",
      title: "第1話",
      index: 1,
      chapterNumber: 1,
      status: "queued",
      lastUpdated: 0,
    },
  ],
}
