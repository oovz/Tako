import type { Chapter } from "@/src/types/chapter"
import type { SeriesChapterListResult } from "@/src/types/site-integrations"
import logger from "@/src/runtime/logger"
import { integrationHttpClient } from "../http-client"
import {
  parseChapterNumber,
  sanitizeLabel,
} from "@/src/shared/site-integration-utils"
import { parseTrustedShonenJumpPlusEpisodeUrl } from "./urls"
import { ProviderContractError } from "../provider-contract-error"
import { readResponseJson } from "@/src/shared/html-response-decoder"
import type { RateLimitService } from "@/src/runtime/rate-limit"

export type PaginationInfo = {
  per_page?: number
  readable_products_count?: number
}

export type ProductStatus = {
  label?: string
  is_free?: boolean
  isFree?: boolean
  is_readable?: boolean
  isReadable?: boolean
  rental_price?: number | null
  buy_price?: number | null
}

export type PaginationProduct = {
  readable_product_id?: string
  viewer_uri?: string
  title?: string
  status?: ProductStatus
}

const API_BASE = "https://shonenjumpplus.com/api/viewer"
const PUBLIC_FETCH_INIT: RequestInit = { credentials: "omit" }
const MAX_SERIES_CHAPTERS = 5_000
const MAX_PAGINATION_REQUESTS = 100
const MAX_PAGE_SIZE = 100

function isExplicitlyFree(status: ProductStatus | undefined): boolean {
  const explicit =
    status?.is_free ??
    status?.isFree ??
    status?.is_readable ??
    status?.isReadable
  if (typeof explicit === "boolean") {
    return explicit
  }
  const label = sanitizeLabel(status?.label || "").toLowerCase()
  return (
    label === "free" ||
    label === "is_free" ||
    label === "readable" ||
    label === "is_readable"
  )
}

export function mapEpisode(product: PaginationProduct): Chapter | null {
  const id =
    typeof product.readable_product_id === "string"
      ? product.readable_product_id
      : ""
  if (!/^\d+$/.test(id)) {
    return null
  }
  const trusted = parseTrustedShonenJumpPlusEpisodeUrl(
    typeof product.viewer_uri === "string" && product.viewer_uri
      ? product.viewer_uri
      : `/episode/${id}`,
    "https://shonenjumpplus.com"
  )
  if (!trusted || trusted.episodeId !== id) {
    return null
  }
  const title = sanitizeLabel(product.title || "") || `Episode ${id}`
  return {
    id,
    url: trusted.url.href,
    title,
    locked: !isExplicitlyFree(product.status),
    chapterLabel: title,
    chapterNumber: parseChapterNumber(title),
    comicInfo: {
      Title: title,
      LanguageISO: "ja",
      Manga: "YesAndRightToLeft",
    },
  }
}

export async function fetchPaginationInfo(
  aggregateId: string,
  episodeId: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<PaginationInfo> {
  const endpoint = new URL(
    `${API_BASE}/readable_product_pagination_information`
  )
  endpoint.searchParams.set("type", "episode")
  endpoint.searchParams.set("aggregate_id", aggregateId)
  endpoint.searchParams.set("readable_product_id", episodeId)
  const response = await integrationHttpClient.request({
    integrationId: "shonenjumpplus",
    endpointId: "shonenjumpplus-viewer-api",
    url: endpoint.href,
    scope: "chapter",
    init: { ...PUBLIC_FETCH_INIT, signal },
    rateLimitService,
  })
  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Shonen Jump+ chapter list could not be loaded (HTTP ${response.status}).`
      ),
      { status: response.status }
    )
  }
  return (await readResponseJson(response)) as PaginationInfo
}

export async function fetchProducts(
  aggregateId: string,
  offset: number,
  limit: number,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<PaginationProduct[]> {
  const endpoint = new URL(`${API_BASE}/pagination_readable_products`)
  endpoint.searchParams.set("type", "episode")
  endpoint.searchParams.set("aggregate_id", aggregateId)
  endpoint.searchParams.set("offset", String(offset))
  endpoint.searchParams.set("limit", String(limit))
  endpoint.searchParams.set("sort_order", "desc")
  endpoint.searchParams.set("is_guest", "1")
  const response = await integrationHttpClient.request({
    integrationId: "shonenjumpplus",
    endpointId: "shonenjumpplus-viewer-api",
    url: endpoint.href,
    scope: "chapter",
    init: { ...PUBLIC_FETCH_INIT, signal },
    rateLimitService,
  })
  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Shonen Jump+ chapter list could not be loaded (HTTP ${response.status}).`
      ),
      { status: response.status }
    )
  }
  const payload = await readResponseJson(response)
  if (!Array.isArray(payload)) {
    throw new ProviderContractError(
      "Shonen Jump+ chapter list returned an unexpected response structure."
    )
  }
  return payload as PaginationProduct[]
}

export async function fetchShonenJumpPlusChapterList(
  aggregateId: string,
  episodeId: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<SeriesChapterListResult> {
  const info = await fetchPaginationInfo(
    aggregateId,
    episodeId,
    rateLimitService,
    signal
  )
  const reportedPageSize =
    typeof info.per_page === "number" &&
    Number.isFinite(info.per_page) &&
    info.per_page > 0
      ? Math.floor(info.per_page)
      : 50
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, reportedPageSize))
  const reportedTotal =
    typeof info.readable_products_count === "number" &&
    Number.isFinite(info.readable_products_count) &&
    info.readable_products_count > 0
      ? Math.floor(info.readable_products_count)
      : limit
  const targetTotal = Math.min(reportedTotal, MAX_SERIES_CHAPTERS)

  const chapters = new Map<string, Chapter>()
  const duplicateIds = new Set<string>()
  let retrieved = 0
  let requestCount = 0
  for (
    let offset = 0;
    offset < targetTotal && requestCount < MAX_PAGINATION_REQUESTS;
    offset += limit
  ) {
    requestCount += 1
    const products = await fetchProducts(
      aggregateId,
      offset,
      limit,
      rateLimitService,
      signal
    )
    retrieved += products.length
    for (const product of products) {
      const chapter = mapEpisode(product)
      if (!chapter) continue
      if (chapters.has(chapter.id)) {
        duplicateIds.add(chapter.id)
      } else {
        chapters.set(chapter.id, chapter)
      }
    }
    if (products.length < limit) break
  }

  if (retrieved < reportedTotal) {
    logger.debug("[shonenjumpplus] Chapter list appears incomplete", {
      aggregateId,
      expected: reportedTotal,
      retrieved,
    })
  }
  if (duplicateIds.size > 0) {
    logger.error(
      "[shonenjumpplus] Duplicate chapter ids detected in fetchChapterList",
      {
        aggregateId,
        duplicateChapterIds: [...duplicateIds],
      }
    )
  }

  return {
    chapters: [...chapters.values()],
    volumes: [],
    truncated: retrieved < reportedTotal,
  }
}
