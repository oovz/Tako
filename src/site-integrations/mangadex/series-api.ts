import type { Chapter } from "../../types/chapter"
import type { SeriesMetadata } from "../../types/series-metadata"
import type { SeriesChapterListResult } from "../../types/site-integrations"
import type { VolumeState } from "../../types/tab-state"
import logger from "@/src/runtime/logger"
import {
  fetchChapterFeed,
  fetchMangaMetadata,
  fetchMangaStatistics,
  type MangadexRetryMode,
  MANGADEX_SITE_BASE,
  MANGADEX_UPLOADS_BASE,
  mapCommunityRatingToFiveScale,
  type MangadexRelationship,
  type MangadexMangaResponse,
  type MangadexChapterFeedResponse,
} from "./api"
import { resolveMangadexChapterFeedOptions } from "./preferences"
import type { MangadexUserPreferences } from "./preferences-schema"
import type { SiteIntegrationSettingsReader } from "@/src/types/site-integrations"
import type { RateLimitService } from "@/src/runtime/rate-limit"

function extractAlternativePreferredTitle(
  altTitles: Array<Record<string, string>> = []
): string {
  const englishTitle = altTitles.find((alt) => alt.en)?.en
  const firstAlt = altTitles[0] ?? {}
  const firstAltKey = Object.keys(firstAlt)[0]
  return englishTitle ?? (firstAltKey ? firstAlt[firstAltKey] : "Unknown Title")
}

function extractPreferredTitle(
  titles: Record<string, string>,
  altTitles?: Array<Record<string, string>>
): string {
  const preferred = titles.en || titles["ja-ro"]
  if (preferred) return preferred
  const firstKey = Object.keys(titles)[0]
  return firstKey
    ? titles[firstKey]
    : extractAlternativePreferredTitle(altTitles)
}

function extractAlternativeTitles(
  altTitles: Array<Record<string, string>> | undefined,
  preferredTitle: string
): string[] | undefined {
  if (!Array.isArray(altTitles) || altTitles.length === 0) {
    return undefined
  }

  const uniqueTitles = Array.from(
    new Set(
      altTitles
        .flatMap((alt) => Object.values(alt))
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value !== preferredTitle)
    )
  )

  return uniqueTitles.length > 0 ? uniqueTitles : undefined
}

function formatPublicationDemographic(
  value: string | undefined
): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined
  }

  return value
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function buildCoverUrl(
  mangaId: string,
  relationships: MangadexRelationship[]
): string | undefined {
  const coverRel = relationships.find(
    (relationship) => relationship.type === "cover_art"
  )
  if (!coverRel?.attributes) return undefined

  const fileName = coverRel.attributes.fileName as string | undefined
  if (!fileName) return undefined

  return `${MANGADEX_UPLOADS_BASE}/covers/${mangaId}/${fileName}`
}

function extractRelationshipName(
  relationships: MangadexRelationship[],
  role: "author" | "artist"
): string | undefined {
  return relationships.find((relationship) => relationship.type === role)
    ?.attributes?.name as string | undefined
}

function mapMangadexReadingDirection(
  tags: string[] | undefined
): string | undefined {
  if (!Array.isArray(tags) || tags.length === 0) {
    return undefined
  }

  const normalizedTags = tags.map((tag) => tag.trim().toLowerCase())
  if (normalizedTags.some((tag) => tag === "manga" || tag === "doujinshi")) {
    return "rtl"
  }

  if (
    normalizedTags.some(
      (tag) => tag === "manhwa" || tag === "manhua" || tag === "webtoon"
    )
  ) {
    return "ltr"
  }

  return undefined
}

function buildMangadexVolumeId(volumeLabel: string): string {
  return `mangadex-volume-${volumeLabel.trim().toLowerCase().replace(/\s+/g, "-")}`
}

function extractMangadexTaxonomy(
  attrs: MangadexMangaResponse["data"]["attributes"]
): Pick<SeriesMetadata, "genres" | "tags" | "readingDirection"> {
  const tagNames = attrs.tags
    ?.map((tag) => tag.attributes?.name?.en)
    .filter((name): name is string => typeof name === "string")
  const publicationDemographic = formatPublicationDemographic(
    attrs.publicationDemographic
  )
  const genres = Array.from(
    new Set([
      ...(publicationDemographic ? [publicationDemographic] : []),
      ...(tagNames ?? []),
    ])
  )
  const tags =
    tagNames && tagNames.length > 0 ? Array.from(new Set(tagNames)) : undefined
  return {
    genres: genres.length > 0 ? genres : undefined,
    tags,
    readingDirection: mapMangadexReadingDirection(tags),
  }
}

