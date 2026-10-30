import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { createImageDownloadAdapter } from "../image-download-adapter"
import { resolveMangaHereSeries } from "./series"
import { resolveChapterPlan, imageUrl } from "./chapter"
const downloadImage = createImageDownloadAdapter({
  integrationId: "mangahere",
  endpointId: "mangahere-image",
  normalizeUrl: imageUrl,
  assertUrlAllowed: imageUrl,
  filename: "page",
})
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
