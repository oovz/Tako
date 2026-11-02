import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { cancelResponseBody } from "@/src/shared/response-body"
import type { ServiceWorkerIntegration } from "@/src/types/site-integrations"
import { integrationHttpClient } from "./http-client"

export function createHtmlSeriesResolver(policy: {
  integrationId: string
  endpointId: string
  normalizeUrl: (value: string) => URL
  errorLabel: string
}): NonNullable<ServiceWorkerIntegration["series"]>["resolveSeriesData"] {
  return async (input) => {
    const url = policy.normalizeUrl(input.seriesUrl)
    const response = await integrationHttpClient.request({
      integrationId: policy.integrationId,
      endpointId: policy.endpointId,
      url: url.href,
      scope: "chapter",
      rateLimitService: input.rateLimitService,
      init: { signal: input.signal },
    })
    if (!response.ok) {
      cancelResponseBody(response)
      throw Object.assign(
        new Error(
          `${policy.errorLabel} series request failed (HTTP ${response.status})`
        ),
        { status: response.status }
      )
    }
    const { html } = await decodeHtmlResponse(response)
    return resolveSeriesDataViaOffscreen({
      siteIntegrationId: policy.integrationId,
      seriesUrl: url.href,
      html,
      language: input.language,
      signal: input.signal,
      rateLimitService: input.rateLimitService,
    })
  }
}
