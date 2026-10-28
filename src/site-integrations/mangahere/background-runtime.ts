import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import { cancelResponseBody } from "@/src/shared/response-body"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import { mangaHereUrl } from "./reader"

const background: ServiceWorkerIntegration = {
  name: "MangaHere Background",
  series: {
    async resolveSeriesData(input) {
      const url = mangaHereUrl(input.seriesUrl)
      const response = await integrationHttpClient.request({
        integrationId: "mangahere",
        endpointId: "mangahere-page",
        url: url.href,
        scope: "chapter",
        rateLimitService: input.rateLimitService,
        init: { signal: input.signal },
      })
      if (!response.ok) {
        cancelResponseBody(response)
        throw Object.assign(
          new Error(
            `MangaHere series request failed (HTTP ${response.status})`
          ),
          { status: response.status }
        )
      }
      const { html } = await decodeHtmlResponse(response)
      return resolveSeriesDataViaOffscreen({
        siteIntegrationId: "mangahere",
        seriesUrl: url.href,
        html,
        language: input.language,
        signal: input.signal,
        rateLimitService: input.rateLimitService,
      })
    },
  },
}
export const backgroundSiteAdapter: BackgroundSiteAdapter = { background }
