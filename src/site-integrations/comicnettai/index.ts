import type {
  BackgroundIntegration,
  ContentScriptIntegration,
  SiteIntegration,
} from '@/src/types/site-integrations'
import {
  downloadComicNettaiChapterImage,
  parseComicNettaiImageUrlsFromHtml,
  processComicNettaiImageUrls,
  resolveComicNettaiChapterImageUrls,
} from './chapter-api'
import {
  extractComicNettaiChapterListFromDocument,
  extractComicNettaiSeriesMetadataFromDocument,
} from './series-dom'
import { parseComicNettaiSeriesIdFromPath } from './shared'

export const comicNettaiContentIntegration: ContentScriptIntegration = {
  name: 'Comic Nettai Content',
  series: {
    getSeriesId(): string {
      const seriesId = parseComicNettaiSeriesIdFromPath(window.location.pathname)
      if (!seriesId) {
        throw new Error(`Failed to extract Comic Nettai series ID from URL: ${window.location.pathname}`)
      }
      return seriesId
    },

    extractSeriesMetadata() {
      return extractComicNettaiSeriesMetadataFromDocument(document)
    },

    extractChapterList() {
      return extractComicNettaiChapterListFromDocument(document)
    },
  },
}

export const comicNettaiBackgroundIntegration: BackgroundIntegration = {
  name: 'Comic Nettai Background',
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
      return downloadComicNettaiChapterImage(imageUrl, opts)
    },
  },
}

export const comicNettaiIntegration: SiteIntegration = {
  id: 'comicnettai',
  content: comicNettaiContentIntegration,
  background: comicNettaiBackgroundIntegration,
}
