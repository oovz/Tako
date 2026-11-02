import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { createHtmlSeriesResolver } from "../html-series-resolver"
import { mangaHereUrl } from "./reader"

const background: ServiceWorkerIntegration = {
  name: "MangaHere Background",
  series: {
    resolveSeriesData: createHtmlSeriesResolver({
      integrationId: "mangahere",
      endpointId: "mangahere-page",
      normalizeUrl: mangaHereUrl,
      errorLabel: "MangaHere",
    }),
  },
}
export const backgroundSiteAdapter: BackgroundSiteAdapter = { background }
