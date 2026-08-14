import logger from "@/src/runtime/logger"
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
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import { integrationHttpClient } from "../http-client"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"
import type { ChapterRuntimeData } from "@/src/types/site-integrations"
import type { MangadexDispatchContext } from "./contracts/dispatch-context"
import type { RateLimitService } from "@/src/runtime/rate-limit"

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

const getContextChapterId = (runtime: ChapterRuntimeData): string | undefined =>
  runtime.chapterId

async function reportToMangadexNetwork(
  report: MangadexAtHomeReport,
  rateLimitService: RateLimitService
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
    const response = await integrationHttpClient.request({
      integrationId: "mangadex",
      endpointId: "mangadex-network-report",
      url: MANGADEX_NETWORK_REPORT,
      scope: "chapter",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
        signal: controller.signal,
      },
      rateLimitService,
    })
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
  rateLimitService: RateLimitService,
  signal?: AbortSignal,
  onBytesReceived?: (bytesReceived: number) => void | Promise<void>,
  liveResourceLedger?: OffscreenLiveResourceLedger
): Promise<{
  data: ArrayBuffer
  filename: string
  mimeType: string
  liveResourceLease?: OffscreenLiveResourceLease
}> {
  const startTime = Date.now()
  let success = false
  let bytes = 0
  let cached = false
  try {
    const { data, mimeType, liveResourceLease } =
      await fetchImageWithStallDetection(imageUrl, {
        integrationId: "mangadex",
        endpointId: "mangadex-at-home-image",
        rateLimitService,
        signal,
        init: {
          credentials: "omit",
        },
        fetcher: (url, init) =>
          fetchWithMangadexRetry(url, rateLimitService, init, 0),
        createHttpError: createMangadexHttpError,
        onResponse: (response) => {
          cached = response.headers.get("X-Cache")?.startsWith("HIT") ?? false
        },
        onBytesReceived,
        liveResourceLedger,
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

    return { data, filename, mimeType, liveResourceLease }
  } finally {
    const duration = Date.now() - startTime
    void reportToMangadexNetwork(
      {
        url: imageUrl,
        success,
        bytes,
        duration,
        cached,
      },
      rateLimitService
    )
  }
}

export async function resolveMangadexChapterImageUrls(
  chapter: { id: string; url: string },
  rateLimitService: RateLimitService,
  context?: MangadexDispatchContext,
  signal?: AbortSignal
): Promise<string[]> {
  const chapterId = parseChapterIdFromUrl(chapter.url)
  const atHome = await fetchAtHomeServer(chapterId, rateLimitService, signal)
  const quality = resolveMangadexImageQuality(context)
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

export async function downloadMangadexChapterImage(
  imageUrl: string,
  opts: {
    signal?: AbortSignal
    dispatchContext?: MangadexDispatchContext
    runtime: ChapterRuntimeData
    onBytesReceived?: (bytesReceived: number) => void | Promise<void>
    liveResourceLedger?: OffscreenLiveResourceLedger
  }
): Promise<{
  data: ArrayBuffer
  filename: string
  mimeType: string
  liveResourceLease?: OffscreenLiveResourceLease
}> {
  if (opts.signal?.aborted) {
    throw new Error("aborted")
  }

  logger.debug("[mangadex] Downloading chapter image", {
    imageUrl: summarizeUrlForDiagnostics(imageUrl),
  })
  try {
    return await fetchMangadexImageAsset(
      imageUrl,
      opts.runtime.rateLimitService,
      opts.signal,
      opts.onBytesReceived,
      opts.liveResourceLedger
    )
  } catch (error) {
    const chapterId = getContextChapterId(opts.runtime)
    const deliveryTarget = parseMangadexImageDeliveryTarget(imageUrl)
    if (
      !chapterId ||
      !deliveryTarget ||
      opts.signal?.aborted ||
      !isMangadexImageRecoveryRetryableError(error)
    ) {
      throw error
    }

    let lastRecoveryError: unknown = error
    let lastRecoveryUrl: string | undefined
    let failedOfficialBaseUrl = deliveryTarget.baseUrl

    for (let cycle = 1; cycle <= MANGADEX_IMAGE_RECOVERY_MAX_CYCLES; cycle++) {
      if (opts.signal?.aborted) {
        throw new Error("aborted", { cause: error })
      }

      const refreshedAtHome = await fetchAtHomeServer(
        chapterId,
        opts.runtime.rateLimitService,
        opts.signal
      )
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
          opts.runtime.rateLimitService,
          opts.signal,
          opts.onBytesReceived,
          opts.liveResourceLedger
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

      await waitForMangadexImageRecoveryWindow(opts.signal)
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

export async function downloadMangadexCoverImage(
  imageUrl: string,
  opts: {
    signal?: AbortSignal
    dispatchContext?: MangadexDispatchContext
    runtime: ChapterRuntimeData
    skipRateLimit?: boolean
    onBytesReceived?: (bytesReceived: number) => void | Promise<void>
    liveResourceLedger?: OffscreenLiveResourceLedger
  }
): Promise<{
  data: ArrayBuffer
  filename: string
  mimeType: string
  liveResourceLease?: OffscreenLiveResourceLease
}> {
  const { data, mimeType, liveResourceLease } =
    await fetchImageWithStallDetection(imageUrl, {
      signal: opts.signal,
      init: { credentials: "omit" },
      integrationId: "mangadex",
      endpointId: "mangadex-at-home-image",
      rateLimitService: opts.runtime.rateLimitService,
      onBytesReceived: opts.onBytesReceived,
      liveResourceLedger: opts.liveResourceLedger,
    })
  return {
    data,
    mimeType,
    liveResourceLease,
    filename:
      new URL(imageUrl).pathname.split("/").filter(Boolean).pop() ||
      "cover.jpg",
  }
}
