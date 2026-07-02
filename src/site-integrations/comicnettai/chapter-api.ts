import {
  getRateLimitPolicyFromContext,
  getRateLimitPolicyFromSnapshot,
  rateLimitedFetchByUrlScope,
} from '@/src/runtime/rate-limit'
import { fetchImageWithStallDetection } from '@/src/runtime/fetch-image'
import { filterValidImageUrls } from '@/src/shared/site-integration-utils'
import type { TaskSettingsSnapshot } from '@/src/types/state-snapshots'
import { buildComicNettaiViewerApiUrl } from './shared'
import { buildPublusImageUrlsFromConfig, decodePublusConfigurationPack, type PublusConfig } from './publus-config'
import { descramblePublusImage, parsePublusImageTransportUrl } from './publus-image'

export { buildPublusImageUrlsFromConfig } from './publus-config'

type ComicNettaiViewerContentResponse = {
  status?: string | number
  url?: string
  cti?: string
}

function assertViewerContentResponse(value: ComicNettaiViewerContentResponse, chapterUrl: string): string {
  if (String(value.status) !== '200' || typeof value.url !== 'string' || value.url.length === 0) {
    throw new Error(`Comic Nettai viewer content check failed for ${chapterUrl}: status ${value.status ?? 'missing'}`)
  }

  return value.url
}

async function fetchJson(url: string, settingsSnapshot?: Partial<TaskSettingsSnapshot>): Promise<unknown> {
  const response = await rateLimitedFetchByUrlScope(
    url,
    'chapter',
    {
      headers: {
        accept: 'application/json,*/*',
      },
    },
    getRateLimitPolicyFromSnapshot(settingsSnapshot, 'chapter'),
  )
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json()
}

export async function resolveComicNettaiChapterImageUrls(
  chapter: { id: string; url: string },
  settingsSnapshot?: Partial<TaskSettingsSnapshot>,
): Promise<string[]> {
  const contentCheckUrl = buildComicNettaiViewerApiUrl(chapter.url)
  const contentPayload = await fetchJson(contentCheckUrl, settingsSnapshot) as ComicNettaiViewerContentResponse
  const contentBaseUrl = assertViewerContentResponse(contentPayload, chapter.url)

  const configUrl = new URL('configuration_pack.json', contentBaseUrl).toString()
  const configResponse = await rateLimitedFetchByUrlScope(
    configUrl,
    'chapter',
    {
      headers: {
        accept: 'application/json,*/*',
      },
    },
    getRateLimitPolicyFromSnapshot(settingsSnapshot, 'chapter'),
  )
  if (!configResponse.ok) {
    throw new Error(`HTTP ${configResponse.status}: ${configResponse.statusText}`)
  }

  const rawConfig = await configResponse.text()
  const config: PublusConfig = decodePublusConfigurationPack(rawConfig)
  return buildPublusImageUrlsFromConfig(contentBaseUrl, config)
}

export function parseComicNettaiImageUrlsFromHtml(): Promise<string[]> {
  return Promise.resolve([])
}

export function processComicNettaiImageUrls(urls: string[]): Promise<string[]> {
  return Promise.resolve(filterValidImageUrls(urls))
}

export async function downloadComicNettaiChapterImage(
  imageUrl: string,
  opts?: {
    signal?: AbortSignal
    context?: Record<string, unknown>
    skipRateLimit?: boolean
    onBytesReceived?: (bytesReceived: number) => void | Promise<void>
  },
): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
  if (opts?.signal?.aborted) {
    throw new Error('aborted')
  }

  const { sourceUrl, metadata } = parsePublusImageTransportUrl(imageUrl)

  const { data: rawData, mimeType } = await fetchImageWithStallDetection(sourceUrl, {
    signal: opts?.signal,
    rateLimitPolicy: getRateLimitPolicyFromContext(opts?.context, 'image'),
    skipRateLimit: opts?.skipRateLimit,
    onBytesReceived: opts?.onBytesReceived,
  })
  const data = metadata ? await descramblePublusImage(rawData, mimeType, metadata) : rawData
  const filename = new URL(sourceUrl).pathname.split('/').filter(Boolean).pop() || 'page.jpeg'

  return { data, filename, mimeType }
}
