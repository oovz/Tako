import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { createImageDownloadAdapter } from "../image-download-adapter"
import { resolveAimanhuaSeries } from "./series"
import { resolveChapterPlan, imageUrl } from "./chapter"
const downloadImage = createImageDownloadAdapter({
  integrationId: "lovemanga",
  endpointId: "lovemanga-image",
  normalizeUrl: imageUrl,
  assertUrlAllowed: imageUrl,
  filename: "page",
})
const offscreen: OffscreenIntegration = {
  name: "Aimanhua Offscreen",
  cover: { downloadImage },
  series: {
    resolveSeriesData(input) {
      return Promise.resolve(
        resolveAimanhuaSeries(input.document, input.seriesUrl)
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
