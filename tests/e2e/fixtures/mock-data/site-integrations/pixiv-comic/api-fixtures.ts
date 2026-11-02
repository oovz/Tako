import captured from "@/tests/fixtures/site-integrations/pixiv-comic/captured-work.json" with { type: "json" }
import { SMALL_SERIES } from "./chapter-data"
import { BASIC_SERIES, MINIMAL_SERIES } from "./series-data"

export const PIXIV_COMIC_API_DOMAIN = "comic.pixiv.net"
export const PIXIV_COMIC_CAPTURED_STORY_ID = "154853"
export const PIXIV_COMIC_CAPTURED_PAGE_COUNT =
  captured.data.readV4.data.reading_episode.pages.length
export const PIXIV_COMIC_BUILD_ID = captured.data.buildId

export function buildPixivWorkV5Response(
  workId: string
): Record<string, unknown> {
  if (workId === BASIC_SERIES.series.seriesId) {
    return structuredClone(captured.data.workV5)
  }
  // Synthetic navigation control, separate from the captured publication.
  return {
    data: {
      official_work: {
        id: Number(workId),
        name:
          workId === MINIMAL_SERIES.series.seriesId
            ? MINIMAL_SERIES.series.seriesTitle
            : `Work ${workId}`,
      },
    },
  }
}

export function buildPixivEpisodesV2Response(
  workId: string
): Record<string, unknown> {
  if (workId === BASIC_SERIES.series.seriesId) {
    return structuredClone(captured.data.episodesV2)
  }
  const chapters =
    workId === MINIMAL_SERIES.series.seriesId ? SMALL_SERIES.chapters : []
  return {
    data: {
      episodes: chapters.map((chapter) => ({
        state: "readable",
        episode: {
          id: Number(chapter.id),
          numbering_title: chapter.title,
          sub_title: "",
          viewer_path: `/viewer/stories/${chapter.id}`,
          state: "readable",
        },
      })),
    },
  }
}

export function buildPixivStoryPageResponse(
  storyId: string
): Record<string, unknown> {
  if (storyId === PIXIV_COMIC_CAPTURED_STORY_ID) {
    return structuredClone(captured.data.storyPage)
  }
  return { pageProps: { salt: "synthetic-pixiv-fixture-salt", id: storyId } }
}

export function buildPixivReadV4Response(
  storyId: string
): Record<string, unknown> {
  if (storyId === PIXIV_COMIC_CAPTURED_STORY_ID) {
    return structuredClone(captured.data.readV4)
  }
  // Other chapter manifests were not captured. Keep their one-page mock explicit.
  return {
    data: {
      reading_episode: {
        pages: [
          {
            url: `https://img-comic.pximg.net/mock/${storyId}/1.png`,
          },
        ],
      },
    },
  }
}
