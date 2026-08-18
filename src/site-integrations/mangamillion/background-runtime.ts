import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionInput,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import type { Chapter } from "@/src/types/chapter"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"
import type { MangaMillionChapterList } from "./proto"
import { fetchChapterList, fetchTitleDetail } from "./api"
import { buildMangaMillionChapterUrl, parseMangaMillionSeriesUrl } from "./urls"

function parseNumericChapterNumber(
  chapterNumberStr?: string
): number | undefined {
  if (!chapterNumberStr) return undefined
  const match = chapterNumberStr.match(/(\d+(?:\.\d+)?)/)
  if (!match) return undefined
  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
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

  const { titleId } = parsedUrl
  const language = input.language || parsedUrl.language || "en"

  const titleDetail = await fetchTitleDetail(
    titleId,
    language,
    input.rateLimitService,
    input.signal
  )

  const seriesTitle =
    titleDetail.serviceTitle?.serviceTitleName ?? `MangaMillion ${titleId}`
  const authorName = titleDetail.serviceTitle?.authorName

  const seriesMetadata: SeriesMetadata = {
    title: seriesTitle,
    author: authorName,
    coverUrl: titleDetail.serviceTitle?.coverUrl,
    description: titleDetail.serviceTitle?.description,
    language,
    readingDirection: "rtl",
  }

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

  const chapters: Chapter[] = []
  const groups = chapterListData.chapterGroups ?? []

  for (const group of groups) {
    const isGroupUnavailable = group.groupType === 1 || group.groupType === 3
    const groupChapters = group.chapters ?? []

    for (const ch of groupChapters) {
      const chapterId = ch.translatedChapterId ?? 0
      const isLocked = isGroupUnavailable || chapterId === 0
      const rawNumber = ch.number ?? ""
      const cleanNumber = rawNumber.replace(/^#/, "")

      chapters.push({
        id: String(chapterId),
        url: buildMangaMillionChapterUrl(titleId, chapterId, language),
        title: ch.name || ch.number || "Chapter",
        chapterNumber: parseNumericChapterNumber(ch.number),
        chapterLabel: ch.number || undefined,
        locked: isLocked,
        language,
        comicInfo: {
          Title: ch.name,
          Number: cleanNumber || undefined,
          Series: seriesTitle,
          Writer: authorName,
          LanguageISO: language,
          Manga: "YesAndRightToLeft",
        },
      })
    }
  }

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
  id: "mangamillion",
  background,
}
