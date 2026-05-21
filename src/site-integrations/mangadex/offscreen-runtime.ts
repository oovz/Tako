import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
  ParseImageUrlsFromHtmlInput,
} from '@/src/types/site-integrations'
import {
  downloadMangadexChapterImage,
  parseMangadexImageUrlsFromHtml,
  processMangadexImageUrls,
  resolveMangadexChapterImageUrls,
} from './chapter-api'

const offscreen: OffscreenIntegration = {
  name: 'MangaDex API Offscreen',
  chapter: {
    async resolveImageUrls(
      chapter: { id: string; url: string },
      context?: Record<string, unknown>,
    ): Promise<string[]> {
      return resolveMangadexChapterImageUrls(chapter, context)
    },

    async parseImageUrlsFromHtml(input: ParseImageUrlsFromHtmlInput): Promise<string[]> {
      return parseMangadexImageUrlsFromHtml(input)
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      return processMangadexImageUrls(urls)
    },

    async downloadImage(
      imageUrl: string,
      opts?: { signal?: AbortSignal; context?: Record<string, unknown> },
    ): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
      return downloadMangadexChapterImage(imageUrl, opts)
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  id: 'mangadex',
  offscreen,
}
