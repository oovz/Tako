import type {
  BackgroundIntegration,
  RuntimeSiteIntegration,
} from "@/src/types/site-integrations"
import {
  downloadManhuaguiChapterImage,
  parseManhuaguiImageUrlsFromHtml,
  processManhuaguiImageUrls,
  resolveManhuaguiChapterImageUrls,
} from "./chapter-api"
/**
 * Background half of the Manhuagui integration. Methods are thin wrappers
 * around `chapter-api.ts` so message handlers and offscreen fallbacks share a
 * single implementation.
 */
export const manhuaguiBackgroundIntegration: BackgroundIntegration = {
  name: "Manhuagui Background",
  chapter: {
    resolveImageUrls(chapter, _context, settingsSnapshot): Promise<string[]> {
      return resolveManhuaguiChapterImageUrls(chapter, settingsSnapshot)
    },

    parseImageUrlsFromHtml(input) {
      return parseManhuaguiImageUrlsFromHtml(input)
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      return processManhuaguiImageUrls(urls)
    },

    downloadImage(
      imageUrl: string,
      opts?: {
        signal?: AbortSignal
        context?: Record<string, unknown>
        onBytesReceived?: (bytesReceived: number) => void | Promise<void>
      }
    ) {
      return downloadManhuaguiChapterImage(imageUrl, opts)
    },
  },
}

export const manhuaguiIntegration = {
  id: "manhuagui",
  background: manhuaguiBackgroundIntegration,
} satisfies RuntimeSiteIntegration
