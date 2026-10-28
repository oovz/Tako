import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import { resolveMangaHereSeries } from "./series"
import { resolveChapterPlan, imageUrl } from "./chapter"
const downloadImage: OffscreenIntegration["chapter"]["downloadImage"] = async (
  value,
  opts
) => {
  const url = imageUrl(value)
  const result = await fetchImageWithStallDetection(url, {
    integrationId: "mangahere",
    endpointId: "mangahere-image",
    signal: opts.signal,
    rateLimitService: opts.runtime.rateLimitService,
    skipRateLimit: opts.skipRateLimit,
    onBytesReceived: opts.onBytesReceived,
    liveResourceLedger: opts.liveResourceLedger,
    assertUrlAllowed: imageUrl,
  })
  return {
    ...result,
    filename: new URL(url).pathname.split("/").pop() || "page.jpg",
  }
}
const offscreen: OffscreenIntegration = {
  name: "MangaHere Offscreen",
  cover: { downloadImage },
  series: {
    resolveSeriesData(input) {
      return Promise.resolve(
        resolveMangaHereSeries(input.document, input.seriesUrl)
      )
    },
  },
  chapter: {
    resolveChapterPlan,
    downloadImage(value, opts) {
      return downloadImage(value, { ...opts, skipRateLimit: true })
    },
  },
}
export const offscreenSiteAdapter: OffscreenSiteAdapter = { offscreen }
