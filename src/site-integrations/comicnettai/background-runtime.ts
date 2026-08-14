import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import { COMICNETTAI_ORIGIN, parseComicNettaiSeriesIdFromPath } from "./shared"
import type { RateLimitService } from "@/src/runtime/rate-limit"

async function resolveComicNettaiSeriesData(input: {
  seriesUrl: string
  seriesId?: string
  language?: string
  signal?: AbortSignal
  rateLimitService: RateLimitService
}): Promise<SeriesDataResolutionResult> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(input.seriesUrl)
  } catch {
    throw new Error("Invalid Comic Nettai series URL")
  }

  if (parsedUrl.origin !== COMICNETTAI_ORIGIN) {
    throw new Error(
      "Comic Nettai URL must use the trusted comicnettai.com origin"
    )
  }

  const seriesId =
    input.seriesId ?? parseComicNettaiSeriesIdFromPath(parsedUrl.pathname)
  if (!seriesId) {
    throw new Error(
      "Comic Nettai series URL must match /book/{id} or include a seriesId"
    )
  }

  const response = await integrationHttpClient.request({
    integrationId: "comicnettai",
    endpointId: "comicnettai-viewer-page",
    url: input.seriesUrl,
    scope: "chapter",
    rateLimitService: input.rateLimitService,
    init: { credentials: "include", signal: input.signal },
  })
  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Comic Nettai series page could not be loaded (HTTP ${response.status}).`
      ),
      { status: response.status }
    )
  }

  const { html } = await decodeHtmlResponse(response)
  const resolved = await resolveSeriesDataViaOffscreen({
    siteIntegrationId: "comicnettai",
    seriesUrl: input.seriesUrl,
    html,
    language: input.language,
    signal: input.signal,
    rateLimitService: input.rateLimitService,
  })
  return { ...resolved, seriesId }
}

const background: ServiceWorkerIntegration = {
  name: "Comic Nettai Background",
  series: {
    resolveSeriesData: resolveComicNettaiSeriesData,
  },
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: "comicnettai",
  background,
}
