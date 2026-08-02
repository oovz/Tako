import { z } from "zod"
import type { AtHomeResponse } from "./image-delivery"
import logger from "@/src/runtime/logger"
import {
  allowsDeterministicE2eRedirect,
  shouldAcceptDeterministicE2eMockResponse,
} from "@/src/runtime/deterministic-e2e-redirect"
import { scheduleForIntegrationScope } from "@/src/runtime/rate-limit"
import { parseRateLimitRetryAfterHeader } from "@/src/shared/site-integration-utils"
import {
  assertIntegrationRequestUrl,
  assertIntegrationResponseUrl,
  createSameOriginDynamicAssetAssertion,
} from "../request-policy"
import { ProviderContractError } from "../provider-contract-error"
import { readResponseBytes } from "@/src/shared/html-response-decoder"

export const MANGADEX_API_BASE = "https://api.mangadex.org"
export const MANGADEX_UPLOADS_BASE = "https://uploads.mangadex.org"
export const MANGADEX_NETWORK_REPORT = "https://api.mangadex.network/report"
export const MANGADEX_NETWORK_REPORT_HOST = new URL(MANGADEX_NETWORK_REPORT)
  .hostname
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
        data: z.array(z.string()),
        dataSaver: z.array(z.string()),
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

const waitForRetryDelay = async (
  delayMs: number,
  signal?: AbortSignal | null
): Promise<void> => {
  if (delayMs <= 0) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)

    const onAbort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
      reject(new Error("aborted"))
    }

    if (signal?.aborted) {
      onAbort()
      return
    }

    signal?.addEventListener("abort", onAbort, { once: true })
  })
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

/**
 * Safely parse a response body as JSON, validating Content-Type first.
 *
 * Cloudflare challenges and proxy error pages can return HTML with HTTP 200,
 * causing `response.json()` to throw a raw `SyntaxError` whose message leaks
 * into the UI. This helper detects non-JSON responses and JSON parse failures,
 * throwing a descriptive {@link MangadexHttpError} instead.
 */
async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers?.get("content-type")
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    throw createMangadexHttpError(
      response,
      `MangaDex API returned non-JSON response (Content-Type: ${contentType}). The service may be blocking requests.`
    )
  }

  try {
    const bytes = await readResponseBytes(response)
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw createMangadexHttpError(
      response,
      "Failed to parse MangaDex API response as JSON. The service may be unavailable or blocking requests."
    )
  }
}

/**
 * Throw a concise {@link MangadexHttpError} for a Zod schema validation failure.
 *
 * Zod error messages can be extremely long (hundreds of fields), and dumping
 * the full error into the UI is unhelpful. The full error is logged to the
 * console for debugging; the user-facing error message is short.
 */
