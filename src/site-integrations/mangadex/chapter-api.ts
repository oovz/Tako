import type { ParseImageUrlsFromHtmlInput } from '../../types/site-integrations'
import logger from '@/src/runtime/logger'
import {
  buildMangadexUploadsRecoveryImageUrl,
  buildPageUrls,
  isSameMangadexBaseUrl,
  normalizeMangadexBaseUrl,
  parseMangadexImageDeliveryTarget,
  resolveMangadexImageUrlForQuality,
} from './image-delivery'
import {
  fetchAtHomeServer,
  fetchWithMangadexRetry,
  MANGADEX_IMAGE_RECOVERY_BACKOFF_MS,
  MANGADEX_IMAGE_RECOVERY_MAX_CYCLES,
  MANGADEX_NETWORK_REPORT,
  MANGADEX_NETWORK_REPORT_TIMEOUT_MS,
  MANGADEX_UPLOADS_BASE,
  parseChapterIdFromUrl,
} from './api'
import { getContextMangadexPreferences, resolveMangadexImageQuality } from './preferences'

type MangadexAtHomeReport = {
  url: string
  success: boolean
  bytes: number
  duration: number
  cached: boolean
}

const isMangadexImageNotFoundError = (error: unknown): boolean => {
  return error instanceof Error && error.message.startsWith('HTTP 404')
}

