import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import { fetchCoolmicTitle, parseCoolmicId } from "./api"
const background: ServiceWorkerIntegration = {
  name: "Coolmic Background",
  series: {
    async resolveSeriesData(input) {
      const id = parseCoolmicId(input.seriesUrl, "titles")
      const html = await fetchCoolmicTitle(
        id,
        input.rateLimitService,
        input.signal
      )
      const result = await resolveSeriesDataViaOffscreen({
        siteIntegrationId: "coolmic",
        seriesUrl: input.seriesUrl,
        html,
        language: input.language,
        signal: input.signal,
        rateLimitService: input.rateLimitService,
      })
      return { ...result, seriesId: id }
    },
  },
}
export const backgroundSiteAdapter: BackgroundSiteAdapter = { background }
