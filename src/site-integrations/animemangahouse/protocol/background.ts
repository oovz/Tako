import { integrationHttpClient } from "../../http-client"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { cancelResponseBody } from "@/src/shared/response-body"
import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import type { BackgroundSiteAdapter } from "@/src/types/site-integrations"
import { assertSeriesUrl, type SignedReaderSite } from "./series"

export function createSignedReaderBackground(
  site: SignedReaderSite
): BackgroundSiteAdapter {
  return {
    background: {
      name: `${site.name} Background`,
      series: {
        async resolveSeriesData(input) {
          const url = assertSeriesUrl(site, input.seriesUrl)
          const response = await integrationHttpClient.request({
            integrationId: site.id,
            endpointId: `${site.id}-page`,
            url: url.href,
            scope: "chapter",
            rateLimitService: input.rateLimitService,
            init: { signal: input.signal },
          })
          if (!response.ok) {
            cancelResponseBody(response)
            throw Object.assign(
              new Error(
                `${site.name} series request failed (HTTP ${response.status})`
              ),
              { status: response.status }
            )
          }
          const { html } = await decodeHtmlResponse(response)
          return resolveSeriesDataViaOffscreen({
            siteIntegrationId: site.id,
            seriesUrl: url.href,
            html,
            language: input.language,
            signal: input.signal,
            rateLimitService: input.rateLimitService,
          })
        },
      },
    },
  }
}
