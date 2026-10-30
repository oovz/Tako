import type { OffscreenSiteAdapter } from "@/src/types/site-integrations"
import { createImageDownloadAdapter } from "../image-download-adapter"
import { ProviderContractError } from "../provider-contract-error"
import {
  parseZaimanhuaChapter,
  parseZaimanhuaUrl,
  requestZaimanhuaJson,
  zaimanhuaApiUrl,
} from "./api"

const downloadImage = createImageDownloadAdapter({
  integrationId: "mangaagain",
  endpointId: "mangaagain-image",
  skipRateLimit: true,
  filename: "page",
})

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  offscreen: {
    name: "Zaimanhua Offscreen",
    cover: { downloadImage },
    chapter: {
      async resolveChapterPlan(chapter, input) {
        const route = parseZaimanhuaUrl(chapter.url)
        if (
          !route.seriesId ||
          !route.chapterId ||
          route.chapterId !== chapter.id
        )
          throw new ProviderContractError(
            "Zaimanhua chapter route is unavailable"
          )
        return {
          imageUrls: parseZaimanhuaChapter(
            await requestZaimanhuaJson(
              zaimanhuaApiUrl(route, "chapter"),
              input.runtime.rateLimitService,
              input.signal
            ),
            route.seriesId,
            route.chapterId
          ),
        }
      },
      downloadImage,
    },
  },
}