export async function fetchMangadexSeriesMetadata(
  seriesId: string,
  rateLimitService: RateLimitService,
  retryMode: MangadexRetryMode = "resilient",
  signal?: AbortSignal
): Promise<SeriesMetadata> {
  const [data, statisticsResult] = await Promise.all([
    fetchMangaMetadata(seriesId, rateLimitService, retryMode, signal),
    fetchMangaStatistics(seriesId, rateLimitService, retryMode, signal).catch(
      (error) => {
        logger.debug(
          "[mangadex] Failed to fetch manga statistics (non-blocking):",
          error
        )
        return undefined
      }
    ),
  ])
  const attrs = data.data.attributes
  const title = extractPreferredTitle(attrs.title, attrs.altTitles)
  return {
    title,
    author: extractRelationshipName(data.data.relationships, "author"),
    artist: extractRelationshipName(data.data.relationships, "artist"),
    description:
      attrs.description?.en || Object.values(attrs.description || {})[0],
    ...extractMangadexTaxonomy(attrs),
    status: attrs.status,
    coverUrl: buildCoverUrl(seriesId, data.data.relationships),
    communityRating: statisticsResult
      ? mapCommunityRatingToFiveScale(statisticsResult, seriesId)
      : undefined,
    contentRating: attrs.contentRating,
    year: attrs.year,
    language: attrs.originalLanguage,
    alternativeTitles: extractAlternativeTitles(attrs.altTitles, title),
  }
}

type MangadexFeedChapter = MangadexChapterFeedResponse["data"][number]

function isDownloadableMangadexChapter(entry: MangadexFeedChapter): boolean {
  const attrs = entry.attributes
  if (!attrs.translatedLanguage) {
    logger.warn(
      `[mangadex] Skipping malformed chapter entry with missing language: ${entry.id}`
    )
    return false
  }
  const isExternal = Boolean(attrs.externalUrl)
  const pageCount = typeof attrs.pages === "number" ? attrs.pages : 0
  if (isExternal || pageCount === 0) {
    logger.debug(
      `[mangadex] Skipping ${isExternal ? "external" : "unavailable"} chapter: ${entry.id}`
    )
    return false
  }
  return true
}

function mapMangadexChapterPosition(
  attrs: MangadexFeedChapter["attributes"]
): Pick<Chapter, "chapterNumber" | "chapterLabel"> {
  const chapterNumber = attrs.chapter ? parseFloat(attrs.chapter) : undefined
  return {
    chapterNumber: Number.isNaN(chapterNumber) ? undefined : chapterNumber,
    chapterLabel:
      typeof attrs.chapter === "string" && attrs.chapter.trim().length > 0
        ? attrs.chapter.trim()
        : undefined,
  }
}

function mapMangadexChapterVolume(
  volume: MangadexFeedChapter["attributes"]["volume"]
): Pick<Chapter, "volumeId" | "volumeNumber" | "volumeLabel"> {
  const label = typeof volume === "string" ? volume.trim() : ""
  if (!label)
    return {
      volumeId: undefined,
      volumeNumber: undefined,
      volumeLabel: undefined,
    }
  const volumeNumber = parseInt(label, 10)
  return {
    volumeId: buildMangadexVolumeId(label),
    volumeNumber: Number.isNaN(volumeNumber) ? undefined : volumeNumber,
    volumeLabel: `Vol. ${label}`,
  }
}

function mapFeedChapterToChapter(entry: MangadexFeedChapter): Chapter | null {
  if (!isDownloadableMangadexChapter(entry)) return null
  const attrs = entry.attributes
  const title =
    attrs.title ||
    (attrs.chapter
      ? `Chapter ${attrs.chapter}`
      : `Chapter ${entry.id.slice(0, 8)}`)
  return {
    id: entry.id,
    url: `${MANGADEX_SITE_BASE}/chapter/${entry.id}`,
    title,
    locked: false,
    language: attrs.translatedLanguage,
    ...mapMangadexChapterPosition(attrs),
    ...mapMangadexChapterVolume(attrs.volume),
    comicInfo: { Title: title, LanguageISO: attrs.translatedLanguage },
  }
}

