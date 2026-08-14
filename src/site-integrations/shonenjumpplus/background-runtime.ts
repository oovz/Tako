import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import { integrationHttpClient } from "../http-client"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { parseTrustedShonenJumpPlusEpisodeUrl } from "./urls"
import { parseAggregateIdFromHtml } from "./page-context"
import { readEpisodeJsonSeriesMetadataFromHtml } from "./episode-json"
import { fetchShonenJumpPlusChapterList } from "./series-api"
import { ProviderContractError } from "../provider-contract-error"
import type { RateLimitService } from "@/src/runtime/rate-limit"

function resolveShonenJumpPlusError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function resolveShonenJumpPlusSeriesData(input: {
  seriesUrl: string
  seriesId?: string
  language?: string
  signal?: AbortSignal
  rateLimitService: RateLimitService
}): Promise<SeriesDataResolutionResult> {
  const trusted = parseTrustedShonenJumpPlusEpisodeUrl(input.seriesUrl)
  if (!trusted) {
    throw new Error(
      "Shonen Jump+ URL is not a supported episode page (/episode/{id})."
    )
  }
  const episodeId = trusted.episodeId

  const response = await integrationHttpClient.request({
    integrationId: "shonenjumpplus",
    endpointId: "shonenjumpplus-episode-html",
    url: input.seriesUrl,
    scope: "chapter",
    rateLimitService: input.rateLimitService,
    init: { credentials: "omit", signal: input.signal },
  })
  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Shonen Jump+ episode page could not be loaded (HTTP ${response.status}).`
      ),
      { status: response.status }
    )
  }

  const { html } = await decodeHtmlResponse(response)
  const aggregateId = parseAggregateIdFromHtml(html)
  if (!aggregateId) {
    throw new ProviderContractError(
      "Shonen Jump+ aggregate ID not found in episode page HTML."
    )
  }

  const json = readEpisodeJsonSeriesMetadataFromHtml(html)
  const seriesMetadata: SeriesMetadata = {
    title: json.seriesTitle ?? `Shonen Jump+ ${episodeId}`,
    coverUrl: json.seriesThumbnailUri,
    language: input.language ?? "ja",
    readingDirection: "rtl",
  }

  let chapterList: Awaited<ReturnType<typeof fetchShonenJumpPlusChapterList>>
  try {
    chapterList = await fetchShonenJumpPlusChapterList(
      aggregateId,
      episodeId,
      input.rateLimitService,
      input.signal
    )
  } catch (error) {
    return {
      seriesId: aggregateId,
      seriesMetadata,
      chapterListError: resolveShonenJumpPlusError(error),
    }
  }

  return { seriesId: aggregateId, seriesMetadata, chapterList }
}

const background: ServiceWorkerIntegration = {
  name: "Shonen Jump+ Background",
  series: {
    resolveSeriesData: resolveShonenJumpPlusSeriesData,
  },
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: "shonenjumpplus",
  background,
}
