import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
  SeriesDataResolutionResult,
} from "@/src/types/site-integrations"
import type { JsonObject } from "@/src/types/site-integrations"
import { ChapterImagePlanSchema } from "../chapter-plan"
import type { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import {
  downloadManhuaguiChapterImage,
  downloadManhuaguiCoverImage,
  resolveManhuaguiChapterImageUrls,
} from "./chapter-api"
import {
  extractChapterListFromDocument,
  extractSeriesMetadataFromDocument,
} from "./series-dom"

const offscreen: OffscreenIntegration = {
  name: "Manhuagui Offscreen",
  cover: {
    downloadImage: downloadManhuaguiCoverImage,
  },
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
        if (document.querySelector("#checkAdult")) {
          result.chapterListNotice = "adult-consent-required"
        }
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
    async resolveChapterPlan(chapter, input) {
      const urls = await resolveManhuaguiChapterImageUrls(
        chapter,
        input.runtime.rateLimitService,
        input.settings,
        input.signal
      )
      return ChapterImagePlanSchema.parse({ imageUrls: urls })
    },

    downloadImage(
      imageUrl: string,
      opts: {
        signal?: AbortSignal
        dispatchContext?: JsonObject
        runtime: import("@/src/types/site-integrations").ChapterRuntimeData
        onBytesReceived?: (bytesReceived: number) => void | Promise<void>
        liveResourceLedger?: OffscreenLiveResourceLedger
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