type MangadexVolume = VolumeState & {
  volumeNumber?: number
  firstIndex: number
}

function compareMangadexVolumes(
  left: MangadexVolume,
  right: MangadexVolume
): number {
  if (
    left.volumeNumber !== undefined &&
    right.volumeNumber !== undefined &&
    left.volumeNumber !== right.volumeNumber
  ) {
    return left.volumeNumber - right.volumeNumber
  }
  return left.firstIndex - right.firstIndex
}

function buildMangadexVolumes(chapters: Chapter[]): VolumeState[] {
  const volumeById = new Map<string, MangadexVolume>()

  chapters.forEach((chapter, index) => {
    if (!chapter.volumeId) {
      return
    }

    const existing = volumeById.get(chapter.volumeId)
    if (existing) {
      return
    }

    volumeById.set(chapter.volumeId, {
      id: chapter.volumeId,
      title: chapter.volumeLabel,
      label: chapter.volumeLabel,
      volumeNumber: chapter.volumeNumber,
      firstIndex: index,
    })
  })

  return Array.from(volumeById.values())
    .sort(compareMangadexVolumes)
    .map((volume) => ({
      id: volume.id,
      title: volume.title,
      label: volume.label,
    }))
}

function collectMangadexFeedChapters(
  entries: MangadexFeedChapter[],
  chapterById: Map<string, Chapter>,
  duplicateChapterIds: Set<string>
): void {
  for (const entry of entries) {
    const chapter = mapFeedChapterToChapter(entry)
    if (!chapter) continue
    if (chapterById.has(chapter.id)) {
      duplicateChapterIds.add(chapter.id)
      continue
    }
    chapterById.set(chapter.id, chapter)
  }
}

function warnMangadexPaginationLimit(offset: number, total: number): void {
  if (offset === 0 && total > 10000) {
    logger.warn(
      `[mangadex] Series has ${total} chapters but only first 10000 can be retrieved due to API pagination limit`
    )
  }
}

function logMangadexDuplicateChapters(
  seriesId: string,
  duplicateChapterIds: Set<string>
): void {
  if (duplicateChapterIds.size > 0) {
    logger.error(
      "[mangadex] Duplicate chapter ids detected in fetchChapterList",
      {
        seriesId,
        duplicateChapterIds: [...duplicateChapterIds],
      }
    )
  }
}

export async function fetchMangadexChapterList(
  seriesId: string,
  rateLimitService: RateLimitService,
  language?: string,
  requestPreferences?: MangadexUserPreferences,
  retryMode: MangadexRetryMode = "resilient",
  signal?: AbortSignal,
  settingsReader?: SiteIntegrationSettingsReader
): Promise<SeriesChapterListResult> {
  const chapterById = new Map<string, Chapter>()
  const duplicateChapterIds = new Set<string>()
  let offset = 0
  const limit = 500
  let total = Infinity
  if (!settingsReader) {
    throw new Error("MangaDex chapter resolution requires settings reader")
  }
  const feedOptions = await resolveMangadexChapterFeedOptions(
    language,
    requestPreferences,
    settingsReader
  )

  if (feedOptions.contentRatings?.length === 0) {
    return { chapters: [], volumes: [], truncated: false }
  }

  while (offset < total && offset < 10000) {
    const feed = await fetchChapterFeed(
      seriesId,
      rateLimitService,
      feedOptions,
      offset,
      limit,
      retryMode,
      signal
    )
    total = feed.total

    warnMangadexPaginationLimit(offset, total)
    collectMangadexFeedChapters(feed.data, chapterById, duplicateChapterIds)

    offset += limit
    if (feed.data.length < limit) break
  }

  logMangadexDuplicateChapters(seriesId, duplicateChapterIds)

  const chapters = Array.from(chapterById.values())
  return {
    chapters,
    volumes: buildMangadexVolumes(chapters),
    truncated: offset < total,
  }
}
