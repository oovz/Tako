import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
  ParseImageUrlsFromHtmlInput,
  SeriesDataResolutionResult,
} from "@/src/types/site-integrations"
import {
  downloadManhuaguiChapterImage,
  parseManhuaguiImageUrlsFromHtml,
  processManhuaguiImageUrls,
  resolveManhuaguiChapterImageUrls,
} from "./chapter-api"
import {
  extractChapterListFromDocument,
  extractSeriesMetadataFromDocument,
} from "./series-dom"

const offscreen: OffscreenIntegration = {
  name: "Manhuagui Offscreen",
  series: {
    resolveSeriesData({
      document,
      language,
    }): Promise<SeriesDataResolutionResult> {
      const result: SeriesDataResolutionResult = {}
      try {
        result.seriesMetadata = extractSeriesMetadataFromDocument(document)
      } catch (error) {
        result.metadataError =
          error instanceof Error ? error.message : String(error)
      }
      try {
        result.chapterList = extractChapterListFromDocument(document)
      } catch (error) {
        result.chapterListError =
          error instanceof Error ? error.message : String(error)
      }
      if (result.seriesMetadata && language) {
        result.seriesMetadata.language = language
      }
      return Promise.resolve(result)
    },
  },
  chapter: {
    resolveImageUrls(chapter, _context, settingsSnapshot): Promise<string[]> {
      return resolveManhuaguiChapterImageUrls(chapter, settingsSnapshot)
    },

    parseImageUrlsFromHtml(
      input: ParseImageUrlsFromHtmlInput
    ): Promise<string[]> {
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
      return downloadManhuaguiChapterImage(imageUrl, {
        ...opts,
        skipRateLimit: true,
      })
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  id: "manhuagui",
  offscreen,
}
