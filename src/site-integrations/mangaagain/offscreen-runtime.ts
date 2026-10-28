import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import { ProviderContractError } from "../provider-contract-error"
import {
  parseZaimanhuaChapter,
  parseZaimanhuaUrl,
  requestZaimanhuaJson,
  zaimanhuaApiUrl,
} from "./api"

const downloadImage: OffscreenIntegration["chapter"]["downloadImage"] = async (
  imageUrl,
  opts
) => {
  const result = await fetchImageWithStallDetection(imageUrl, {
    integrationId: "mangaagain",
    endpointId: "mangaagain-image",
    rateLimitService: opts.runtime.rateLimitService,
    skipRateLimit: true,
    signal: opts.signal,
    onBytesReceived: opts.onBytesReceived,
    liveResourceLedger: opts.liveResourceLedger,
  })
  return {
    ...result,
    filename: new URL(imageUrl).pathname.split("/").pop() || "page.jpg",
  }
}

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
