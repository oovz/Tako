import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
  ParseImageUrlsFromHtmlInput,
} from '@/src/types/site-integrations'
import logger from '@/src/runtime/logger'
import {
  getRateLimitPolicyFromContext,
  getRateLimitPolicyFromSnapshot,
  rateLimitedFetchByUrlScope,
} from '@/src/runtime/rate-limit'
import { decodeHtmlResponse } from '@/src/shared/html-response-decoder'
import { extractImageUrlsFromEpisodeJsonScript } from './episode-json'
import { filterValidImageUrls, normalizeAllowedImageMimeType } from '@/src/shared/site-integration-utils'

const encodeSeed = (seed: number): string => {
  const seedText = String(seed)
  if (typeof btoa === 'function') {
    return btoa(seedText)
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(seedText, 'utf8').toString('base64')
  }

  return seedText
}

// Persist scramble seed in the URL so the queue can pass one opaque image token
// through storage/messages without introducing site-specific image metadata types.
const withSeedToken = (url: string, seed: number): string => {
  const parsed = new URL(url)
  parsed.searchParams.set('sjpSeed', encodeSeed(seed))
  return parsed.toString()
}

const decodeSeed = (encoded: string): number | undefined => {
  try {
    const decoded = typeof atob === 'function'
      ? atob(encoded)
      : typeof Buffer !== 'undefined'
        ? Buffer.from(encoded, 'base64').toString('utf8')
        : encoded

    const value = Number(decoded)
    if (!Number.isFinite(value)) {
      return undefined
    }
    return value >>> 0
  } catch {
    return undefined
  }
}

// Remove internal sjpSeed token before the network request; CDN URLs must remain
// byte-for-byte valid and only the downloader needs this seed for descrambling.
const parseSeedFromImageUrl = (imageUrl: string): { sourceUrl: string; seed?: number } => {
  const parsed = new URL(imageUrl)
  const encodedSeed = parsed.searchParams.get('sjpSeed')
  parsed.searchParams.delete('sjpSeed')

  return {
    sourceUrl: parsed.toString(),
    seed: encodedSeed ? decodeSeed(encodedSeed) : undefined,
  }
}

const buildGigaviewerPermutation = (): Array<{ source: { x: number; y: number }; dest: { x: number; y: number } }> => {
  const permutation: Array<{ source: { x: number; y: number }; dest: { x: number; y: number } }> = []

  for (let index = 0; index < 16; index += 1) {
    const sourceX = index % 4
    const sourceY = Math.floor(index / 4)

    // Matches the live Shonen Jump+ viewer implementation in chunk 202:
    // dest index = sourceX * 4 + sourceY (4x4 tile transposition).
    permutation.push({
      source: { x: sourceX, y: sourceY },
      dest: { x: sourceY, y: sourceX },
    })
  }

  return permutation
}

const isShonenJumpPlusPageImageUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'cdn-ak-img.shonenjumpplus.com' && parsed.pathname.includes('/public/page/')
  } catch {
    return false
  }
}

const normalizeMimeType = (mimeType: string): string => {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') {
    return mimeType
  }
  return 'image/png'
}

const GIGAVIEWER_DIVIDE_NUM = 4
const GIGAVIEWER_MULTIPLE = 8

const descrambleGigaviewerImage = async (buffer: ArrayBuffer, mimeType: string): Promise<ArrayBuffer> => {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return buffer
  }

  const blob = new Blob([buffer], { type: mimeType })
  const bitmap = await createImageBitmap(blob)

  try {
    const tileWidth = Math.floor(bitmap.width / (GIGAVIEWER_DIVIDE_NUM * GIGAVIEWER_MULTIPLE)) * GIGAVIEWER_MULTIPLE
    const tileHeight = Math.floor(bitmap.height / (GIGAVIEWER_DIVIDE_NUM * GIGAVIEWER_MULTIPLE)) * GIGAVIEWER_MULTIPLE
    if (tileWidth <= 0 || tileHeight <= 0) {
      return buffer
    }

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) {
      return buffer
    }

    context.imageSmoothingEnabled = false
    // Keep non-tiled edge regions exactly as the original viewer does.
    context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, bitmap.width, bitmap.height)

    const permutation = buildGigaviewerPermutation()
    for (const tile of permutation) {
      context.drawImage(
        bitmap,
        tile.source.x * tileWidth,
        tile.source.y * tileHeight,
        tileWidth,
        tileHeight,
        tile.dest.x * tileWidth,
        tile.dest.y * tileHeight,
        tileWidth,
        tileHeight,
      )
    }

    const finalMimeType = normalizeMimeType(mimeType)
    const outputBlob = await canvas.convertToBlob({
      type: finalMimeType,
      quality: finalMimeType === 'image/jpeg' ? 0.92 : undefined,
    })
    return await outputBlob.arrayBuffer()
  } finally {
    bitmap.close()
  }
}

