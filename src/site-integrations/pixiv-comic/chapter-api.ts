import type { ParseImageUrlsFromHtmlInput } from '../../types/site-integrations'
import logger from '@/src/runtime/logger'
import { rateLimitedFetchByUrlScope } from '@/src/runtime/rate-limit'
import { decodeHtmlResponse } from '@/src/shared/html-response-decoder'
import { filterValidImageUrls } from '@/src/shared/site-integration-utils'
import { descramblePixivImage } from './descrambler'
import { parseEpisodeIdFromUrl } from './page-context'
import {
  PIXIV_BASE_URL,
  PIXIV_EPISODES_API_URL,
  PIXIV_GRIDSHUFFLE_HEADER,
  PIXIV_IMAGE_REFERRER,
  PIXIV_KEY_FRAGMENT_PARAM,
  pixivBuildIdCacheByTask,
  resolvePixivCookieHeader,
  type PixivReadV4Page,
  type PixivResolveContext,
} from './shared'

const toHex = (bytes: Uint8Array): string => bytes.reduce((acc, value) => acc + value.toString(16).padStart(2, '0'), '')

const encodeBase64Url = (value: string): string => {
  if (typeof btoa === 'function') {
    return btoa(value)
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64')
  }

  return value
}

const decodeBase64Url = (value: string): string => {
  if (!value) return ''

  if (typeof atob === 'function') {
    return atob(value)
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64').toString('utf8')
  }

  return value
}

const withChapterToken = (sourceUrl: string, key?: string): string => {
  if (!key) {
    return sourceUrl
  }

  const separator = sourceUrl.includes('#') ? '&' : '#'
  return `${sourceUrl}${separator}${PIXIV_KEY_FRAGMENT_PARAM}=${encodeURIComponent(encodeBase64Url(key))}`
}

const extractPixivKey = (imageUrl: string): string | undefined => {
  const hashIndex = imageUrl.indexOf('#')
  if (hashIndex === -1) {
    return undefined
  }

  const hash = imageUrl.slice(hashIndex + 1)
  const params = new URLSearchParams(hash)
  const encoded = params.get(PIXIV_KEY_FRAGMENT_PARAM)
  if (!encoded) {
    return undefined
  }

  return decodeBase64Url(encoded)
}

const stripPixivTransportMetadata = (imageUrl: string): string => {
  const hashIndex = imageUrl.indexOf('#')
  return hashIndex === -1 ? imageUrl : imageUrl.slice(0, hashIndex)
}

const parseBuildId = (homepageHtml: string): string => {
  const buildMatch = homepageHtml.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/)
  if (!buildMatch?.[1]) {
    throw new Error('Pixiv Comic API may have changed (build ID missing)')
  }
  return buildMatch[1]
}

const createPixivHeaders = (timestamp: string, cookieHeader?: string): HeadersInit => {
  const headers: Record<string, string> = {
    'x-referer': PIXIV_BASE_URL,
    'x-requested-with': 'pixivcomic',
    'x-client-time': timestamp,
    'x-client-hash': '',
  }

  if (cookieHeader) {
    headers.cookie = cookieHeader
  }

  return headers
}

