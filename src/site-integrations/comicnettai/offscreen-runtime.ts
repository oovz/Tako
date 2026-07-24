import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
  SeriesDataResolutionResult,
} from "@/src/types/site-integrations"
import {
  downloadComicNettaiChapterImage,
  processComicNettaiImageUrls,
  resolveComicNettaiChapterImageUrls,
} from "./chapter-api"
import {
  extractComicNettaiChapterListWithPagination,
  extractComicNettaiSeriesMetadataFromDocument,
} from "./series-dom"

const offscreen: OffscreenIntegration = {
  name: "Comic Nettai Offscreen",
  series: {
    async resolveSeriesData({
      seriesUrl,
      document,
      language,
    }): Promise<SeriesDataResolutionResult> {
      const result: SeriesDataResolutionResult = {}
      try {
        result.seriesMetadata =
          extractComicNettaiSeriesMetadataFromDocument(document)
      } catch (error) {
        result.metadataError =
          error instanceof Error ? error.message : String(error)
      }
      try {
        result.chapterList = await extractComicNettaiChapterListWithPagination(
          document,
          seriesUrl
        )
      } catch (error) {
        result.chapterListError =
          error instanceof Error ? error.message : String(error)
      }
      if (result.seriesMetadata && language) {
        result.seriesMetadata.language = language
      }
      return result
    },
  },
  chapter: {
    resolveImageUrls(chapter, _context, settingsSnapshot) {
      return resolveComicNettaiChapterImageUrls(chapter, settingsSnapshot)
    },

    processImageUrls(urls: string[]) {
      return processComicNettaiImageUrls(urls)
    },

    downloadImage(
      imageUrl: string,
      opts?: {
        signal?: AbortSignal
        context?: Record<string, unknown>
        onBytesReceived?: (bytesReceived: number) => void | Promise<void>
      }
    ) {
      return downloadComicNettaiChapterImage(imageUrl, {
        ...opts,
        skipRateLimit: true,
      })
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  id: "comicnettai",
  offscreen,
}
