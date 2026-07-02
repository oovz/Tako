import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from '@/src/types/site-integrations'
import {
  downloadComicNettaiChapterImage,
  parseComicNettaiImageUrlsFromHtml,
  processComicNettaiImageUrls,
  resolveComicNettaiChapterImageUrls,
} from './chapter-api'

const offscreen: OffscreenIntegration = {
  name: 'Comic Nettai Offscreen',
  chapter: {
    resolveImageUrls(chapter, _context, settingsSnapshot) {
      return resolveComicNettaiChapterImageUrls(chapter, settingsSnapshot)
    },

    parseImageUrlsFromHtml() {
      return parseComicNettaiImageUrlsFromHtml()
    },

    processImageUrls(urls: string[]) {
      return processComicNettaiImageUrls(urls)
    },

    downloadImage(imageUrl: string, opts?: {
      signal?: AbortSignal
      context?: Record<string, unknown>
      onBytesReceived?: (bytesReceived: number) => void | Promise<void>
    }) {
      return downloadComicNettaiChapterImage(imageUrl, { ...opts, skipRateLimit: true })
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  id: 'comicnettai',
  offscreen,
}