const computeClientHash = async (timestamp: string, salt: string): Promise<string> => {
  const payload = `${timestamp}${salt}`
  if (!globalThis.crypto?.subtle) {
    return payload
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return toHex(new Uint8Array(digest))
}

const parseStoryId = (chapter: { id: string; url: string }): string => {
  if (chapter.id && /^\d+$/.test(chapter.id)) {
    return chapter.id
  }

  const parsedFromUrl = parseEpisodeIdFromUrl(chapter.url)
  if (parsedFromUrl) {
    return parsedFromUrl
  }

  throw new Error(`Unable to resolve Pixiv Comic story id from chapter: ${chapter.url}`)
}

async function fetchPixivBuildId(cookieHeader?: string): Promise<string> {
  logger.debug('[pixiv-comic] Fetching homepage to resolve Next.js build ID', {
    hasCookieHeader: Boolean(cookieHeader),
  })
  const response = await rateLimitedFetchByUrlScope(`${PIXIV_BASE_URL}/`, 'chapter', {
    credentials: 'include',
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Pixiv homepage: HTTP ${response.status}`)
  }

  const { html } = await decodeHtmlResponse(response)
  const buildId = parseBuildId(html)
  logger.debug('[pixiv-comic] Resolved Next.js build ID from homepage', { buildId })
  return buildId
}

async function fetchPixivSalt(
  storyId: string,
  buildId: string,
  cookieHeader?: string,
): Promise<{ salt: string; pages: PixivReadV4Page[] }> {
  const saltUrl = `${PIXIV_BASE_URL}/_next/data/${buildId}/viewer/stories/${storyId}.json?id=${storyId}`
  const response = await rateLimitedFetchByUrlScope(saltUrl, 'chapter', {
    credentials: 'include',
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  })

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as Error & { status?: number }
    error.status = response.status
    throw error
  }

  const payload = (await response.json()) as {
    pageProps?: {
      salt?: string
      story?: {
        reading_episode?: {
          pages?: PixivReadV4Page[]
        }
      }
    }
  }

  const salt = payload.pageProps?.salt
  const pages = payload.pageProps?.story?.reading_episode?.pages ?? []

  if (!salt) {
    throw new Error('Pixiv Comic API may have changed (salt not found)')
  }

  return { salt, pages }
}

async function resolvePixivReadPages(
  chapter: { id: string; url: string },
  context?: PixivResolveContext,
): Promise<PixivReadV4Page[]> {
  const storyId = parseStoryId(chapter)
  const taskId = context?.taskId

  let buildId = taskId ? pixivBuildIdCacheByTask.get(taskId) : undefined
  logger.debug('[pixiv-comic] Resolving read pages', {
    chapterId: chapter.id,
    storyId,
    taskId,
    buildIdCacheHit: Boolean(buildId),
  })
  if (!buildId) {
    buildId = await fetchPixivBuildId(context?.cookieHeader)
    if (taskId) {
      pixivBuildIdCacheByTask.set(taskId, buildId)
    }
  }

  let saltResult: { salt: string; pages: PixivReadV4Page[] }
  try {
    saltResult = await fetchPixivSalt(storyId, buildId, context?.cookieHeader)
  } catch (error) {
    const statusCode = (error as { status?: number })?.status
    if (statusCode !== 404) {
      throw error
    }

    logger.debug('[pixiv-comic] Build ID likely stale after salt fetch 404, refreshing build ID', {
      chapterId: chapter.id,
      storyId,
      previousBuildId: buildId,
    })

    const refreshedBuildId = await fetchPixivBuildId(context?.cookieHeader)
    if (taskId) {
      pixivBuildIdCacheByTask.set(taskId, refreshedBuildId)
    }

    try {
      saltResult = await fetchPixivSalt(storyId, refreshedBuildId, context?.cookieHeader)
    } catch {
      throw new Error('Pixiv Comic API may have changed (build ID stale)')
    }
  }

  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const clientHash = await computeClientHash(timestamp, saltResult.salt)
  const headers = createPixivHeaders(timestamp, context?.cookieHeader) as Record<string, string>
  headers['x-client-hash'] = clientHash

  const response = await rateLimitedFetchByUrlScope(`${PIXIV_EPISODES_API_URL}/${storyId}/read_v4`, 'chapter', {
    credentials: 'include',
    headers,
  })

  if (!response.ok) {
    throw new Error(`Pixiv Comic read_v4 failed: HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    pages?: PixivReadV4Page[]
    reading_episode?: {
      pages?: PixivReadV4Page[]
    }
    data?: {
      pages?: PixivReadV4Page[]
      reading_episode?: {
        pages?: PixivReadV4Page[]
      }
    }
  }

  const pages = payload.pages
    ?? payload.reading_episode?.pages
    ?? payload.data?.pages
    ?? payload.data?.reading_episode?.pages
    ?? saltResult.pages
  logger.debug('[pixiv-comic] Resolved read pages from Pixiv API', {
    chapterId: chapter.id,
    storyId,
    pageCount: pages.length,
  })
  return pages
}

export async function preparePixivDispatchContext(): Promise<Record<string, unknown> | undefined> {
  if (!chrome.cookies?.getAll) {
    return undefined
  }

  try {
    const cookies = await chrome.cookies.getAll({ domain: '.pixiv.net' })
    if (cookies.length === 0) {
      return undefined
    }

    return {
      cookieHeader: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
    }
  } catch (error) {
    logger.debug('[pixiv-comic] Failed to read cookies for dispatch context (non-fatal):', error)
    return undefined
  }
}

export async function resolvePixivChapterImageUrls(
  chapter: { id: string; url: string },
  context?: PixivResolveContext,
): Promise<string[]> {
  const pages = await resolvePixivReadPages(chapter, context)
  const urls = pages
    .map((page) => {
      const sourceUrl = page.url ?? page.src ?? page.image_url
      if (!sourceUrl) {
        return null
      }
      return withChapterToken(sourceUrl, page.key)
    })
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  if (urls.length === 0) {
    throw new Error('Pixiv Comic API may have changed (no image URLs found)')
  }

  logger.debug('[pixiv-comic] Resolved image URLs for chapter', {
    chapterId: chapter.id,
    urlCount: urls.length,
  })

  return urls
}

export function parsePixivImageUrlsFromHtml({ chapterHtml }: ParseImageUrlsFromHtmlInput): Promise<string[]> {
  const imageUrls = Array.from(
    chapterHtml.matchAll(/https?:\/\/[^"'\s>]+\.(?:jpg|jpeg|png|webp)/gi),
    (match) => match[0],
  )

  if (imageUrls.length === 0) {
    logger.debug('[pixiv-comic] No image URLs found in chapter HTML fallback parser')
  }

  return Promise.resolve(imageUrls)
}

export function processPixivImageUrls(urls: string[]): Promise<string[]> {
  return Promise.resolve(filterValidImageUrls(urls))
}

export async function downloadPixivChapterImage(
  imageUrl: string,
  opts?: { signal?: AbortSignal; context?: Record<string, unknown> },
): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
  if (opts?.signal?.aborted) {
    throw new Error('aborted')
  }

  const sourceImageUrl = stripPixivTransportMetadata(imageUrl)
  const pixivKey = extractPixivKey(imageUrl)
  const cookieHeader = resolvePixivCookieHeader(opts?.context)

  logger.debug('[pixiv-comic] Downloading chapter image', {
    sourceImageUrl,
    hasPixivKey: Boolean(pixivKey),
    hasCookieHeader: Boolean(cookieHeader),
    preservedSignedQuery: sourceImageUrl.includes('?') && !sourceImageUrl.includes('?='),
  })

  const requestHeaders: Record<string, string> = {
    referer: PIXIV_IMAGE_REFERRER,
  }

  if (pixivKey) {
    requestHeaders[PIXIV_GRIDSHUFFLE_HEADER] = pixivKey
  }

  const response = await rateLimitedFetchByUrlScope(sourceImageUrl, 'image', {
    credentials: 'include',
    headers: requestHeaders,
    referrer: PIXIV_IMAGE_REFERRER,
    referrerPolicy: 'strict-origin-when-cross-origin',
    signal: opts?.signal,
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const rawData = await response.arrayBuffer()
  const mimeType = response.headers.get('content-type') || 'image/jpeg'
  const data = pixivKey
    ? await descramblePixivImage(rawData, mimeType, pixivKey, sourceImageUrl)
    : rawData
  const filename = new URL(sourceImageUrl).pathname.split('/').filter(Boolean).pop() || 'image.jpg'

  logger.debug('[pixiv-comic] Downloaded chapter image', {
    filename,
    mimeType,
    byteLength: data.byteLength,
    usedDescrambler: Boolean(pixivKey),
  })

  return { data, filename, mimeType }
}
