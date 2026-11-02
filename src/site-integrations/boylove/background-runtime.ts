import type { BackgroundSiteAdapter } from "@/src/types/site-integrations"
import { cancelResponseBody } from "@/src/shared/response-body"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import { integrationHttpClient } from "../http-client"
import { assertBoylovePageUrl } from "./series-dom"

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  background: {
    name: "BoyLove Background",
    series: {
      async resolveSeriesData(input) {
        const url = assertBoylovePageUrl(input.seriesUrl, "index")
        const response = await integrationHttpClient.request({
          integrationId: "boylove",
          endpointId: "boylove-page",
          url: url.href,
          scope: "chapter",
          rateLimitService: input.rateLimitService,
          init: { signal: input.signal },
        })
        if (!response.ok) {
          cancelResponseBody(response)
          throw Object.assign(
            new Error(
              `BoyLove series request failed (HTTP ${response.status}).`
            ),
            { status: response.status }
          )
        }
        const { html } = await decodeHtmlResponse(response)
        const result = await resolveSeriesDataViaOffscreen({
          ...input,
          siteIntegrationId: "boylove",
          html,
        })
        return {
          ...result,
          seriesId: url.pathname.split("/").filter(Boolean).at(-1),
        }
      },
    },
  },
}
