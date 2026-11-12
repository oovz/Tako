import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionInput,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import type { Chapter } from "@/src/types/chapter"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import { assertIntegrationEndpointRequestUrl } from "../request-policy"
import { ProviderContractError } from "../provider-contract-error"
import { fetchMangaPlusTitle, MANGAPLUS_ORIGIN, parseMangaPlusId } from "./api"
import type {
  MangaPlusChapter,
  MangaPlusTitle,
  MangaPlusTitleDetail,
} from "./contracts"

function resolvedTitle(
  detail: MangaPlusTitleDetail,
  id: string
): MangaPlusTitle {
  const title = detail.title
  if (!title || String(title.id) !== id)
    throw new ProviderContractError("MANGA Plus returned a different title")
  return title
}

function isChapterLocked(chapter: MangaPlusChapter, now: number): boolean {
  return (
    !!chapter.locked ||
    chapter.type !== 0 ||
    (chapter.start > 0 && chapter.start > now) ||
    (chapter.end > 0 && chapter.end < now)
  )
}

function projectChapter(chapter: MangaPlusChapter, now: number): Chapter {
  const label = chapter.name.replace(/^#/, "")
  return {
    id: String(chapter.id),
    url: `${MANGAPLUS_ORIGIN}/viewer/${chapter.id}`,
    title: chapter.subtitle.trim() || chapter.name,
    chapterLabel: label,
    chapterNumber: /^\d+(?:\.\d+)?$/.test(label) ? Number(label) : undefined,
    releaseDate:
      chapter.start > 0
        ? new Date(chapter.start * 1000).toISOString().slice(0, 10)
        : undefined,
    readingDirection: chapter.verticalOnly ? "vertical" : undefined,
    locked: isChapterLocked(chapter, now),
    comicInfo: {},
  }
}

function buildChapterList(
  chapters: MangaPlusChapter[],
  titleId: number,
  now: number
): Chapter[] {
  const seen = new Set<number>()
  const chapterList: Chapter[] = []
  for (const chapter of chapters) {
    if (chapter.titleId !== titleId)
      throw new ProviderContractError(
        "MANGA Plus returned a chapter from another title"
      )
    if (seen.has(chapter.id)) continue
    seen.add(chapter.id)
    chapterList.push(projectChapter(chapter, now))
  }
  return chapterList
}

function buildSeriesMetadata(
  title: MangaPlusTitle,
  detail: MangaPlusTitleDetail
): SeriesMetadata {
  const coverUrl = title.coverUrl
    ? assertIntegrationEndpointRequestUrl(
        "mangaplus",
        "mangaplus-image",
        title.coverUrl
      ).href
    : undefined
  return {
    title: title.name,
    author: title.author,
    description: detail.description,
    coverUrl,
    language: ["en", "es", "fr", "id", "pt-BR", "ru", "th", "de", "it", "vi"][
      title.language
    ],
    publisher: "Shueisha",
    contentRating: ["all ages", "teen"][detail.rating],
  }
}

async function resolveMangaPlusSeriesData(
  input: SeriesDataResolutionInput
): Promise<SeriesDataResolutionResult> {
  const id = parseMangaPlusId(input.seriesUrl, "titles")
  const detail = await fetchMangaPlusTitle(
    id,
    input.rateLimitService,
    input.signal
  )
  const title = resolvedTitle(detail, id)
  const seriesMetadata = buildSeriesMetadata(title, detail)
  const chapterList = buildChapterList(
    detail.chapters,
    title.id,
    Date.now() / 1000
  )
  return { seriesId: id, seriesMetadata, chapterList }
}

const background: ServiceWorkerIntegration = {
  name: "MANGA Plus Background",
  series: { resolveSeriesData: resolveMangaPlusSeriesData },
}
export const backgroundSiteAdapter: BackgroundSiteAdapter = { background }
