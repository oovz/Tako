import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import { cancelResponseBody } from "@/src/shared/response-body"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import { parseMyComicUrl } from "./shared"

const background: ServiceWorkerIntegration = {
  name: "MyComic Background",
  series: {
    async resolveSeriesData(input) {
      const { id } = parseMyComicUrl(input.seriesUrl, "comics")
      const response = await integrationHttpClient.request({
        integrationId: "mycomic",
        endpointId: "mycomic-page",
        url: input.seriesUrl,
        scope: "chapter",
        rateLimitService: input.rateLimitService,
        init: { credentials: "include", signal: input.signal },
      })
      if (!response.ok) {
        cancelResponseBody(response)
        throw Object.assign(
          new Error(`MyComic series request failed (HTTP ${response.status})`),
          { status: response.status }
        )
      }
      const { html } = await decodeHtmlResponse(response)
      const result = await resolveSeriesDataViaOffscreen({
        siteIntegrationId: "mycomic",
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