const waitForMangadexImageRecoveryWindow = async (signal?: AbortSignal): Promise<void> => {
  if (MANGADEX_IMAGE_RECOVERY_BACKOFF_MS <= 0) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, MANGADEX_IMAGE_RECOVERY_BACKOFF_MS)

    const onAbort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      reject(new Error('aborted'))
    }

    if (signal?.aborted) {
      onAbort()
      return
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const getContextChapterId = (context?: Record<string, unknown>): string | undefined => {
  return typeof context?.chapterId === 'string' && context.chapterId.length > 0
    ? context.chapterId
    : undefined
}

async function reportToMangadexNetwork(report: MangadexAtHomeReport): Promise<void> {
  if (report.url.includes('mangadex.org')) {
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MANGADEX_NETWORK_REPORT_TIMEOUT_MS)

  try {
    await fetch(MANGADEX_NETWORK_REPORT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      credentials: 'omit',
      signal: controller.signal,
    })
  } catch (error) {
    logger.debug('[mangadex] Failed to report to network (non-fatal):', error)
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchMangadexImageAsset(imageUrl: string, signal?: AbortSignal): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
  const startTime = Date.now()
  let success = false
  let bytes = 0
  let cached = false

  try {
    const response = await fetchWithMangadexRetry(imageUrl, {
      credentials: 'omit',
      signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    cached = response.headers.get('X-Cache')?.startsWith('HIT') ?? false
    const data = await response.arrayBuffer()
    bytes = data.byteLength
    success = true

    const mimeType = response.headers.get('content-type') || 'image/jpeg'
    const urlParts = new URL(imageUrl).pathname.split('/')
    const filename = urlParts[urlParts.length - 1] || 'image.jpg'

    logger.debug('[mangadex] Downloaded chapter image', {
      imageUrl,
      filename,
      mimeType,
      byteLength: bytes,
      cached,
    })

    return { data, filename, mimeType }
  } finally {
    const duration = Date.now() - startTime
    await reportToMangadexNetwork({ url: imageUrl, success, bytes, duration, cached })
  }
}

export async function resolveMangadexChapterImageUrls(
  chapter: { id: string; url: string },
  context?: Record<string, unknown>,
): Promise<string[]> {
  const chapterId = parseChapterIdFromUrl(chapter.url)
  const atHome = await fetchAtHomeServer(chapterId)
  const quality = await resolveMangadexImageQuality(context)
  const urls = buildPageUrls(atHome, quality)

  logger.debug('[mangadex] Resolved chapter image URLs from at-home server', {
    chapterId,
    chapterUrl: chapter.url,
    quality,
    urlCount: urls.length,
    preferencesSource: getContextMangadexPreferences(context) ? 'integrationContext' : 'inProcessCache',
  })

  if (urls.length === 0) {
    logger.error('[mangadex] No images returned by at-home endpoint', { chapterId, chapterUrl: chapter.url })
  }

  return urls
}

export async function parseMangadexImageUrlsFromHtml({ chapterUrl }: ParseImageUrlsFromHtmlInput): Promise<string[]> {
  const chapterId = parseChapterIdFromUrl(chapterUrl)
  const atHome = await fetchAtHomeServer(chapterId)

  const quality = await resolveMangadexImageQuality()
  const urls = buildPageUrls(atHome, quality)

  logger.debug('[mangadex] Resolved chapter image URLs from at-home server', {
    chapterId,
    chapterUrl,
    quality,
    urlCount: urls.length,
  })

  if (urls.length === 0) {
    logger.error('[mangadex] No images returned by at-home endpoint', { chapterId, chapterUrl })
  }

  return urls
}

export function processMangadexImageUrls(urls: string[]): Promise<string[]> {
  return Promise.resolve(urls.filter((url) => {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }))
}

export async function downloadMangadexChapterImage(
  imageUrl: string,
  opts?: { signal?: AbortSignal; context?: Record<string, unknown> },
): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
  if (opts?.signal?.aborted) {
    throw new Error('aborted')
  }

  logger.debug('[mangadex] Downloading chapter image', { imageUrl })
  try {
    return await fetchMangadexImageAsset(imageUrl, opts?.signal)
  } catch (error) {
    const chapterId = getContextChapterId(opts?.context)
    const deliveryTarget = parseMangadexImageDeliveryTarget(imageUrl)
    if (!chapterId || !deliveryTarget || opts?.signal?.aborted) {
      throw error
    }

    let lastRecoveryError: unknown = error
    let lastRecoveryUrl: string | undefined
    let failedOfficialBaseUrl = deliveryTarget.baseUrl

    for (let cycle = 1; cycle <= MANGADEX_IMAGE_RECOVERY_MAX_CYCLES; cycle++) {
      if (opts?.signal?.aborted) {
        throw new Error('aborted')
      }

      const refreshedAtHome = await fetchAtHomeServer(chapterId)
      const refreshedBaseUrl = normalizeMangadexBaseUrl(refreshedAtHome.baseUrl)
      const useUploadsFallback = isSameMangadexBaseUrl(refreshedBaseUrl, failedOfficialBaseUrl)
      const recoveryUrl = useUploadsFallback
        ? buildMangadexUploadsRecoveryImageUrl(MANGADEX_UPLOADS_BASE, refreshedAtHome, deliveryTarget)
        : resolveMangadexImageUrlForQuality(refreshedAtHome, deliveryTarget)

      logger.warn('[mangadex] Retrying image download with refreshed at-home candidate', {
        chapterId,
        imageUrl,
        cycle,
        refreshedBaseUrl,
        failedOfficialBaseUrl: normalizeMangadexBaseUrl(failedOfficialBaseUrl),
        useUploadsFallback,
        recoveryUrl,
      })

      lastRecoveryUrl = recoveryUrl
      try {
        return await fetchMangadexImageAsset(recoveryUrl, opts?.signal)
      } catch (recoveryError) {
        lastRecoveryError = recoveryError
      }

      if (!useUploadsFallback) {
        failedOfficialBaseUrl = refreshedAtHome.baseUrl
      }

      if (!isMangadexImageNotFoundError(lastRecoveryError) || cycle >= MANGADEX_IMAGE_RECOVERY_MAX_CYCLES) {
        break
      }

      await waitForMangadexImageRecoveryWindow(opts?.signal)
    }

    const lastRecoveryMessage = lastRecoveryError instanceof Error ? lastRecoveryError.message : String(lastRecoveryError)
    if (lastRecoveryUrl) {
      throw new Error(`${lastRecoveryMessage} (last recovery URL: ${lastRecoveryUrl}; recovery cycles: ${MANGADEX_IMAGE_RECOVERY_MAX_CYCLES})`)
    }

    throw error
  }
}
