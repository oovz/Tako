import { getBackgroundSiteAdapterById } from "@/src/runtime/background-site-integration-initialization"
import type {
  SeriesDataResolutionResult,
  SiteIntegrationSettingsReader,
} from "@/src/types/site-integrations"
import type { RateLimitService } from "@/src/runtime/rate-limit"

export interface ResolveSiteIntegrationSeriesDataInput {
  siteIntegrationId: string
  seriesUrl?: string
  seriesId?: string
  language?: string
  pageProbeData?: unknown
  signal?: AbortSignal
  rateLimitService: RateLimitService
  siteIntegrationSettingsReader: SiteIntegrationSettingsReader
  /**
   * Optional callback for partial results. Called when metadata is available
   * but the chapter list is still being fetched.
   */
  onPartial?: (partial: SeriesDataResolutionResult) => void | Promise<void>
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

  if (!input.seriesUrl && !input.seriesId) {
    throw new Error("Series resolution requires a seriesUrl or seriesId")
  }
  return series.resolveSeriesData({
    seriesUrl: input.seriesUrl ?? "",
    seriesId: input.seriesId,
    language: input.language,
    ...(input.pageProbeData !== undefined
      ? { pageProbeData: input.pageProbeData }
      : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    rateLimitService: input.rateLimitService,
    siteIntegrationSettingsReader: input.siteIntegrationSettingsReader,
    onPartial: input.onPartial,
  })
}
