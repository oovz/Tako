import { sanitizeLabel } from "@/src/shared/site-integration-utils"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import { ProviderContractError } from "../provider-contract-error"
import {
  parseEpisodeJsonPayload,
  type EpisodeJsonPayload,
  type EpisodeJsonSeriesMetadata,
} from "./contracts/episode-json"

function decodeHtmlAttributeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function parsePayload(
  value: string | null | undefined
): EpisodeJsonPayload | null {
  if (!value) {
    return null
  }
  for (const candidate of [value, decodeHtmlAttributeEntities(value)]) {
    try {
      return parseEpisodeJsonPayload(JSON.parse(candidate))
    } catch {
      // Try the decoded attribute representation next.
    }
  }
  return null
}

export function readEpisodeJsonAttributeFromHtml(html: string): string | null {
  if (typeof DOMParser === "function") {
    const parsed = new DOMParser().parseFromString(html, "text/html")
    return (
      parsed.querySelector("script#episode-json")?.getAttribute("data-value") ??
      null
    )
  }

  const scriptTag = html.match(
    /<script\b(?=[^>]*\bid=["']episode-json["'])[^>]*>/i
  )?.[0]
  if (!scriptTag) {
    return null
  }
  return scriptTag.match(/\bdata-value\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] ?? null
}

function normalizeEpisodeJsonSeriesMetadata(
  payload: EpisodeJsonPayload | null
): EpisodeJsonSeriesMetadata {
  const series = payload?.readableProduct?.series
  const seriesId =
    typeof series?.id === "string" && /^\d+$/.test(series.id)
      ? series.id
      : undefined
  const seriesTitle =
    typeof series?.title === "string" ? sanitizeLabel(series.title) : ""
  const seriesThumbnailUri =
    typeof series?.thumbnailUri === "string" ? series.thumbnailUri : ""
  return {
    seriesId,
    seriesTitle: seriesTitle || undefined,
    seriesThumbnailUri: seriesThumbnailUri || undefined,
  }
}

export function readEpisodeJsonSeriesMetadataFromHtml(
  html: string
): EpisodeJsonSeriesMetadata {
  const attribute = readEpisodeJsonAttributeFromHtml(html)
  return normalizeEpisodeJsonSeriesMetadata(parsePayload(attribute))
}

export function extractImageUrlsFromEpisodeJsonScript(html: string): string[] {
  if (!html) {
    return []
  }
  const payload = parsePayload(readEpisodeJsonAttributeFromHtml(html))
  const pages = payload?.readableProduct?.pageStructure?.pages
  if (!Array.isArray(pages)) {
    return []
  }
  if (pages.length > MAX_CHAPTER_IMAGES) {
    throw new ProviderContractError(
      `Shonen Jump+ chapter exceeds the ${MAX_CHAPTER_IMAGES} image limit.`
    )
  }
  const imageUrls: string[] = []
  for (const page of pages) {
    if (page.type !== "main") continue
    if (typeof page.src !== "string" || page.src.length === 0) {
      throw new ProviderContractError(
        "Shonen Jump+ main page is missing its image URL."
      )
    }
    imageUrls.push(page.src)
  }
  return imageUrls
}
