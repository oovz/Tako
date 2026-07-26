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
  /**
   * Optional callback for partial results. Called when metadata is available
   * but the chapter list is still being fetched.
   */
  onPartial?: (partial: SeriesDataResolutionResult) => void | Promise<void>
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
      onPartial: input.onPartial,
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

  const metadataPromise = series.fetchSeriesMetadata(
    input.seriesId,
    input.language
  )
  let chapterListSettled = false
  const chapterListPromise = series
    .fetchChapterList(input.seriesId, input.language)
    .finally(() => {
      chapterListSettled = true
    })
  const partialDeliveryPromise = metadataPromise.then(
    async (seriesMetadata) => {
      if (input.onPartial && !chapterListSettled) {
        await input.onPartial({
          seriesId: input.seriesId,
          seriesMetadata,
          chaptersLoading: true,
        })
      }
    },
    () => undefined
  )

  const [metadataOutcome, chapterListOutcome, partialDeliveryOutcome] =
    await Promise.allSettled([
      metadataPromise,
      chapterListPromise,
      partialDeliveryPromise,
    ])
  if (partialDeliveryOutcome.status === "rejected") {
    throw partialDeliveryOutcome.reason
  }

  return {
    seriesId: input.seriesId,
    seriesMetadata:
      metadataOutcome.status === "fulfilled"
        ? metadataOutcome.value
        : undefined,
    chapterList:
      chapterListOutcome.status === "fulfilled"
        ? chapterListOutcome.value
        : undefined,
    metadataError:
      metadataOutcome.status === "rejected"
        ? errorMessage(metadataOutcome.reason)
        : undefined,
    chapterListError:
      chapterListOutcome.status === "rejected"
        ? errorMessage(chapterListOutcome.reason)
        : undefined,
  }
}
