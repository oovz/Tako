import { sanitizeLabel } from "@/src/shared/site-integration-utils"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import { ProviderContractError } from "../provider-contract-error"
import { assertIntegrationEndpointRequestUrl } from "../request-policy"
import {
  parseEpisodeJsonPayload,
  type EpisodeJsonPayload,
  type EpisodeJsonSeriesMetadata,
} from "./contracts/episode-json"

function decodeHtmlAttributeEntities(value: string): string {
  const character = (entity: string, digits: string, radix: number) => {
    const codePoint = Number.parseInt(digits, radix)
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity
  }
  return value
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) =>
      character(entity, hex, 16)
    )
    .replace(/&#(\d+);/g, (entity, decimal: string) =>
      character(entity, decimal, 10)
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function readSeriesHeaderText(
  html: string,
  element: "h2" | "p",
  className: "series-header-author" | "series-header-description"
): string | undefined {
  const pattern = new RegExp(
    `<${element}\\b[^>]*\\sclass\\s*=\\s*(["'])${className}\\1[^>]*>([\\s\\S]*?)</${element}\\s*>`,
    "i"
  )
  const content = html.match(pattern)?.[2]
  if (!content) return undefined
  return (
    sanitizeLabel(
      decodeHtmlAttributeEntities(content.replace(/<[^>]+>/g, " "))
    ) || undefined
  )
}

function parsePayload(
  value: string | null | undefined
): EpisodeJsonPayload | null {
  if (!value) {
    return null
  }
  try {
    return parseEpisodeJsonPayload(JSON.parse(value))
  } catch {
    return null
  }
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
  const attribute = scriptTag.match(
    /\bdata-value\s*=\s*(["'])([\s\S]*?)\1/i
  )?.[2]
  return attribute ? decodeHtmlAttributeEntities(attribute) : null
}

function normalizeSeriesCoverUrl(
  thumbnailUri: string | undefined,
  baseUrl: string
): string | undefined {
  if (!thumbnailUri) return undefined
  return assertIntegrationEndpointRequestUrl(
    "shonenjumpplus",
    "shonenjumpplus-image-cdn",
    new URL(thumbnailUri, baseUrl).href
  ).href
}

function normalizeEpisodeJsonSeriesMetadata(
  payload: EpisodeJsonPayload | null,
  baseUrl: string
): EpisodeJsonSeriesMetadata {
  const series = payload?.readableProduct?.series
  if (!series)
    return {
      seriesId: undefined,
      seriesTitle: undefined,
      seriesThumbnailUri: undefined,
    }
  return {
    seriesId: series.id && /^\d+$/.test(series.id) ? series.id : undefined,
    seriesTitle: sanitizeLabel(series.title ?? "") || undefined,
    seriesThumbnailUri: normalizeSeriesCoverUrl(series.thumbnailUri, baseUrl),
  }
}

export function readEpisodeJsonSeriesMetadataFromHtml(
  html: string,
  baseUrl = "https://shonenjumpplus.com/"
): EpisodeJsonSeriesMetadata {
  const attribute = readEpisodeJsonAttributeFromHtml(html)
  return {
    ...normalizeEpisodeJsonSeriesMetadata(parsePayload(attribute), baseUrl),
    author: readSeriesHeaderText(html, "h2", "series-header-author"),
    description: readSeriesHeaderText(html, "p", "series-header-description"),
  }
}

function mainPageImageUrl(page: { src?: string }): string {
  if (typeof page.src !== "string" || page.src.length === 0)
    throw new ProviderContractError(
      "Shonen Jump+ main page is missing its image URL."
    )
  return page.src
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
    imageUrls.push(mainPageImageUrl(page))
  }
  return imageUrls
}
