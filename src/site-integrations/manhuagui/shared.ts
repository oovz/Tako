import { sanitizeLabel } from "@/src/shared/site-integration-utils"
import {
  MANHUAGUI_BASE_URL,
  MANHUAGUI_CONFIG_HOST,
  MANHUAGUI_IMAGE_HOST_NAMES,
  MANHUAGUI_PAGE_HOST_NAMES,
} from "./policy"

/**
 * Canonical Manhuagui origin used for building absolute URLs from relative
 * links and as the `Referer` header when downloading CDN images.
 */
export { MANHUAGUI_BASE_URL }

/** Default protocol used when constructing absolute image URLs. */
export const DEFAULT_IMAGE_PROTOCOL = "https:"

export const MANHUAGUI_PAGE_HOSTS = new Set<string>(MANHUAGUI_PAGE_HOST_NAMES)
export { MANHUAGUI_CONFIG_HOST }
export const MANHUAGUI_IMAGE_HOSTS = new Set<string>(MANHUAGUI_IMAGE_HOST_NAMES)

/** Matches `/comic/{id}` or `/comic/{id}/` (trailing slash optional). */
export const SERIES_PATH_REGEX = /^\/comic\/(\d+)\/?$/

/** Matches `/comic/{seriesId}/{chapterId}.html`, optionally with `_p{index}` suffix. */
export const CHAPTER_PATH_REGEX = /^\/comic\/\d+\/(\d+)(?:_p\d+)?\.html$/

export function parseSeriesIdFromPath(pathname: string): string | null {
  return pathname.match(SERIES_PATH_REGEX)?.[1] ?? null
}

export function parseChapterIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== "https:" ||
      !MANHUAGUI_PAGE_HOSTS.has(parsed.hostname)
    ) {
      return null
    }
    return parsed.pathname.match(CHAPTER_PATH_REGEX)?.[1] ?? null
  } catch {
    return null
  }
}

export function assertManhuaguiChapterUrl(url: string): URL {
  const parsed = new URL(url)
  if (
    parsed.protocol !== "https:" ||
    !MANHUAGUI_PAGE_HOSTS.has(parsed.hostname) ||
    !CHAPTER_PATH_REGEX.test(parsed.pathname)
  ) {
    throw new Error("Manhuagui chapter URL origin or path is not allowed")
  }
  return parsed
}

export function isAllowedManhuaguiImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === "https:" && MANHUAGUI_IMAGE_HOSTS.has(parsed.hostname)
    )
  } catch {
    return false
  }
}

export function toAllowedManhuaguiAssetUrl(
  url: string | null | undefined
): string | undefined {
  const absolute = toAbsoluteUrl(url)
  if (!absolute) return undefined
  const parsed = new URL(absolute)
  const isOfficialPageHost = MANHUAGUI_PAGE_HOSTS.has(parsed.hostname)
  const isOfficialCdnHost =
    parsed.hostname === MANHUAGUI_CONFIG_HOST ||
    parsed.hostname === "hamreus.com" ||
    parsed.hostname.endsWith(".hamreus.com")
  return parsed.protocol === "https:" &&
    (isOfficialPageHost || isOfficialCdnHost)
    ? parsed.toString()
    : undefined
}

/**
 * Resolve a possibly-relative URL (`//host/path`, `/path`, `path`) against the
 * Manhuagui origin. Returns `undefined` when the input is empty or malformed so
 * callers can `??`-chain through multiple candidate attributes.
 */
export function toAbsoluteUrl(
  url: string | null | undefined,
  baseUrl: string = MANHUAGUI_BASE_URL
): string | undefined {
  const raw = sanitizeLabel(url ?? "")
  if (!raw) {
    return undefined
  }

  if (raw.startsWith("//")) {
    return `https:${raw}`
  }

  try {
    return new URL(raw, baseUrl).toString()
  } catch {
    return undefined
  }
}
