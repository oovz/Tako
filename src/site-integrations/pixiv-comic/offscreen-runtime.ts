import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
  ParseImageUrlsFromHtmlInput,
} from '@/src/types/site-integrations'
import {
  downloadPixivChapterImage,
  parsePixivImageUrlsFromHtml,
  processPixivImageUrls,
  resolvePixivChapterImageUrls,
} from './chapter-api'

const offscreen: OffscreenIntegration = {
  name: 'Pixiv Comic Offscreen',
  chapter: {
    async resolveImageUrls(chapter, context, settingsSnapshot): Promise<string[]> {
      return resolvePixivChapterImageUrls(chapter, {
        ...(context as { taskId?: string; cookieHeader?: string } | undefined),
        ...(settingsSnapshot ? { rateLimitSettings: settingsSnapshot.rateLimitSettings } : {}),
      })
    },

    parseImageUrlsFromHtml(input: ParseImageUrlsFromHtmlInput): Promise<string[]> {
      return parsePixivImageUrlsFromHtml(input)
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      return processPixivImageUrls(urls)
    },

    async downloadImage(
      imageUrl: string,
      opts?: { signal?: AbortSignal; context?: Record<string, unknown> },
    ): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
      return downloadPixivChapterImage(imageUrl, opts)
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  id: 'pixiv-comic',
  offscreen,
}
