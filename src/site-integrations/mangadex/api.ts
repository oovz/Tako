import { cancelResponseBody } from "@/src/shared/response-body"
import { z } from "zod"
import type { AtHomeResponse } from "./image-delivery"
import logger from "@/src/runtime/logger"
import { parseRateLimitRetryAfterHeader } from "@/src/shared/site-integration-utils"
import { integrationHttpClient } from "../http-client"
import { ProviderContractError } from "../provider-contract-error"
import { readResponseBytes } from "@/src/shared/html-response-decoder"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { waitForMangadexDelay } from "./api-delay"

export const MANGADEX_API_BASE = "https://api.mangadex.org"
export const MANGADEX_UPLOADS_BASE = "https://uploads.mangadex.org"
export const MANGADEX_NETWORK_REPORT = "https://api.mangadex.network/report"
export const MANGADEX_NETWORK_REPORT_TIMEOUT_MS = 1500
export const MANGADEX_IMAGE_RECOVERY_MAX_CYCLES = 5
export const MANGADEX_IMAGE_RECOVERY_BACKOFF_MS = 250
export const MANGADEX_SITE_BASE = "https://mangadex.org"

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

const MANGADEX_INTERACTIVE_RETRY_CONFIG: MangadexRetryConfig = {
  maxRetries: 0,
  defaultRetryDelayMs: 0,
  maxRetryDelayMs: 0,
}

export type MangadexRetryMode = "resilient" | "interactive"

function retryConfigForMode(mode: MangadexRetryMode): MangadexRetryConfig {
  return mode === "interactive"
    ? MANGADEX_INTERACTIVE_RETRY_CONFIG
    : MANGADEX_RETRY_CONFIG
}

const MANGADEX_TRANSIENT_HTTP_STATUSES = new Set([500, 502, 503, 504])

export type MangadexHttpError = Error & {
  status: number
}

export type MangadexStatisticsResponse = {
  statistics?: Record<
    string,
    {
      rating?: {
        average?: number
        bayesian?: number
      }
    }
  >
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
      translatedLanguage?: string
      pages?: number
      externalUrl?: string | null
    }
  }>
  total: number
  offset: number
  limit: number
}

const MangadexRelationshipSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const MangadexMangaResponseSchema = z
  .object({
    result: z.string(),
    data: z
      .object({
        id: z.string(),
        type: z.string(),
        attributes: z
          .object({
            title: z.record(z.string(), z.string()),
            altTitles: z.array(z.record(z.string(), z.string())).optional(),
            description: z.record(z.string(), z.string()).optional(),
            contentRating: z.string().optional(),
            originalLanguage: z.string().optional(),
            publicationDemographic: z.string().optional(),
            status: z.string().optional(),
            tags: z
              .array(
                z
                  .object({
                    attributes: z
                      .object({
                        name: z.record(z.string(), z.string()),
                      })
                      .passthrough(),
                  })
                  .passthrough()
              )
              .optional(),
            year: z.number().optional(),
          })
          .passthrough(),
        relationships: z.array(MangadexRelationshipSchema),
      })
      .passthrough(),
  })
  .passthrough()

