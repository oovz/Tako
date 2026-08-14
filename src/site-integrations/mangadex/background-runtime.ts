import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionInput,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { prepareMangadexDispatchContext } from "./dispatch-context"
import {
  fetchMangadexChapterList,
  fetchMangadexSeriesMetadata,
} from "./series-api"
import { parseUuidFromPath } from "./api"
import { parseMangadexPagePreferences } from "./preferences"
import {
  MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY,
  parseMangadexPreferencesBySeries,
} from "./preferences-schema"
import { composeSeriesKey } from "@/src/runtime/queue-task-summary"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"
import logger from "@/src/runtime/logger"
import type { MangadexDispatchContext } from "./contracts/dispatch-context"
import type { SiteIntegrationSettingsReader } from "@/src/types/site-integrations"

const pageProbePreferenceWrites = new StorageMutationQueue()

function resolutionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function resolveMangadexSeriesData(
  input: SeriesDataResolutionInput
): Promise<SeriesDataResolutionResult> {
  let seriesId: string | null | undefined = input.seriesId
  if (!seriesId) {
    try {
      seriesId = parseUuidFromPath(new URL(input.seriesUrl).pathname, "title")
    } catch {
      seriesId = undefined
    }
  }
  if (!seriesId) {
    throw new Error("Could not determine MangaDex series ID from the title URL")
  }

  const metadataPromise = input.signal
    ? fetchMangadexSeriesMetadata(
        seriesId,
        input.rateLimitService,
        "interactive",
        input.signal
      )
    : fetchMangadexSeriesMetadata(
        seriesId,
        input.rateLimitService,
        "interactive",
        undefined
      )
  const pageProbePreferences = parseMangadexPagePreferences(input.pageProbeData)
  let chapterListSettled = false
  const chapterListPromise = (
    input.signal
      ? fetchMangadexChapterList(
          seriesId,
          input.rateLimitService,
          input.language,
          pageProbePreferences,
          "interactive",
          input.signal,
          input.siteIntegrationSettingsReader
        )
      : fetchMangadexChapterList(
          seriesId,
          input.rateLimitService,
          input.language,
          pageProbePreferences,
          "interactive",
          undefined,
          input.siteIntegrationSettingsReader
        )
  ).finally(() => {
    chapterListSettled = true
  })
  const partialDeliveryPromise = metadataPromise.then(
    async (seriesMetadata) => {
      if (input.onPartial && !chapterListSettled) {
        await input.onPartial({
          seriesId,
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
    seriesId,
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
        ? resolutionError(metadataOutcome.reason)
        : undefined,
    chapterListError:
      chapterListOutcome.status === "rejected"
        ? resolutionError(chapterListOutcome.reason)
        : undefined,
  }
}

const background: ServiceWorkerIntegration<MangadexDispatchContext> = {
  name: "MangaDex API Background",
  async shouldExecutePageProbe(input: {
    siteIntegrationSettingsReader: SiteIntegrationSettingsReader
  }): Promise<boolean> {
    try {
      const settings =
        await input.siteIntegrationSettingsReader.getForSite("mangadex")
      return settings.autoReadMangaDexSettings !== false
    } catch (error) {
      logger.debug("Skipping optional MangaDex page probe", error)
      return false
    }
  },
  async persistPageProbeData(input): Promise<void> {
    const preferences = parseMangadexPagePreferences(input.pageProbeData)
    if (!preferences) return
    await pageProbePreferenceWrites.run(async () => {
      const session = await chrome.storage.session.get(
        MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY
      )
      const preferencesBySeries = parseMangadexPreferencesBySeries(
        session[MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY]
      )
      preferencesBySeries[composeSeriesKey("mangadex", input.seriesId)] =
        preferences
      await chrome.storage.session.set({
        [MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY]: preferencesBySeries,
      })
    })
  },
  series: {
    resolveSeriesData: resolveMangadexSeriesData,
  },
  async prepareDispatchContext(
    input
  ): Promise<MangadexDispatchContext | undefined> {
    return prepareMangadexDispatchContext({
      seriesKey: input.seriesKey,
      siteIntegrationSettingsReader: input.siteIntegrationSettingsReader,
    })
  },
}

export const backgroundSiteAdapter: BackgroundSiteAdapter<MangadexDispatchContext> =
  {
    id: "mangadex",
    background,
  }
