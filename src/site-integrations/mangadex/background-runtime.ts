import type {
  BackgroundSiteAdapter,
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

async function resolveMangadexSeriesData(input: {
  seriesUrl: string
  seriesId?: string
  language?: string
  mangadexPreferences?: Parameters<typeof fetchMangadexChapterList>[2]
}): Promise<SeriesDataResolutionResult> {
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

  const [metadataResult, chapterListResult] = await Promise.allSettled([
    fetchMangadexSeriesMetadata(seriesId, "interactive"),
    fetchMangadexChapterList(
      seriesId,
      input.language,
      input.mangadexPreferences,
      "interactive"
    ),
  ])

  return {
    seriesId,
    seriesMetadata:
      metadataResult.status === "fulfilled" ? metadataResult.value : undefined,
    chapterList:
      chapterListResult.status === "fulfilled"
        ? chapterListResult.value
        : undefined,
    metadataError:
      metadataResult.status === "rejected"
        ? resolutionError(metadataResult.reason)
        : undefined,
    chapterListError:
      chapterListResult.status === "rejected"
        ? resolutionError(chapterListResult.reason)
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
