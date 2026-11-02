import type { BackgroundSiteAdapter } from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { cancelResponseBody } from "@/src/shared/response-body"
import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import { parseCopyUrl } from "./api"

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  background: {
    name: "Copy Background",
    series: {
      async resolveSeriesData(input) {
        const route = parseCopyUrl(input.seriesUrl)
        const seriesUrl = new URL(`/comic/${route.slug}`, route.url.origin).href
        const response = await integrationHttpClient.request({
          integrationId: "copymanga",
          endpointId: "copy-page",
          url: seriesUrl,
          scope: "chapter",
          rateLimitService: input.rateLimitService,
          init: { credentials: "include", signal: input.signal },
        })
        if (!response.ok) {
          cancelResponseBody(response)
          throw Object.assign(
            new Error(`Copy series request failed (HTTP ${response.status})`),
            { status: response.status }
          )
        }
        const { html } = await decodeHtmlResponse(response)
        const resolved = await resolveSeriesDataViaOffscreen({
          siteIntegrationId: "copymanga",
          seriesUrl,
          html,
          language: input.language,
          signal: input.signal,
          rateLimitService: input.rateLimitService,
        })
        return { ...resolved, seriesId: route.slug }
      },
    },
  },
}
