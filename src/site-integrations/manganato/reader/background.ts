import type { BackgroundSiteAdapter } from "@/src/types/site-integrations"
import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { cancelResponseBody } from "@/src/shared/response-body"
import { integrationHttpClient } from "../../http-client"
import { canonicalManganatoUrl, type ManganatoSite } from "./protocol"

export function createManganatoBackgroundAdapter(
  site: ManganatoSite
): BackgroundSiteAdapter {
  return {
    background: {
      name: `${site.name} Background`,
      series: {
        getCatalogOrigin: (seriesUrl) =>
          canonicalManganatoUrl(seriesUrl, site).origin,
        async resolveSeriesData(input) {
          const url = canonicalManganatoUrl(input.seriesUrl, site)
          const seriesId = url.pathname.split("/")[2]
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
          const result = await resolveSeriesDataViaOffscreen({
            siteIntegrationId: site.id,
            seriesUrl: url.href,
            html,
            language: input.language,
            signal: input.signal,
            rateLimitService: input.rateLimitService,
          })
          return { ...result, seriesId }
        },
      },
    },
  }
}
