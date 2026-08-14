import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
  SeriesDataResolutionResult,
} from "@/src/types/site-integrations"
import type { JsonObject } from "@/src/types/site-integrations"
import { ChapterImagePlanSchema } from "../chapter-plan"
import type { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import {
  downloadComicNettaiChapterImage,
  downloadComicNettaiCoverImage,
  resolveComicNettaiChapterImageUrls,
} from "./chapter-api"
import {
  extractComicNettaiChapterListWithPagination,
  extractComicNettaiSeriesMetadataFromDocument,
} from "./series-dom"

const offscreen: OffscreenIntegration = {
  name: "Comic Nettai Offscreen",
  cover: {
    downloadImage: downloadComicNettaiCoverImage,
  },
  series: {
    async resolveSeriesData({
      seriesUrl,
      document,
      language,
      signal,
      rateLimitService,
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
          seriesUrl,
          rateLimitService,
          undefined,
          signal
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
    async resolveChapterPlan(chapter, input) {
      const imageUrls = await resolveComicNettaiChapterImageUrls(
        chapter,
        input.runtime.rateLimitService,
        input.settings,
        input.signal
      )
      return ChapterImagePlanSchema.parse({ imageUrls })
    },

    downloadImage(
      imageUrl: string,
      opts: {
        signal?: AbortSignal
        dispatchContext?: JsonObject
        runtime: import("@/src/types/site-integrations").ChapterRuntimeData
        skipRateLimit?: boolean
        onBytesReceived?: (bytesReceived: number) => void | Promise<void>
        liveResourceLedger?: OffscreenLiveResourceLedger
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
