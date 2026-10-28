import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import { cancelResponseBody } from "@/src/shared/response-body"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import { parseMangagoUrl } from "./shared"

const background: ServiceWorkerIntegration = {
  name: "Mangago Background",
  series: {
    async resolveSeriesData(input) {
      const { seriesId, chapterId } = parseMangagoUrl(input.seriesUrl)
      if (chapterId)
        throw new Error("Mangago series resolution requires a series page")
      const response = await integrationHttpClient.request({
        integrationId: "mangago",
        endpointId: "mangago-page",
        url: input.seriesUrl,
        scope: "chapter",
        rateLimitService: input.rateLimitService,
        init: { credentials: "include", signal: input.signal },
      })
      if (!response.ok) {
        cancelResponseBody(response)
        throw Object.assign(
          new Error(`Mangago series request failed (HTTP ${response.status})`),
          { status: response.status }
        )
      }
      const { html } = await decodeHtmlResponse(response)
      const result = await resolveSeriesDataViaOffscreen({
        siteIntegrationId: "mangago",
        seriesUrl: input.seriesUrl,
        html,
        language: input.language,
        signal: input.signal,
        rateLimitService: input.rateLimitService,
      })
      return { ...result, seriesId }
    },
  },
}
export const backgroundSiteAdapter: BackgroundSiteAdapter = { background }
