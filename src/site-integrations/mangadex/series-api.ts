import type { Chapter } from '../../types/chapter'
import type { SeriesMetadata } from '../../types/series-metadata'
import logger from '@/src/runtime/logger'
import {
  fetchChapterFeed,
  fetchMangaMetadata,
  fetchMangaStatistics,
  MANGADEX_SITE_BASE,
  MANGADEX_UPLOADS_BASE,
  mapCommunityRatingToFiveScale,
  type MangadexRelationship,
} from './api'
import { resolveMangadexChapterFeedOptions } from './preferences'

function extractPreferredTitle(titles: Record<string, string>, altTitles?: Array<Record<string, string>>): string {
  if (titles.en) return titles.en
  if (titles['ja-ro']) return titles['ja-ro']
  const firstKey = Object.keys(titles)[0]
  if (firstKey) return titles[firstKey]

  if (altTitles && altTitles.length > 0) {
    for (const alt of altTitles) {
      if (alt.en) return alt.en
    }
    const firstAlt = altTitles[0]
    const firstAltKey = Object.keys(firstAlt)[0]
    if (firstAltKey) return firstAlt[firstAltKey]
  }

  return 'Unknown Title'
}

function extractAlternativeTitles(
  altTitles: Array<Record<string, string>> | undefined,
  preferredTitle: string,
): string[] | undefined {
  if (!Array.isArray(altTitles) || altTitles.length === 0) {
    return undefined
  }

  const uniqueTitles = Array.from(new Set(
    altTitles
      .flatMap((alt) => Object.values(alt))
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value !== preferredTitle),
  ))

  return uniqueTitles.length > 0 ? uniqueTitles : undefined
}

function formatPublicationDemographic(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }

  return value
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function buildCoverUrl(mangaId: string, relationships: MangadexRelationship[]): string | undefined {
  const coverRel = relationships.find((relationship) => relationship.type === 'cover_art')
  if (!coverRel?.attributes) return undefined

  const fileName = coverRel.attributes.fileName as string | undefined
  if (!fileName) return undefined

  return `${MANGADEX_UPLOADS_BASE}/covers/${mangaId}/${fileName}`
}

function extractAuthor(relationships: MangadexRelationship[]): string | undefined {
  const authorRel = relationships.find((relationship) => relationship.type === 'author')
  if (!authorRel?.attributes) return undefined
  return authorRel.attributes.name as string | undefined
}

function extractArtist(relationships: MangadexRelationship[]): string | undefined {
  const artistRel = relationships.find((relationship) => relationship.type === 'artist')
  if (!artistRel?.attributes) return undefined
  return artistRel.attributes.name as string | undefined
}

function mapMangadexReadingDirection(tags: string[] | undefined): string | undefined {
  if (!Array.isArray(tags) || tags.length === 0) {
    return undefined
  }

  const normalizedTags = tags.map((tag) => tag.trim().toLowerCase())
  if (normalizedTags.some((tag) => tag === 'manga' || tag === 'doujinshi')) {
    return 'rtl'
  }

  if (normalizedTags.some((tag) => tag === 'manhwa' || tag === 'manhua' || tag === 'webtoon')) {
    return 'ltr'
  }

  return undefined
}

export async function fetchMangadexSeriesMetadata(seriesId: string): Promise<SeriesMetadata> {
  const [data, statisticsResult] = await Promise.all([
    fetchMangaMetadata(seriesId),
    fetchMangaStatistics(seriesId).catch((error) => {
      logger.debug('[mangadex] Failed to fetch manga statistics (non-blocking):', error)
      return undefined
    }),
  ])
  const attrs = data.data.attributes

  const title = extractPreferredTitle(attrs.title, attrs.altTitles)
  const description = attrs.description?.en || Object.values(attrs.description || {})[0]
  const status = attrs.status
  const tagNames = attrs.tags
    ?.map((tag) => tag.attributes?.name?.en)
    .filter((name): name is string => typeof name === 'string')
  const publicationDemographic = formatPublicationDemographic(attrs.publicationDemographic)
  const genres = Array.from(new Set([
    ...(publicationDemographic ? [publicationDemographic] : []),
    ...(tagNames ?? []),
  ]))
  const alternativeTitles = extractAlternativeTitles(attrs.altTitles, title)
  const author = extractAuthor(data.data.relationships)
  const artist = extractArtist(data.data.relationships)
  const coverUrl = buildCoverUrl(seriesId, data.data.relationships)
  const communityRating = statisticsResult
    ? mapCommunityRatingToFiveScale(statisticsResult, seriesId)
    : undefined
  const contentRating = typeof attrs.contentRating === 'string' ? attrs.contentRating : undefined
  const language = typeof attrs.originalLanguage === 'string' ? attrs.originalLanguage : undefined
  const year = typeof attrs.year === 'number' ? attrs.year : undefined
  const tags = tagNames && tagNames.length > 0 ? Array.from(new Set(tagNames)) : undefined
  const readingDirection = mapMangadexReadingDirection(tags)

  return {
    title,
    author,
    artist,
    description,
    genres: genres.length > 0 ? genres : undefined,
    status,
    coverUrl,
    communityRating,
    contentRating,
    readingDirection,
    year,
    language,
    alternativeTitles,
    tags,
  }
}