const MangadexStatisticsResponseSchema = z
  .object({
    statistics: z
      .record(
        z.string(),
        z
          .object({
            rating: z
              .object({
                average: z.number().optional(),
                bayesian: z.number().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough()

const MangadexChapterFeedResponseSchema = z
  .object({
    result: z.string(),
    data: z.array(
      z
        .object({
          id: z.string(),
          type: z.string(),
          attributes: z
            .object({
              volume: z.string().nullable().optional(),
              chapter: z.string().nullable().optional(),
              title: z.string().nullable().optional(),
              translatedLanguage: z.string().optional(),
              pages: z.number().optional(),
              externalUrl: z.string().nullable().optional(),
            })
            .passthrough(),
        })
        .passthrough()
    ),
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
  })
  .passthrough()

const AtHomeResponseSchema = z
  .object({
    result: z.string().optional(),
    baseUrl: z.string(),
    chapter: z
      .object({
        hash: z.string(),
        data: z.array(z.string()).max(MAX_CHAPTER_IMAGES),
        dataSaver: z.array(z.string()).max(MAX_CHAPTER_IMAGES),
      })
      .passthrough(),
  })
  .passthrough()

const clampRetryDelay = (delayMs: number): number => {
  return Math.min(Math.max(delayMs, 100), MANGADEX_RETRY_CONFIG.maxRetryDelayMs)
}

const parseRetryAfterHeader = (response: Response): number | null => {
  return parseRateLimitRetryAfterHeader(response.headers, clampRetryDelay)
}

export function createMangadexHttpError(
  response: Response,
  message?: string
): MangadexHttpError {
  const error = new Error(
    message ?? `HTTP ${response.status}: ${response.statusText}`
  ) as MangadexHttpError
  error.status = response.status
  return error
}

/** Reject non-JSON responses and malformed JSON with a MangadexHttpError. */
async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers?.get("content-type")
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    cancelResponseBody(response)
    throw createMangadexHttpError(
      response,
      `MangaDex API returned non-JSON response (Content-Type: ${contentType}). The service may be blocking requests.`
    )
  }

  let bytes: Uint8Array
  try {
    bytes = await readResponseBytes(response)
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error
    }
    throw createMangadexHttpError(
      response,
      "Failed to parse MangaDex API response as JSON. The service may be unavailable or blocking requests."
    )
  }
}

/** Log schema details and throw a concise ProviderContractError. */
function throwSchemaValidationError(parsed: {
  success: false
  error: z.ZodError
}): never {
  logger.error(
    "[mangadex] API response schema validation failed",
    parsed.error.issues
  )
  throw new ProviderContractError(
    "MangaDex API returned an unexpected response structure. See console for details.",
    parsed.error
  )
}

export function isMangadexTransientHttpStatus(status: number): boolean {
  return MANGADEX_TRANSIENT_HTTP_STATUSES.has(status)
}

export function getMangadexHttpErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined
  const status = (error as Partial<MangadexHttpError>).status
  return typeof status === "number" ? status : undefined
}

const shouldRetryTransientResponse = (
  url: string,
  response: Response
): boolean => {
  if (!isMangadexTransientHttpStatus(response.status)) return false

  try {
    return new URL(url).hostname === new URL(MANGADEX_API_BASE).hostname
  } catch {
    return false
  }
}

type MangadexRequestAttempt = {
  url: string
  rateLimitService: RateLimitService
  options?: RequestInit
  retryCount: number
  retryConfig: MangadexRetryConfig
  endpointId: "mangadex-api" | "mangadex-at-home-image"
}

function isRetryableMangadexNetworkError(
  error: unknown,
  signal?: AbortSignal | null
): boolean {
  if (
    signal?.aborted ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return false
  }
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.name === "TypeError")
  )
}

async function retryMangadexRequest(
  attempt: MangadexRequestAttempt,
  delay: number,
  reason: string,
  response?: Response
): Promise<Response> {
  logger.warn(
    `[mangadex] ${reason}, retrying in ${delay}ms (attempt ${attempt.retryCount + 1}/${attempt.retryConfig.maxRetries})`
  )
  if (response) cancelResponseBody(response)
  await waitForMangadexDelay(delay, attempt.options?.signal)
  return fetchWithMangadexRetryUsingPolicy({
    ...attempt,
    retryCount: attempt.retryCount + 1,
  })
}

async function requestMangadexAttempt(
  attempt: MangadexRequestAttempt
): Promise<{ response: Response } | { networkRetry: true }> {
  const {
    endpointId,
    url,
    options,
    rateLimitService,
    retryCount,
    retryConfig,
  } = attempt
  try {
    const response = await integrationHttpClient.request({
      integrationId: "mangadex",
      endpointId,
      url,
      scope: endpointId === "mangadex-api" ? "chapter" : "image",
      init: options,
      skipRateLimit: endpointId === "mangadex-at-home-image",
      rateLimitService,
    })
    return { response }
  } catch (error) {
    if (
      retryCount >= retryConfig.maxRetries ||
      !isRetryableMangadexNetworkError(error, options?.signal)
    ) {
      throw error
    }
    return { networkRetry: true }
  }
}

async function fetchWithMangadexRetryUsingPolicy(
  attempt: MangadexRequestAttempt
): Promise<Response> {
  const outcome = await requestMangadexAttempt(attempt)
  if ("networkRetry" in outcome) {
    return retryMangadexRequest(
      attempt,
      attempt.retryConfig.defaultRetryDelayMs,
      "Network request failed"
    )
  }
  const { response } = outcome
  const shouldRetry =
    response.status === 429 ||
    shouldRetryTransientResponse(attempt.url, response)
  if (shouldRetry && attempt.retryCount < attempt.retryConfig.maxRetries) {
    const delay =
      parseRetryAfterHeader(response) ?? attempt.retryConfig.defaultRetryDelayMs
    return retryMangadexRequest(
      attempt,
      delay,
      `HTTP ${response.status}`,
      response
    )
  }
  return response
}

/**
 * Retry a dynamic MangaDex@Home asset request. These nodes are intentionally
 * not enumerated in the fixed manifest origin list, so they use a safe HTTPS
 * same-origin policy derived from the trusted at-home URL.
 */
export async function fetchWithMangadexRetry(
  url: string,
  rateLimitService: RateLimitService,
  options?: RequestInit,
  retryCount = 0
): Promise<Response> {
  return fetchWithMangadexRetryUsingPolicy({
    url,
    rateLimitService,
    options,
    retryCount,
    retryConfig: MANGADEX_RETRY_CONFIG,
    endpointId: "mangadex-at-home-image",
  })
}

/**
 * Apply chapter-scope API pacing and retries. Image requests use their
 * own scheduler and must not pass through this one.
 */
async function fetchMangadexApiResponse<T>(
  url: string,
  rateLimitService: RateLimitService,
  schema: z.ZodType<T>,
  retryMode: MangadexRetryMode,
  signal?: AbortSignal,
  rateLimitMessage?: string
): Promise<T> {
  const response = await fetchWithMangadexRetryUsingPolicy({
    url,
    rateLimitService,
    options: { credentials: "omit", signal },
    retryCount: 0,
    retryConfig: retryConfigForMode(retryMode),
    endpointId: "mangadex-api",
  })
  if (!response.ok) {
    cancelResponseBody(response)
    throw createMangadexHttpError(
      response,
      response.status === 429 ? rateLimitMessage : undefined
    )
  }
  const parsed = schema.safeParse(await parseJsonResponse(response))
  if (!parsed.success) throwSchemaValidationError(parsed)
  return parsed.data
}

export function parseUuidFromPath(
  pathname: string,
  prefix: string
): string | null {
  const segs = pathname.split("/").filter(Boolean)
  if (segs.length < 2) return null
  if (segs[0] !== prefix) return null
  const id = segs[1]
  return id &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      id
    )
    ? id
    : null
}

