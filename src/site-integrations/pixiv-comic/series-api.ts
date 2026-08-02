import type { Chapter } from "../../types/chapter"
import type { SeriesMetadata } from "../../types/series-metadata"
import type { SeriesChapterListResult } from "../../types/site-integrations"
import logger from "@/src/runtime/logger"
import { rateLimitedFetchForIntegration } from "@/src/runtime/rate-limit"
import {
  parseChapterNumber,
  sanitizeLabel,
} from "@/src/shared/site-integration-utils"
import { parseEpisodeIdFromUrl } from "./page-context"
import {
  createPixivAppHeaders,
  normalizePixivImageUrl,
  PIXIV_BASE_URL,
  sanitizePixivHtmlText,
  type PixivEpisodeEntry,
  type PixivEpisodesV2Response,
  type PixivOfficialWork,
  type PixivWorkV5Response,
} from "./shared"
import { ProviderContractError } from "../provider-contract-error"
import { readResponseJson } from "@/src/shared/html-response-decoder"

async function fetchPixivWorkV5(
  workId: string,
  signal?: AbortSignal
): Promise<PixivOfficialWork> {
  const endpoint = `${PIXIV_BASE_URL}/api/app/works/v5/${workId}`
  const response = await rateLimitedFetchForIntegration(
    "pixiv-comic",
    endpoint,
    "chapter",
    {
      credentials: "include",
      headers: createPixivAppHeaders(),
      signal,
    }
  )

  if (!response.ok) {
    throw new Error(`Pixiv Comic works/v5 failed: HTTP ${response.status}`)
  }

  const payload = (await readResponseJson(response)) as PixivWorkV5Response
  const officialWork = payload.data?.official_work
  if (!officialWork?.name) {
    throw new ProviderContractError(
      "Pixiv Comic API may have changed (official_work missing)"
    )
  }

  return officialWork
}

async function fetchPixivEpisodesV2(
  workId: string,
  order: "asc" | "desc" = "asc",
  signal?: AbortSignal
): Promise<
  NonNullable<NonNullable<PixivEpisodesV2Response["data"]>["episodes"]>
> {
  const endpoint = `${PIXIV_BASE_URL}/api/app/works/${workId}/episodes/v2?order=${order}`
  const response = await rateLimitedFetchForIntegration(
    "pixiv-comic",
    endpoint,
    "chapter",
    {
      credentials: "include",
      headers: createPixivAppHeaders(),
      signal,
    }
  )

  if (!response.ok) {
    throw new Error(`Pixiv Comic episodes/v2 failed: HTTP ${response.status}`)
  }

  const payload = (await readResponseJson(response)) as PixivEpisodesV2Response
  if (!Array.isArray(payload.data?.episodes)) {
    throw new ProviderContractError(
      "Pixiv Comic API may have changed (episodes missing)"
    )
  }
  return payload.data.episodes
}

function hasEpisodeReadStarted(readStartAt: number | undefined): boolean {
  if (readStartAt === undefined) {
    return true
  }
  if (!Number.isFinite(readStartAt) || readStartAt <= 0) {
    return false
  }

  const startTimeMs =
    readStartAt < 1_000_000_000_000 ? readStartAt * 1000 : readStartAt
  return startTimeMs <= Date.now()
}

function isPixivEpisodeReadable(entry: PixivEpisodeEntry): boolean {
  const episode = entry.episode
  const state = sanitizeLabel(entry.state ?? episode?.state ?? "").toLowerCase()
  return state === "readable" && hasEpisodeReadStarted(episode?.read_start_at)
}

function mapPixivEpisodeToChapter(entry: PixivEpisodeEntry): Chapter | null {
  const episode = entry.episode
  if (!episode || typeof episode.id !== "number") {
    return null
  }

  const id = String(episode.id)
  const canonicalUrl = `${PIXIV_BASE_URL}/viewer/stories/${id}`
  let url = canonicalUrl
  if (episode.viewer_path) {
    const candidateUrl = new URL(episode.viewer_path, PIXIV_BASE_URL).toString()
    if (parseEpisodeIdFromUrl(candidateUrl) === id) {
      url = candidateUrl
    }
  }

  const numberingTitle = sanitizeLabel(episode.numbering_title || "")
  const subtitle = sanitizeLabel(episode.sub_title || "")
  const chapterTitle =
    sanitizeLabel(
      [numberingTitle, subtitle].filter((part) => part.length > 0).join(" ")
    ) || `Chapter ${id}`
  const chapterNumber = parseChapterNumber(chapterTitle)

  const locked = !isPixivEpisodeReadable(entry)

  return {
    id,
    url,
    title: chapterTitle,
    locked,
    chapterLabel: numberingTitle || undefined,
    chapterNumber,
    comicInfo: { Title: chapterTitle },
  }
}

function resolvePixivCoverUrl(work: PixivOfficialWork): string | undefined {
  const candidate =
    work.image?.main_big ||
    work.image?.main ||
    work.image?.thumbnail ||
    undefined
  return candidate ? normalizePixivImageUrl(candidate) : undefined
}

export async function fetchPixivSeriesMetadata(
  seriesId: string,
  _language?: string,
  signal?: AbortSignal
): Promise<SeriesMetadata> {
  const work = await fetchPixivWorkV5(seriesId, signal)

  return {
    title: sanitizeLabel(work.name || "") || `Pixiv Comic ${seriesId}`,
    author: sanitizeLabel(work.author || "") || undefined,
    description: sanitizePixivHtmlText(work.description),
    coverUrl: resolvePixivCoverUrl(work),
    language: "ja",
    readingDirection: "rtl",
  }
}

export async function fetchPixivChapterList(
  seriesId: string,
  _language?: string,
  signal?: AbortSignal
): Promise<SeriesChapterListResult> {
  const episodes = await fetchPixivEpisodesV2(seriesId, "asc", signal)
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
    logger.error(
      "[pixiv-comic] Duplicate chapter ids detected in fetchChapterList",
      {
        seriesId,
        duplicateChapterIds: [...duplicateChapterIds],
      }
    )
  }

  const chapters = Array.from(chapterById.values())
  return {
    chapters,
    volumes: [],
  }
}
