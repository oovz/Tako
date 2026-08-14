import type {
  RateLimitPolicySnapshot,
  RateLimitService,
} from "@/src/runtime/rate-limit"
import { sanitizeLabel } from "@/src/shared/site-integration-utils"
import { ProviderContractError } from "../provider-contract-error"

export const PIXIV_BASE_URL = "https://comic.pixiv.net"
export const PIXIV_EPISODES_API_URL = `${PIXIV_BASE_URL}/api/app/episodes`
export const PIXIV_IMAGE_REFERRER = `${PIXIV_BASE_URL}/`
export const PIXIV_KEY_FRAGMENT_PARAM = "tmdPixivKey"
export const PIXIV_GRIDSHUFFLE_HEADER =
  "x-cobalt-thumber-parameter-gridshuffle-key"

export const PIXIV_BUILD_ID_CACHE_MAX_SIZE = 50
export const PIXIV_BUILD_ID_CACHE_TTL_MS = 5 * 60 * 1000

export const pixivBuildIdCacheByTask = new Map<string, string>()
const pixivBuildIdCacheTimestampsByTask = new Map<string, number>()

function isPixivBuildIdCacheExpired(taskId: string): boolean {
  const cachedAt = pixivBuildIdCacheTimestampsByTask.get(taskId)
  if (typeof cachedAt !== "number") {
    return true
  }
  return Date.now() - cachedAt > PIXIV_BUILD_ID_CACHE_TTL_MS
}

function pruneExpiredPixivBuildIds(): void {
  for (const [taskId] of pixivBuildIdCacheByTask) {
    if (isPixivBuildIdCacheExpired(taskId)) {
      pixivBuildIdCacheByTask.delete(taskId)
      pixivBuildIdCacheTimestampsByTask.delete(taskId)
    }
  }
}

export function getPixivBuildIdCache(taskId: string): string | undefined {
  if (isPixivBuildIdCacheExpired(taskId)) {
    pixivBuildIdCacheByTask.delete(taskId)
    pixivBuildIdCacheTimestampsByTask.delete(taskId)
    return undefined
  }
  return pixivBuildIdCacheByTask.get(taskId)
}

export function cachePixivBuildId(taskId: string, buildId: string): void {
  pruneExpiredPixivBuildIds()
  if (
    !pixivBuildIdCacheByTask.has(taskId) &&
    pixivBuildIdCacheByTask.size >= PIXIV_BUILD_ID_CACHE_MAX_SIZE
  ) {
    const firstKey = pixivBuildIdCacheByTask.keys().next().value
    if (firstKey !== undefined) {
      pixivBuildIdCacheByTask.delete(firstKey)
      pixivBuildIdCacheTimestampsByTask.delete(firstKey)
    }
  }
  pixivBuildIdCacheByTask.set(taskId, buildId)
  pixivBuildIdCacheTimestampsByTask.set(taskId, Date.now())
}

export type PixivResolveContext = {
  taskId?: string
  rateLimitSettings?: RateLimitPolicySnapshot
  rateLimitService: RateLimitService
  signal?: AbortSignal
}

export type PixivReadV4Page = {
  src?: string
  url?: string
  image_url?: string
  key?: string
}

export type PixivWorkV5Response = {
  data?: {
    official_work?: {
      id?: number
      name?: string
      author?: string
      description?: string
      image?: {
        main?: string
        main_big?: string
        thumbnail?: string
      }
    }
  }
}

export type PixivOfficialWork = NonNullable<
  NonNullable<PixivWorkV5Response["data"]>["official_work"]
>

export type PixivEpisodesV2Response = {
  data?: {
    episodes?: Array<{
      state?: string
      episode?: {
        id?: number
        numbering_title?: string
        sub_title?: string
        read_start_at?: number
        viewer_path?: string
        sales_type?: string
        state?: string
      }
    }>
  }
}

export type PixivEpisodeEntry = NonNullable<
  NonNullable<PixivEpisodesV2Response["data"]>["episodes"]
>[number]

export const createPixivAppHeaders = (): Record<string, string> => ({
  "x-requested-with": "pixivcomic",
  "x-referer": PIXIV_BASE_URL,
})

export const sanitizePixivHtmlText = (
  value: string | undefined
): string | undefined => {
  const normalized = sanitizeLabel(
    (value || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
  )
  return normalized || undefined
}

export function normalizePixivImageUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value, PIXIV_IMAGE_REFERRER)
  } catch {
    throw new ProviderContractError("Invalid Pixiv image URL")
  }

  const isPixivComicDeliveryPath =
    parsed.origin === PIXIV_BASE_URL && parsed.pathname.startsWith("/c/")
  const isPixivImageHost =
    parsed.hostname === "pximg.net" || parsed.hostname.endsWith(".pximg.net")
  if (
    parsed.protocol !== "https:" ||
    (!isPixivComicDeliveryPath && !isPixivImageHost)
  ) {
    throw new ProviderContractError(
      `Untrusted Pixiv image URL: ${parsed.origin}`
    )
  }

  return parsed.toString()
}
