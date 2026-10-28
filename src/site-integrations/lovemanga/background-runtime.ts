import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import { cancelResponseBody } from "@/src/shared/response-body"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import { aimanhuaPage } from "./reader"

const background: ServiceWorkerIntegration = {
  name: "Aimanhua Background",
  series: {
    async resolveSeriesData(input) {
      const url = aimanhuaPage(input.seriesUrl)
      const response = await integrationHttpClient.request({
        integrationId: "lovemanga",
        endpointId: "lovemanga-page",
        url: url.href,
        scope: "chapter",
        rateLimitService: input.rateLimitService,
        init: { signal: input.signal },
      })
      if (!response.ok) {
        cancelResponseBody(response)
        throw Object.assign(
          new Error(`Aimanhua series request failed (HTTP ${response.status})`),
          { status: response.status }
        )
      }
      const { html } = await decodeHtmlResponse(response)
      return resolveSeriesDataViaOffscreen({
        siteIntegrationId: "lovemanga",
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
