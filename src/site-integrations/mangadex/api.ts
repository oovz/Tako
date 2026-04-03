import type { AtHomeResponse } from './image-delivery'
import logger from '@/src/runtime/logger'

export const MANGADEX_API_BASE = 'https://api.mangadex.org'
export const MANGADEX_UPLOADS_BASE = 'https://uploads.mangadex.org'
export const MANGADEX_NETWORK_REPORT = 'https://api.mangadex.network/report'
export const MANGADEX_NETWORK_REPORT_HOST = new URL(MANGADEX_NETWORK_REPORT).hostname
export const MANGADEX_NETWORK_REPORT_TIMEOUT_MS = 1500
export const MANGADEX_IMAGE_RECOVERY_MAX_CYCLES = 5
export const MANGADEX_IMAGE_RECOVERY_BACKOFF_MS = 250
export const MANGADEX_SITE_BASE = 'https://mangadex.org'

type MangadexRetryConfig = {
  maxRetries: number
  defaultRetryDelayMs: number
  maxRetryDelayMs: number
}

const MANGADEX_RETRY_CONFIG: MangadexRetryConfig = {
  maxRetries: 3,
  defaultRetryDelayMs: 5000,
  maxRetryDelayMs: 60000,
}

export type MangadexStatisticsResponse = {
  statistics?: Record<string, {
    rating?: {
      average?: number
      bayesian?: number
    }
  }>
}

export type MangadexRelationship = {
  id: string
  type: string
  attributes?: Record<string, unknown>
}

export type MangadexMangaResponse = {
  result: string
  data: {
    id: string
    type: string
    attributes: {
      title: Record<string, string>
      altTitles?: Array<Record<string, string>>
      description?: Record<string, string>
      contentRating?: string
      originalLanguage?: string
      publicationDemographic?: string
      status?: string
      tags?: Array<{ attributes: { name: Record<string, string> } }>
      year?: number
    }
    relationships: MangadexRelationship[]
  }
}

export type MangadexChapterFeedResponse = {
  result: string
  data: Array<{
    id: string
    type: string
    attributes: {
      volume?: string | null
      chapter?: string | null
      title?: string | null
      translatedLanguage: string
      pages: number
      externalUrl?: string
    }
  }>
  total: number
  offset: number
  limit: number
}

const parseRetryAfterHeader = (response: Response): number | null => {
  const retryAfter = response.headers.get('X-RateLimit-Retry-After')
  if (!retryAfter) return null

  const timestamp = parseInt(retryAfter, 10)
  if (Number.isNaN(timestamp)) return null

  const delayMs = (timestamp * 1000) - Date.now()
  return Math.min(
    Math.max(delayMs, 100),
    MANGADEX_RETRY_CONFIG.maxRetryDelayMs,
  )
}

export async function fetchWithMangadexRetry(
  url: string,
  options?: RequestInit,
  retryCount = 0,
): Promise<Response> {
  const response = await fetch(url, options)

  if (response.status === 429 && retryCount < MANGADEX_RETRY_CONFIG.maxRetries) {
    const retryDelay = parseRetryAfterHeader(response) ?? MANGADEX_RETRY_CONFIG.defaultRetryDelayMs
    logger.warn(`[mangadex] Rate limited (429), retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${MANGADEX_RETRY_CONFIG.maxRetries})`)
    await new Promise((resolve) => setTimeout(resolve, retryDelay))
    return fetchWithMangadexRetry(url, options, retryCount + 1)
  }

  return response
}

export function parseUuidFromPath(pathname: string, prefix: string): string | null {
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length < 2) return null
  if (segs[0] !== prefix) return null
  const id = segs[1]
  return id && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id) ? id : null
}

export function parseChapterIdFromUrl(chapterUrl: string): string {
  const url = new URL(chapterUrl)
  const id = parseUuidFromPath(url.pathname, 'chapter')
  if (!id) {
    const segs = url.pathname.split('/').filter(Boolean)
    if (segs.length >= 2 && segs[0] === 'chapter') return segs[1]
    throw new Error(`Invalid MangaDex chapter URL: ${chapterUrl}`)
  }
  return id
}

export async function fetchMangaMetadata(mangaId: string): Promise<MangadexMangaResponse> {
  const url = `${MANGADEX_API_BASE}/manga/${mangaId}?includes[]=author&includes[]=artist&includes[]=cover_art`
  const response = await fetchWithMangadexRetry(url, { credentials: 'omit' })

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('MangaDex rate limit exceeded. Please wait and try again.')
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return (await response.json()) as MangadexMangaResponse
}

export async function fetchMangaStatistics(mangaId: string): Promise<MangadexStatisticsResponse> {
  const url = `${MANGADEX_API_BASE}/statistics/manga/${mangaId}`
  const response = await fetchWithMangadexRetry(url, { credentials: 'omit' })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return (await response.json()) as MangadexStatisticsResponse
}

export function mapCommunityRatingToFiveScale(stats: MangadexStatisticsResponse, mangaId: string): number | undefined {
  const bayesian = stats.statistics?.[mangaId]?.rating?.bayesian
  if (typeof bayesian !== 'number' || Number.isNaN(bayesian)) {
    return undefined
  }

  return Math.max(0, Math.min(5, Number((bayesian / 2).toFixed(2))))
}

export async function fetchChapterFeed(
  mangaId: string,
  options: {
    languages?: string[]
    contentRatings?: string[]
  } = {},
  offset = 0,
  limit = 500,
): Promise<MangadexChapterFeedResponse> {
  const params = new URLSearchParams({
    'order[chapter]': 'asc',
    'order[volume]': 'asc',
    offset: String(offset),
    limit: String(limit),
  })

  for (const language of options.languages ?? []) {
    params.append('translatedLanguage[]', language)
  }

  for (const contentRating of options.contentRatings ?? []) {
    params.append('contentRating[]', contentRating)
  }

  const url = `${MANGADEX_API_BASE}/manga/${mangaId}/feed?${params}`
  const response = await fetchWithMangadexRetry(url, { credentials: 'omit' })

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('MangaDex rate limit exceeded. Please wait and try again.')
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return (await response.json()) as MangadexChapterFeedResponse
}

export async function fetchAtHomeServer(chapterId: string): Promise<AtHomeResponse> {
  const url = `${MANGADEX_API_BASE}/at-home/server/${chapterId}`
  const response = await fetchWithMangadexRetry(url, { credentials: 'omit' })

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('MangaDex at-home rate limit exceeded (40/min). Please wait.')
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return (await response.json()) as AtHomeResponse
}
