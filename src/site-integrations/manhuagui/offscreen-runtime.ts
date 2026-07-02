import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
  ParseImageUrlsFromHtmlInput,
} from '@/src/types/site-integrations'
import {
  downloadManhuaguiChapterImage,
  parseManhuaguiImageUrlsFromHtml,
  processManhuaguiImageUrls,
  resolveManhuaguiChapterImageUrls,
} from './chapter-api'

const offscreen: OffscreenIntegration = {
  name: 'Manhuagui Offscreen',
  chapter: {
    resolveImageUrls(chapter, _context, settingsSnapshot): Promise<string[]> {
      return resolveManhuaguiChapterImageUrls(chapter, settingsSnapshot)
    },

    parseImageUrlsFromHtml(input: ParseImageUrlsFromHtmlInput): Promise<string[]> {
      return parseManhuaguiImageUrlsFromHtml(input)
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      return processManhuaguiImageUrls(urls)
    },

    downloadImage(imageUrl: string, opts?: {
      signal?: AbortSignal
      context?: Record<string, unknown>
      onBytesReceived?: (bytesReceived: number) => void | Promise<void>
    }) {
      return downloadManhuaguiChapterImage(imageUrl, { ...opts, skipRateLimit: true })
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  id: 'manhuagui',
  offscreen,
}
