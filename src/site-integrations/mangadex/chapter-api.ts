import type { ParseImageUrlsFromHtmlInput } from "../../types/site-integrations"
import logger from "@/src/runtime/logger"
import {
  allowsDeterministicE2eRedirect,
  shouldAcceptDeterministicE2eMockResponse,
} from "@/src/runtime/deterministic-e2e-redirect"
import {
  buildMangadexUploadsRecoveryImageUrl,
  buildPageUrls,
  isSameMangadexBaseUrl,
  normalizeMangadexBaseUrl,
  parseMangadexImageDeliveryTarget,
  resolveMangadexImageUrlForQuality,
} from "./image-delivery"
import {
  fetchAtHomeServer,
  fetchWithMangadexRetry,
  MANGADEX_IMAGE_RECOVERY_BACKOFF_MS,
  MANGADEX_IMAGE_RECOVERY_MAX_CYCLES,
  MANGADEX_NETWORK_REPORT,
  MANGADEX_NETWORK_REPORT_TIMEOUT_MS,
  MANGADEX_UPLOADS_BASE,
  createMangadexHttpError,
  parseChapterIdFromUrl,
  getMangadexHttpErrorStatus,
  isMangadexTransientHttpStatus,
} from "./api"
import {
  getContextMangadexPreferences,
  resolveMangadexImageQuality,
} from "./preferences"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image-core"
import { filterValidImageUrls } from "@/src/shared/site-integration-utils"
import {
  assertIntegrationRequestUrl,
  assertIntegrationResponseUrl,
  createSameOriginDynamicAssetAssertion,
} from "../request-policy"

type MangadexAtHomeReport = {
  url: string
  success: boolean
  bytes: number
  duration: number
  cached: boolean
}

function summarizeUrlForDiagnostics(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return "[invalid URL]"
  }
}

const isMangadexImageRecoveryRetryableError = (error: unknown): boolean => {
  const status = getMangadexHttpErrorStatus(error)
  return (
    status === 404 ||
    (typeof status === "number" && isMangadexTransientHttpStatus(status))
  )
}

const waitForMangadexImageRecoveryWindow = async (
  signal?: AbortSignal
): Promise<void> => {
  if (MANGADEX_IMAGE_RECOVERY_BACKOFF_MS <= 0) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, MANGADEX_IMAGE_RECOVERY_BACKOFF_MS)

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

const getContextChapterId = (
  context?: Record<string, unknown>
): string | undefined => {
  return typeof context?.chapterId === "string" && context.chapterId.length > 0
    ? context.chapterId
    : undefined
}

async function reportToMangadexNetwork(
  report: MangadexAtHomeReport
): Promise<void> {
  let reportHost: string
  try {
    reportHost = new URL(report.url).hostname
  } catch {
    logger.debug("[mangadex] Skipping network report for malformed image URL")
    return
  }

  if (reportHost === new URL(MANGADEX_UPLOADS_BASE).hostname) {
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    MANGADEX_NETWORK_REPORT_TIMEOUT_MS
  )

  try {
    assertIntegrationRequestUrl("mangadex", MANGADEX_NETWORK_REPORT)
    const response = await fetch(MANGADEX_NETWORK_REPORT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      credentials: "omit",
      redirect: allowsDeterministicE2eRedirect ? "follow" : "error",
      signal: controller.signal,
    })
    if (!shouldAcceptDeterministicE2eMockResponse(response.url)) {
      assertIntegrationResponseUrl(
        "mangadex",
        MANGADEX_NETWORK_REPORT,
        response.url
      )
    }
    if (!response.ok) {
      logger.debug(
        `[mangadex] Network report rejected with HTTP ${response.status}`
      )
    }
  } catch (error) {
    logger.debug("[mangadex] Failed to report to network (non-fatal):", error)
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchMangadexImageAsset(
  imageUrl: string,
  signal?: AbortSignal,
  onBytesReceived?: (bytesReceived: number) => void | Promise<void>
): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
  const startTime = Date.now()
  let success = false
  let bytes = 0
  let cached = false
  const assertImageUrlAllowed = createSameOriginDynamicAssetAssertion(
    imageUrl,
    "MangaDex@Home image request"
  )

  try {
    const { data, mimeType } = await fetchImageWithStallDetection(imageUrl, {
      signal,
      init: {
        credentials: "omit",
      },
      fetcher: (url, init) => fetchWithMangadexRetry(url, init),
      createHttpError: createMangadexHttpError,
      assertUrlAllowed: assertImageUrlAllowed,
      onResponse: (response) => {
        cached = response.headers.get("X-Cache")?.startsWith("HIT") ?? false
      },
      onBytesReceived,
    })

    bytes = data.byteLength
    success = true

    const urlParts = new URL(imageUrl).pathname.split("/")
    const filename = urlParts[urlParts.length - 1] || "image.jpg"

    logger.debug("[mangadex] Downloaded chapter image", {
      imageUrl: summarizeUrlForDiagnostics(imageUrl),
      filename,
      mimeType,
      byteLength: bytes,
      cached,
    })

    return { data, filename, mimeType }
  } finally {
    const duration = Date.now() - startTime
    void reportToMangadexNetwork({
      url: imageUrl,
      success,
      bytes,
      duration,
      cached,
    })
  }
}

