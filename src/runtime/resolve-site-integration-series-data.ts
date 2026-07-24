import { getBackgroundSiteAdapterById } from "@/src/runtime/background-site-integration-initialization"
import type { MangadexPreferencesPayload } from "@/src/types/runtime-command-messages"
import type { SeriesDataResolutionResult } from "@/src/types/site-integrations"

export interface ResolveSiteIntegrationSeriesDataInput {
  siteIntegrationId: string
  seriesUrl?: string
  seriesId?: string
  language?: string
  mangadexPreferences?: MangadexPreferencesPayload
  integrationContext?: Record<string, unknown>
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/** Canonical background resolver shared by runtime messages and tab discovery. */
export async function resolveSiteIntegrationSeriesData(
  input: ResolveSiteIntegrationSeriesDataInput
): Promise<SeriesDataResolutionResult> {
  const integration = await getBackgroundSiteAdapterById(
    input.siteIntegrationId
  )
  const series = integration?.background.series
  if (!series) {
    throw new Error(
      `Site integration ${input.siteIntegrationId} does not provide background series loaders`
    )
  }

  if (series.resolveSeriesData) {
    if (!input.seriesUrl && !input.seriesId) {
      throw new Error(
        "URL-based series resolution requires a seriesUrl or seriesId"
      )
    }
    return series.resolveSeriesData({
      seriesUrl: input.seriesUrl ?? "",
      seriesId: input.seriesId,
      language: input.language,
      mangadexPreferences: input.mangadexPreferences,
      ...(input.integrationContext
        ? { integrationContext: input.integrationContext }
        : {}),
    })
  }

  if (!input.seriesId) {
    throw new Error(
      "Series resolution requires a seriesId when no URL resolver is registered"
    )
  }
  if (!series.fetchSeriesMetadata || !series.fetchChapterList) {
    throw new Error(
      `Site integration ${input.siteIntegrationId} does not provide complete series loaders`
    )
  }

  const [metadataResult, chapterListResult] = await Promise.allSettled([
    series.fetchSeriesMetadata(input.seriesId, input.language),
    series.fetchChapterList(input.seriesId, input.language),
  ])
  return {
    seriesId: input.seriesId,
    seriesMetadata:
      metadataResult.status === "fulfilled" ? metadataResult.value : undefined,
    chapterList:
      chapterListResult.status === "fulfilled"
        ? chapterListResult.value
        : undefined,
    metadataError:
      metadataResult.status === "rejected"
        ? errorMessage(metadataResult.reason)
        : undefined,
    chapterListError:
      chapterListResult.status === "rejected"
        ? errorMessage(chapterListResult.reason)
        : undefined,
  }
}
