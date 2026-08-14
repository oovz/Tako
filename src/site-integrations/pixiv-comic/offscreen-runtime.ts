import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { ChapterImagePlanSchema } from "../chapter-plan"
import {
  PixivDispatchContextSchema,
  type PixivDispatchContext,
} from "./contracts/dispatch-context"
import {
  downloadPixivChapterImage,
  downloadPixivCoverImage,
  resolvePixivChapterImageUrls,
} from "./chapter-api"

const offscreen: OffscreenIntegration<PixivDispatchContext> = {
  name: "Pixiv Comic Offscreen",
  dispatchContext: {
    parse: (value) => PixivDispatchContextSchema.parse(value),
  },
  cover: {
    downloadImage: downloadPixivCoverImage,
  },
  chapter: {
    async resolveChapterPlan(chapter, input) {
      const urls = await resolvePixivChapterImageUrls(chapter, {
        ...(input.dispatchContext ?? {}),
        ...(input.settings
          ? { rateLimitSettings: input.settings.rateLimitSettings }
          : {}),
        rateLimitService: input.runtime.rateLimitService,
        signal: input.signal,
      })
      return ChapterImagePlanSchema.parse({ imageUrls: urls })
    },

    downloadImage: (imageUrl, opts) =>
      downloadPixivChapterImage(imageUrl, {
        ...opts,
        dispatchContext: opts.dispatchContext,
        runtime: opts.runtime,
        skipRateLimit: true,
      }),
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter<PixivDispatchContext> =
  {
    id: "pixiv-comic",
    offscreen,
  }