function parseEpisodeId(pathname: string): string | null {
  const match = pathname.match(/^\/episode\/(\d+)/)
  return match ? match[1] : null
}

const offscreen: OffscreenIntegration = {
  name: 'Shonen Jump+ Offscreen',
  chapter: {
    async resolveImageUrls(chapter, _context, settingsSnapshot): Promise<string[]> {
      const episodeId = parseEpisodeId(new URL(chapter.url).pathname)
      if (!episodeId) {
        throw new Error(`Invalid Shonen Jump+ chapter URL: ${chapter.url}`)
      }

      const chapterResponse = await rateLimitedFetchByUrlScope(
        chapter.url,
        'chapter',
        undefined,
        getRateLimitPolicyFromSnapshot(settingsSnapshot, 'chapter'),
      )
      if (!chapterResponse.ok) {
        throw new Error(`HTTP ${chapterResponse.status}: ${chapterResponse.statusText}`)
      }

      const { html: chapterHtml } = await decodeHtmlResponse(chapterResponse)
      const htmlUrls = extractImageUrlsFromEpisodeJsonScript(chapterHtml, { applySeedToken: true, withSeedToken })
      logger.debug('[shonenjumpplus] Resolved image URLs via episode-json script', {
        chapterId: chapter.id,
        episodeId,
        urlCount: htmlUrls.length,
      })

      if (htmlUrls.length === 0) {
        logger.warn('[shonenjumpplus] episode-json script missing or empty in chapter HTML', { episodeId, chapterUrl: chapter.url })
      }

      return htmlUrls
    },

    parseImageUrlsFromHtml({ chapterHtml, chapterUrl }: ParseImageUrlsFromHtmlInput): Promise<string[]> {
      const episodeId = parseEpisodeId(new URL(chapterUrl).pathname)
      if (!episodeId) {
        throw new Error(`Invalid Shonen Jump+ chapter URL: ${chapterUrl}`)
      }

      const structuredUrls = extractImageUrlsFromEpisodeJsonScript(chapterHtml, { applySeedToken: true, withSeedToken })
      if (structuredUrls.length > 0) {
        return Promise.resolve(structuredUrls)
      }

      logger.warn('[shonenjumpplus] episode-json script missing or empty while parsing image URLs from HTML', { episodeId, chapterUrl })
      return Promise.resolve([])
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      return Promise.resolve(filterValidImageUrls(urls))
    },

    async downloadImage(imageUrl: string, opts?: { signal?: AbortSignal; context?: Record<string, unknown> }): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
      if (opts?.signal?.aborted) {
        throw new Error('aborted')
      }

      const { sourceUrl, seed } = parseSeedFromImageUrl(imageUrl)

      logger.debug('[shonenjumpplus] Downloading chapter image', {
        sourceUrl,
        hasSeed: typeof seed === 'number',
      })

      const response = await rateLimitedFetchByUrlScope(
        sourceUrl,
        'image',
        undefined,
        getRateLimitPolicyFromContext(opts?.context, 'image'),
      )
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const mimeType = normalizeAllowedImageMimeType(response.headers.get('content-type'))
      const rawData = await response.arrayBuffer()
      const shouldDescramble = typeof seed === 'number' || isShonenJumpPlusPageImageUrl(sourceUrl)
      const data = shouldDescramble
        ? await descrambleGigaviewerImage(rawData, mimeType)
        : rawData
      const filename = new URL(sourceUrl).pathname.split('/').filter(Boolean).pop() || 'image.jpg'

      logger.debug('[shonenjumpplus] Downloaded chapter image', {
        filename,
        mimeType,
        byteLength: data.byteLength,
        usedDescrambler: shouldDescramble,
      })

      return { data, filename, mimeType }
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  id: 'shonenjumpplus',
  offscreen,
}
