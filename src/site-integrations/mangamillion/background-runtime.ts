import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionInput,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import type { Chapter } from "@/src/types/chapter"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"
import { assertIntegrationEndpointRequestUrl } from "@/src/site-integrations/request-policy"
import type {
  MangaMillionChapterInfo,
  MangaMillionChapterList,
  MangaMillionTitleDetail,
} from "./contracts/api"
import { fetchChapterList, fetchTitleDetail } from "./api"
import {
  MANGAMILLION_ORIGIN,
  buildMangaMillionChapterUrl,
  parseMangaMillionSeriesUrl,
} from "./urls"

function parseNumericChapterNumber(
  chapterNumberStr?: string
): number | undefined {
  if (!chapterNumberStr) return undefined
  const match = chapterNumberStr.match(/(\d+(?:\.\d+)?)/)
  if (!match) return undefined
  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function buildSeriesMetadata(
  titleDetail: MangaMillionTitleDetail,
  titleId: number,
  language: string
): SeriesMetadata & { title: string } {
  const seriesTitle =
    titleDetail.serviceTitle?.serviceTitleName ?? `MangaMillion ${titleId}`
  const authorName = titleDetail.serviceTitle?.authorName
  const rawCoverUrl = titleDetail.serviceTitle?.coverUrl?.trim()
  const coverUrl = rawCoverUrl
    ? assertIntegrationEndpointRequestUrl(
        "mangamillion",
        "mangamillion-image",
        rawCoverUrl
      ).href
    : undefined

  return {
    title: seriesTitle,
    author: authorName,
    coverUrl,
    description: titleDetail.serviceTitle?.description,
    language,
    readingDirection: "rtl",
  }
}

type ChapterContext = {
  titleId: number
  language: string
  seriesTitle: string
  authorName?: string
}

function chapterIdentity(
  chapter: MangaMillionChapterInfo,
  index: number
): string {
  const translatedId = chapter.translatedChapterId ?? 0
  if (translatedId > 0) return String(translatedId)
  return `locked-${chapter.number?.replace(/^#/, "") || index}`
}

function chapterUrl(
  translatedId: number,
  cleanNumber: string,
  index: number,
  context: ChapterContext
): string {
  const { titleId, language } = context
  return translatedId > 0
    ? buildMangaMillionChapterUrl(titleId, translatedId, language)
    : `${MANGAMILLION_ORIGIN}/${language}/title/${titleId}#chapter-${cleanNumber || index}`
}

function projectChapter(
  chapter: MangaMillionChapterInfo,
  id: string,
  index: number,
  groupUnavailable: boolean,
  context: ChapterContext
): Chapter {
  const translatedId = chapter.translatedChapterId ?? 0
  const cleanNumber = (chapter.number ?? "").replace(/^#/, "")
  const { language, seriesTitle, authorName } = context
  return {
    id,
    url: chapterUrl(translatedId, cleanNumber, index, context),
    title: chapter.name || chapter.number || "Chapter",
    chapterNumber: parseNumericChapterNumber(chapter.number),
    chapterLabel: chapter.number || undefined,
    locked: groupUnavailable || translatedId === 0,
    language,
    comicInfo: {
      Title: chapter.name,
      Number: cleanNumber || undefined,
      Series: seriesTitle,
      Writer: authorName,
      LanguageISO: language,
      Manga: "YesAndRightToLeft",
    },
  }
}

function buildChapterList(
  data: MangaMillionChapterList,
  context: ChapterContext
): Chapter[] {
  const chapters: Chapter[] = []
  const seenIds = new Set<string>()
  for (const group of data.chapterGroups ?? []) {
    const unavailable = group.groupType === 1 || group.groupType === 3
    for (const chapter of group.chapters ?? []) {
      const index = chapters.length + 1
      const candidateId = chapterIdentity(chapter, index)
      const id = seenIds.has(candidateId)
        ? `${candidateId}-${index}`
        : candidateId
      seenIds.add(id)
      chapters.push(projectChapter(chapter, id, index, unavailable, context))
    }
  }
  return chapters
}

async function resolveMangaMillionSeriesData(
  input: SeriesDataResolutionInput
): Promise<SeriesDataResolutionResult> {
  const parsedUrl = parseMangaMillionSeriesUrl(input.seriesUrl)
  if (!parsedUrl) {
    throw new ProviderContractError(
      "MangaMillion URL is not a supported title or chapter page (/title/{id})."
    )
  }
  const { titleId, language } = parsedUrl
  const titleDetail = await fetchTitleDetail(
    titleId,
    language,
    input.rateLimitService,
    input.signal
  )
  const seriesMetadata = buildSeriesMetadata(titleDetail, titleId, language)
  let chapterListData: MangaMillionChapterList
  try {
    chapterListData = await fetchChapterList(
      titleId,
      language,
      input.rateLimitService,
      input.signal
    )
  } catch (error) {
    return {
      seriesId: String(titleId),
      seriesMetadata,
      chapterListError: error instanceof Error ? error.message : String(error),
    }
  }

  const chapters = buildChapterList(chapterListData, {
    titleId,
    language,
    seriesTitle: seriesMetadata.title,
    authorName: seriesMetadata.author,
  })

  return {
    seriesId: String(titleId),
    seriesMetadata,
    chapterList: chapters,
  }
}

const background: ServiceWorkerIntegration = {
  name: "MangaMillion Background",
  series: {
    resolveSeriesData: resolveMangaMillionSeriesData,
  },
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  background,
}