export function parseChapterIdFromUrl(chapterUrl: string): string {
  let url: URL
  try {
    url = new URL(chapterUrl)
  } catch {
    throw new Error(`Invalid MangaDex chapter URL (malformed): ${chapterUrl}`)
  }
  const id = parseUuidFromPath(url.pathname, "chapter")
  if (!id) {
    throw new Error(`Invalid MangaDex chapter URL: ${chapterUrl}`)
  }
  return id
}

export async function fetchMangaMetadata(
  mangaId: string,
  rateLimitService: RateLimitService,
  retryMode: MangadexRetryMode = "resilient",
  signal?: AbortSignal
): Promise<MangadexMangaResponse> {
  const url = `${MANGADEX_API_BASE}/manga/${mangaId}?includes[]=author&includes[]=artist&includes[]=cover_art`
  return fetchMangadexApiResponse(
    url,
    rateLimitService,
    MangadexMangaResponseSchema,
    retryMode,
    signal,
    "MangaDex rate limit exceeded. Please wait and try again."
  )
}

export async function fetchMangaStatistics(
  mangaId: string,
  rateLimitService: RateLimitService,
  retryMode: MangadexRetryMode = "resilient",
  signal?: AbortSignal
): Promise<MangadexStatisticsResponse> {
  const url = `${MANGADEX_API_BASE}/statistics/manga/${mangaId}`
  return fetchMangadexApiResponse(
    url,
    rateLimitService,
    MangadexStatisticsResponseSchema,
    retryMode,
    signal
  )
}

export function mapCommunityRatingToFiveScale(
  stats: MangadexStatisticsResponse,
  mangaId: string
): number | undefined {
  const bayesian = stats.statistics?.[mangaId]?.rating?.bayesian
  if (typeof bayesian !== "number" || Number.isNaN(bayesian)) {
    return undefined
  }

  return Math.max(0, Math.min(5, Number((bayesian / 2).toFixed(2))))
}

export async function fetchChapterFeed(
  mangaId: string,
  rateLimitService: RateLimitService,
  options: {
    languages?: string[]
    contentRatings?: string[]
  } = {},
  offset = 0,
  limit = 500,
  retryMode: MangadexRetryMode = "resilient",
  signal?: AbortSignal
): Promise<MangadexChapterFeedResponse> {
  const params = new URLSearchParams({
    "order[chapter]": "asc",
    "order[volume]": "asc",
    offset: String(offset),
    limit: String(limit),
  })

  for (const language of options.languages ?? []) {
    params.append("translatedLanguage[]", language)
  }

  for (const contentRating of options.contentRatings ?? []) {
    params.append("contentRating[]", contentRating)
  }

  const url = `${MANGADEX_API_BASE}/manga/${mangaId}/feed?${params}`
  return fetchMangadexApiResponse(
    url,
    rateLimitService,
    MangadexChapterFeedResponseSchema,
    retryMode,
    signal,
    "MangaDex rate limit exceeded. Please wait and try again."
  )
}

export async function fetchAtHomeServer(
  chapterId: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<AtHomeResponse> {
  const url = `${MANGADEX_API_BASE}/at-home/server/${chapterId}`
  return fetchMangadexApiResponse(
    url,
    rateLimitService,
    AtHomeResponseSchema,
    "resilient",
    signal,
    "MangaDex at-home rate limit exceeded (40/min). Please wait."
  )
}
