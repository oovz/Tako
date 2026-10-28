import type { BackgroundSiteAdapter } from "@/src/types/site-integrations"
import {
  parseZaimanhuaSeries,
  parseZaimanhuaUrl,
  requestZaimanhuaJson,
  zaimanhuaApiUrl,
} from "./api"

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  background: {
    name: "Zaimanhua Background",
    series: {
      async resolveSeriesData(input) {
        const route = parseZaimanhuaUrl(input.seriesUrl)
        return parseZaimanhuaSeries(
          await requestZaimanhuaJson(
            zaimanhuaApiUrl(route, "comic"),
            input.rateLimitService,
            input.signal
          ),
          route.url
        )
      },
    },
  },
}
