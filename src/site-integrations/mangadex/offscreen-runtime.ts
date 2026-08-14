import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { ChapterImagePlanSchema } from "../chapter-plan"
import {
  MangadexDispatchContextSchema,
  type MangadexDispatchContext,
} from "./contracts/dispatch-context"
import type { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import {
  downloadMangadexChapterImage,
  downloadMangadexCoverImage,
  resolveMangadexChapterImageUrls,
} from "./chapter-api"

const offscreen: OffscreenIntegration<MangadexDispatchContext> = {
  name: "MangaDex API Offscreen",
  dispatchContext: {
    parse: (value) => MangadexDispatchContextSchema.parse(value),
  },
  cover: {
    downloadImage: downloadMangadexCoverImage,
  },
  chapter: {
    async resolveChapterPlan(chapter: { id: string; url: string }, input) {
      const context = input?.dispatchContext
      const urls = await resolveMangadexChapterImageUrls(
        chapter,
        input.runtime.rateLimitService,
        context,
        input.signal
      )
      return ChapterImagePlanSchema.parse({ imageUrls: urls })
    },

    async downloadImage(
      imageUrl: string,
      opts: {
        signal?: AbortSignal
        dispatchContext?: MangadexDispatchContext
        runtime: import("@/src/types/site-integrations").ChapterRuntimeData
        onBytesReceived?: (bytesReceived: number) => void | Promise<void>
        liveResourceLedger?: OffscreenLiveResourceLedger
      }
    ): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
      return downloadMangadexChapterImage(imageUrl, {
        ...opts,
        dispatchContext: opts.dispatchContext,
      })
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter<MangadexDispatchContext> =
  {
    id: "mangadex",
    offscreen,
  }