export async function resolveMangadexChapterImageUrls(
  chapter: { id: string; url: string },
  context?: Record<string, unknown>
): Promise<string[]> {
  const chapterId = parseChapterIdFromUrl(chapter.url)
  const atHome = await fetchAtHomeServer(chapterId)
  const quality = await resolveMangadexImageQuality(context)
  const urls = buildPageUrls(atHome, quality)

  logger.debug("[mangadex] Resolved chapter image URLs from at-home server", {
    chapterId,
    chapterUrl: summarizeUrlForDiagnostics(chapter.url),
    quality,
    urlCount: urls.length,
    preferencesSource: getContextMangadexPreferences(context)
      ? "integrationContext"
      : "inProcessCache",
  })

  if (urls.length === 0) {
    logger.error("[mangadex] No images returned by at-home endpoint", {
      chapterId,
      chapterUrl: summarizeUrlForDiagnostics(chapter.url),
    })
  }

  return urls
}

export async function parseMangadexImageUrlsFromHtml({
  chapterUrl,
}: ParseImageUrlsFromHtmlInput): Promise<string[]> {
  const chapterId = parseChapterIdFromUrl(chapterUrl)
  const atHome = await fetchAtHomeServer(chapterId)

  const quality = await resolveMangadexImageQuality()
  const urls = buildPageUrls(atHome, quality)

  logger.debug("[mangadex] Resolved chapter image URLs from at-home server", {
    chapterId,
    chapterUrl: summarizeUrlForDiagnostics(chapterUrl),
    quality,
    urlCount: urls.length,
  })

  if (urls.length === 0) {
    logger.error("[mangadex] No images returned by at-home endpoint", {
      chapterId,
      chapterUrl: summarizeUrlForDiagnostics(chapterUrl),
    })
  }

  return urls
}

export function processMangadexImageUrls(urls: string[]): Promise<string[]> {
  return Promise.resolve(filterValidImageUrls(urls))
}

export async function downloadMangadexChapterImage(
  imageUrl: string,
  opts?: {
    signal?: AbortSignal
    context?: Record<string, unknown>
    onBytesReceived?: (bytesReceived: number) => void | Promise<void>
  }
): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
  if (opts?.signal?.aborted) {
    throw new Error("aborted")
  }

  logger.debug("[mangadex] Downloading chapter image", {
    imageUrl: summarizeUrlForDiagnostics(imageUrl),
  })
  try {
    return await fetchMangadexImageAsset(
      imageUrl,
      opts?.signal,
      opts?.onBytesReceived
    )
  } catch (error) {
    const chapterId = getContextChapterId(opts?.context)
    const deliveryTarget = parseMangadexImageDeliveryTarget(imageUrl)
    if (
      !chapterId ||
      !deliveryTarget ||
      opts?.signal?.aborted ||
      !isMangadexImageRecoveryRetryableError(error)
    ) {
      throw error
    }

    let lastRecoveryError: unknown = error
    let lastRecoveryUrl: string | undefined
    let failedOfficialBaseUrl = deliveryTarget.baseUrl

    for (let cycle = 1; cycle <= MANGADEX_IMAGE_RECOVERY_MAX_CYCLES; cycle++) {
      if (opts?.signal?.aborted) {
        throw new Error("aborted", { cause: error })
      }

      const refreshedAtHome = await fetchAtHomeServer(chapterId)
      const refreshedBaseUrl = normalizeMangadexBaseUrl(refreshedAtHome.baseUrl)
      const useUploadsFallback = isSameMangadexBaseUrl(
        refreshedBaseUrl,
        failedOfficialBaseUrl
      )
      const recoveryUrl = useUploadsFallback
        ? buildMangadexUploadsRecoveryImageUrl(
            MANGADEX_UPLOADS_BASE,
            refreshedAtHome,
            deliveryTarget
          )
        : resolveMangadexImageUrlForQuality(refreshedAtHome, deliveryTarget)

      logger.warn(
        "[mangadex] Retrying image download with refreshed at-home candidate",
        {
          chapterId,
          imageUrl: summarizeUrlForDiagnostics(imageUrl),
          cycle,
          refreshedBaseUrl,
          failedOfficialBaseUrl: normalizeMangadexBaseUrl(
            failedOfficialBaseUrl
          ),
          useUploadsFallback,
          recoveryUrl: summarizeUrlForDiagnostics(recoveryUrl),
        }
      )

      lastRecoveryUrl = recoveryUrl
      try {
        return await fetchMangadexImageAsset(
          recoveryUrl,
          opts?.signal,
          opts?.onBytesReceived
        )
      } catch (recoveryError) {
        lastRecoveryError = recoveryError
      }

      if (!useUploadsFallback) {
        failedOfficialBaseUrl = refreshedAtHome.baseUrl
      }

      if (
        !isMangadexImageRecoveryRetryableError(lastRecoveryError) ||
        cycle >= MANGADEX_IMAGE_RECOVERY_MAX_CYCLES
      ) {
        break
      }

      await waitForMangadexImageRecoveryWindow(opts?.signal)
    }

    const lastRecoveryMessage =
      lastRecoveryError instanceof Error
        ? lastRecoveryError.message
        : String(lastRecoveryError)
    if (lastRecoveryUrl) {
      throw new Error(
        `${lastRecoveryMessage} (recovery cycles: ${MANGADEX_IMAGE_RECOVERY_MAX_CYCLES})`,
        { cause: error }
      )
    }

    throw error
  }
}
