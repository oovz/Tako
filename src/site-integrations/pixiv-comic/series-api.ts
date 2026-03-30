import type { Chapter } from '../../types/chapter'
import type { SeriesMetadata } from '../../types/series-metadata'
import logger from '@/src/runtime/logger'
import { rateLimitedFetchByUrlScope } from '@/src/runtime/rate-limit'
import { normalizeNumericText, parseChapterNumber, sanitizeLabel } from '@/src/shared/site-integration-utils'
import {
  createPixivAppHeaders,
  PIXIV_BASE_URL,
  sanitizePixivHtmlText,
  type PixivEpisodeEntry,
  type PixivEpisodesV2Response,
  type PixivOfficialWork,
  type PixivWorkV5Response,
} from './shared'

async function fetchPixivWorkV5(workId: string): Promise<PixivOfficialWork> {
  const endpoint = `${PIXIV_BASE_URL}/api/app/works/v5/${workId}`
  const response = await rateLimitedFetchByUrlScope(endpoint, 'chapter', {
    credentials: 'include',
    headers: createPixivAppHeaders(),
  })

  if (!response.ok) {
    throw new Error(`Pixiv Comic works/v5 failed: HTTP ${response.status}`)
  }

  const payload = (await response.json()) as PixivWorkV5Response
  const officialWork = payload.data?.official_work
  if (!officialWork?.name) {
    throw new Error('Pixiv Comic API may have changed (official_work missing)')
  }

  return officialWork
}

async function fetchPixivEpisodesV2(workId: string, order: 'asc' | 'desc' = 'asc'): Promise<NonNullable<NonNullable<PixivEpisodesV2Response['data']>['episodes']>> {
  const endpoint = `${PIXIV_BASE_URL}/api/app/works/${workId}/episodes/v2?order=${order}`
  const response = await rateLimitedFetchByUrlScope(endpoint, 'chapter', {
    credentials: 'include',
    headers: createPixivAppHeaders(),
  })

  if (!response.ok) {
    throw new Error(`Pixiv Comic episodes/v2 failed: HTTP ${response.status}`)
  }

  const payload = (await response.json()) as PixivEpisodesV2Response
  return payload.data?.episodes ?? []
}

function parsePixivVolumeInfo(chapterTitle: string): { volumeLabel?: string; volumeNumber?: number } {
  const normalized = sanitizeLabel(chapterTitle)
  if (!normalized) {
    return {}
  }

  const explicitVolumeMatch = normalizeNumericText(normalized).match(/(?:vol(?:ume)?\.?\s*|第\s*)(\d+)(?:\s*巻)/i)
  if (!explicitVolumeMatch) {
    return {}
  }

  const parsed = Number(explicitVolumeMatch[1])
  if (!Number.isFinite(parsed)) {
    return {}
  }

  return {
    volumeLabel: explicitVolumeMatch[0],
    volumeNumber: parsed,
  }
}

function mapPixivEpisodeToChapter(entry: PixivEpisodeEntry): Chapter | null {
  const episode = entry.episode
  if (!episode || typeof episode.id !== 'number') {
    return null
  }

  const id = String(episode.id)
  const viewerPath = episode.viewer_path || `/viewer/stories/${id}`
  const url = new URL(viewerPath, PIXIV_BASE_URL).toString()

  const numberingTitle = sanitizeLabel(episode.numbering_title || '')
  const subtitle = sanitizeLabel(episode.sub_title || '')
  const chapterTitle = sanitizeLabel([numberingTitle, subtitle].filter((part) => part.length > 0).join(' ')) || `Chapter ${id}`
  const chapterNumber = parseChapterNumber(chapterTitle)
  const { volumeLabel, volumeNumber } = parsePixivVolumeInfo(chapterTitle)

  const state = sanitizeLabel(entry.state || episode.state || '').toLowerCase()
  const locked = state.length > 0 ? state !== 'readable' : false

  return {
    id,
    url,
    title: chapterTitle,
    locked,
    chapterLabel: numberingTitle || undefined,
    chapterNumber,
    volumeLabel,
    volumeNumber,
    comicInfo: { Title: chapterTitle },
  }
}

function resolvePixivCoverUrl(work: PixivOfficialWork): string | undefined {
  return work.image?.main_big || work.image?.main || work.image?.thumbnail || undefined
}

export async function fetchPixivSeriesMetadata(seriesId: string): Promise<SeriesMetadata> {
  const work = await fetchPixivWorkV5(seriesId)

  return {
    title: sanitizeLabel(work.name || '') || `Pixiv Comic ${seriesId}`,
    author: sanitizeLabel(work.author || '') || undefined,
    description: sanitizePixivHtmlText(work.description),
    coverUrl: resolvePixivCoverUrl(work),
    language: 'ja',
    readingDirection: 'rtl',
  }
}

export async function fetchPixivChapterList(seriesId: string): Promise<Chapter[]> {
  const episodes = await fetchPixivEpisodesV2(seriesId, 'asc')
  const chapterById = new Map<string, Chapter>()
  const duplicateChapterIds = new Set<string>()

  for (const entry of episodes) {
    const chapter = mapPixivEpisodeToChapter(entry)
    if (!chapter) {
      continue
    }

    const existing = chapterById.get(chapter.id)
    if (!existing) {
      chapterById.set(chapter.id, chapter)
      continue
    }

    duplicateChapterIds.add(chapter.id)

    const existingLockedRank = existing.locked ? 1 : 0
    const nextLockedRank = chapter.locked ? 1 : 0
    if (nextLockedRank < existingLockedRank) {
      chapterById.set(chapter.id, chapter)
    }
  }

  if (duplicateChapterIds.size > 0) {
    logger.error('[pixiv-comic] Duplicate chapter ids detected in fetchChapterList', {
      seriesId,
      duplicateChapterIds: [...duplicateChapterIds],
    })
  }

  return Array.from(chapterById.values())
}