function mapFeedChapterToChapter(
  entry: NonNullable<ReturnType<typeof fetchChapterFeed> extends Promise<infer TResult> ? TResult : never>['data'][number],
): Chapter | null {
  if (!entry || typeof entry.id !== 'string' || typeof entry.attributes !== 'object' || entry.attributes === null) {
    logger.warn('[mangadex] Skipping malformed chapter entry in feed response')
    return null
  }

  const attrs = entry.attributes
  if (!attrs.translatedLanguage) {
    logger.warn(`[mangadex] Skipping malformed chapter entry with missing language: ${entry.id}`)
    return null
  }

  const isExternal = Boolean(attrs.externalUrl)
  const pageCount = typeof attrs.pages === 'number' ? attrs.pages : 0
  const isUnavailable = pageCount === 0

  const chapterNum = attrs.chapter ? parseFloat(attrs.chapter) : undefined
  const volumeNum = attrs.volume ? parseInt(attrs.volume, 10) : undefined
  const volumeLabel = attrs.volume ? `Vol. ${attrs.volume}` : undefined

  let title = attrs.title || ''
  if (!title && attrs.chapter) {
    title = `Chapter ${attrs.chapter}`
  }
  if (!title) {
    title = `Chapter ${entry.id.slice(0, 8)}`
  }

  const chapter: Chapter = {
    id: entry.id,
    url: `${MANGADEX_SITE_BASE}/chapter/${entry.id}`,
    title,
    locked: isExternal || isUnavailable,
    language: attrs.translatedLanguage,
    chapterLabel: typeof attrs.chapter === 'string' && attrs.chapter.trim().length > 0 ? attrs.chapter.trim() : undefined,
    chapterNumber: Number.isNaN(chapterNum) ? undefined : chapterNum,
    volumeNumber: Number.isNaN(volumeNum) ? undefined : volumeNum,
    volumeLabel,
    comicInfo: {
      Title: title,
      LanguageISO: attrs.translatedLanguage,
    },
  }

  if (isExternal) {
    logger.debug(`[mangadex] Marked external chapter as locked: ${entry.id}`)
  }

  if (isUnavailable) {
    logger.debug(`[mangadex] Marked unavailable chapter as locked (0 pages): ${entry.id}`)
  }

  return chapter
}

export async function fetchMangadexChapterList(seriesId: string, language?: string): Promise<Chapter[]> {
  const chapterById = new Map<string, Chapter>()
  const duplicateChapterIds = new Set<string>()
  let offset = 0
  const limit = 500
  let total = Infinity
  const feedOptions = await resolveMangadexChapterFeedOptions(language)

  while (offset < total && offset < 10000) {
    const feed = await fetchChapterFeed(seriesId, feedOptions, offset, limit)
    total = feed.total

    if (offset === 0 && total > 10000) {
      logger.warn(`[mangadex] Series has ${total} chapters but only first 10000 can be retrieved due to API pagination limit`)
    }

    for (const entry of feed.data) {
      const chapter = mapFeedChapterToChapter(entry)
      if (!chapter) {
        continue
      }

      if (chapterById.has(chapter.id)) {
        duplicateChapterIds.add(chapter.id)
        continue
      }

      chapterById.set(chapter.id, chapter)
    }

    offset += limit
    if (feed.data.length < limit) break
  }

  if (duplicateChapterIds.size > 0) {
    logger.error('[mangadex] Duplicate chapter ids detected in fetchChapterList', {
      seriesId,
      duplicateChapterIds: [...duplicateChapterIds],
    })
  }

  return Array.from(chapterById.values())
}
