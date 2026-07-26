import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionInput,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { prepareMangadexDispatchContext } from "../mangadex-dispatch-context"
import {
  fetchMangadexChapterList,
  fetchMangadexSeriesMetadata,
} from "./series-api"
import { parseUuidFromPath } from "./api"

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

  const metadataPromise = fetchMangadexSeriesMetadata(seriesId, "interactive")
  let chapterListSettled = false
  const chapterListPromise = fetchMangadexChapterList(
    seriesId,
    input.language,
    input.mangadexPreferences,
    "interactive"
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

const background: ServiceWorkerIntegration = {
  name: "MangaDex API Background",
  series: {
    fetchSeriesMetadata: fetchMangadexSeriesMetadata,
    fetchChapterList: fetchMangadexChapterList,
    resolveSeriesData: resolveMangadexSeriesData,
  },
  async prepareDispatchContext(
    input
  ): Promise<Record<string, unknown> | undefined> {
    return prepareMangadexDispatchContext({ seriesKey: input.seriesKey })
  },
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: "mangadex",
  background,
}