function throwSchemaValidationError(
  response: Response,
  parsed: { success: false; error: z.ZodError }
): never {
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

type MangadexRequestPolicy = {
  assertRequestUrl: (url: string) => void
  assertResponseUrl: (responseUrl: string) => void
}

function createDynamicMangadexAssetPolicy(
  initialUrl: string
): MangadexRequestPolicy {
  const assertUrlAllowed = createSameOriginDynamicAssetAssertion(
    initialUrl,
    "MangaDex@Home asset request"
  )
  return {
    assertRequestUrl: assertUrlAllowed,
    assertResponseUrl: assertUrlAllowed,
  }
}

function createMangadexApiRequestPolicy(
  requestUrl: string
): MangadexRequestPolicy {
  return {
    assertRequestUrl: (url) => {
      assertIntegrationRequestUrl("mangadex", url)
    },
    assertResponseUrl: (responseUrl) => {
      assertIntegrationResponseUrl("mangadex", requestUrl, responseUrl)
    },
  }
}

async function fetchWithMangadexRetryUsingPolicy(
  url: string,
  options?: RequestInit,
  retryCount = 0,
  requestPolicy: MangadexRequestPolicy = createDynamicMangadexAssetPolicy(url),
  retryConfig: MangadexRetryConfig = MANGADEX_RETRY_CONFIG
): Promise<Response> {
  let response: Response
  try {
    requestPolicy.assertRequestUrl(url)
    response = await fetch(url, {
      ...options,
      redirect: allowsDeterministicE2eRedirect ? "follow" : "error",
    })
    if (!shouldAcceptDeterministicE2eMockResponse(response.url)) {
      requestPolicy.assertResponseUrl(response.url || url)
    }
  } catch (error) {
    const isAbort =
      options?.signal?.aborted === true ||
      (error instanceof Error && error.name === "AbortError")
    const isTransientNetworkError =
      error instanceof TypeError ||
      (error instanceof Error && error.name === "TypeError")

    if (
      isAbort ||
      !isTransientNetworkError ||
      retryCount >= retryConfig.maxRetries
    ) {
      throw error
    }

    const retryDelay = retryConfig.defaultRetryDelayMs
    logger.warn(
      `[mangadex] Network request failed, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${retryConfig.maxRetries})`
    )
    await waitForRetryDelay(retryDelay, options?.signal)
    return fetchWithMangadexRetryUsingPolicy(
      url,
      options,
      retryCount + 1,
      requestPolicy,
      retryConfig
    )
  }
  const shouldRetryRateLimit = response.status === 429
  const shouldRetryTransient = shouldRetryTransientResponse(url, response)

  if (
    (shouldRetryRateLimit || shouldRetryTransient) &&
    retryCount < retryConfig.maxRetries
  ) {
    const retryDelay =
      parseRetryAfterHeader(response) ?? retryConfig.defaultRetryDelayMs
    logger.warn(
      `[mangadex] HTTP ${response.status}, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${retryConfig.maxRetries})`
    )
    await waitForRetryDelay(retryDelay, options?.signal)
    return fetchWithMangadexRetryUsingPolicy(
      url,
      options,
      retryCount + 1,
      requestPolicy,
      retryConfig
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
  options?: RequestInit,
  retryCount = 0
): Promise<Response> {
  return fetchWithMangadexRetryUsingPolicy(
    url,
    options,
    retryCount,
    createDynamicMangadexAssetPolicy(url)
  )
}

/**
 * Schedule a MangaDex API call through the chapter-scope rate limiter, then
 * run it through `fetchWithMangadexRetry` for 429/transient retry handling.
 *
 * Image downloads must NOT use this — they are already rate-limited at the
 * 'image' scope by `chapter-image-downloads.ts` via `scheduleForIntegrationScope`.
 * Using this for images would cause double rate-limiting.
 */
async function fetchMangadexApiWithRateLimit(
  url: string,
  options?: RequestInit,
  retryMode: MangadexRetryMode = "resilient"
): Promise<Response> {
  const requestPolicy = createMangadexApiRequestPolicy(url)
  requestPolicy.assertRequestUrl(url)
  return scheduleForIntegrationScope("mangadex", "chapter", () =>
    fetchWithMangadexRetryUsingPolicy(
      url,
      options,
      0,
      requestPolicy,
      retryConfigForMode(retryMode)
    )
  )
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
  retryMode: MangadexRetryMode = "resilient",
  signal?: AbortSignal
): Promise<MangadexMangaResponse> {
  const url = `${MANGADEX_API_BASE}/manga/${mangaId}?includes[]=author&includes[]=artist&includes[]=cover_art`
  const response = await fetchMangadexApiWithRateLimit(
    url,
    {
      credentials: "omit",
      signal,
    },
    retryMode
  )

  if (!response.ok) {
    if (response.status === 429) {
      throw createMangadexHttpError(
        response,
        "MangaDex rate limit exceeded. Please wait and try again."
      )
    }
    throw createMangadexHttpError(response)
  }

  const parsed = MangadexMangaResponseSchema.safeParse(
    await parseJsonResponse(response)
  )
  if (!parsed.success) {
    throwSchemaValidationError(response, parsed)
  }
  return parsed.data
}

export async function fetchMangaStatistics(
  mangaId: string,
  retryMode: MangadexRetryMode = "resilient",
  signal?: AbortSignal
): Promise<MangadexStatisticsResponse> {
  const url = `${MANGADEX_API_BASE}/statistics/manga/${mangaId}`
  const response = await fetchMangadexApiWithRateLimit(
    url,
    {
      credentials: "omit",
      signal,
    },
    retryMode
  )

  if (!response.ok) {
    throw createMangadexHttpError(response)
  }

  const parsed = MangadexStatisticsResponseSchema.safeParse(
    await parseJsonResponse(response)
  )
  if (!parsed.success) {
    throwSchemaValidationError(response, parsed)
  }
  return parsed.data
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
  const response = await fetchMangadexApiWithRateLimit(
    url,
    {
      credentials: "omit",
      signal,
    },
    retryMode
  )

  if (!response.ok) {
    if (response.status === 429) {
      throw createMangadexHttpError(
        response,
        "MangaDex rate limit exceeded. Please wait and try again."
      )
    }
    throw createMangadexHttpError(response)
  }

  const parsed = MangadexChapterFeedResponseSchema.safeParse(
    await parseJsonResponse(response)
  )
  if (!parsed.success) {
    throwSchemaValidationError(response, parsed)
  }
  return parsed.data
}

export async function fetchAtHomeServer(
  chapterId: string
): Promise<AtHomeResponse> {
  const url = `${MANGADEX_API_BASE}/at-home/server/${chapterId}`
  const response = await fetchMangadexApiWithRateLimit(url, {
    credentials: "omit",
  })

  if (!response.ok) {
    if (response.status === 429) {
      throw createMangadexHttpError(
        response,
        "MangaDex at-home rate limit exceeded (40/min). Please wait."
      )
    }
    throw createMangadexHttpError(response)
  }

  const parsed = AtHomeResponseSchema.safeParse(
    await parseJsonResponse(response)
  )
  if (!parsed.success) {
    throwSchemaValidationError(response, parsed)
  }
  return parsed.data
}
