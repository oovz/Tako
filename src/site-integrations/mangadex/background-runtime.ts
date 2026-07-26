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

  let metadataResult: Awaited<ReturnType<typeof fetchMangadexSeriesMetadata>>
  let metadataError: string | undefined
  try {
    metadataResult = await fetchMangadexSeriesMetadata(seriesId, "interactive")
  } catch (error) {
    metadataError = resolutionError(error)
    // Chapter list is dependent on a valid series identifier, so abort early.
    return { seriesId, metadataError }
  }

  if (input.onPartial) {
    await input.onPartial({
      seriesId,
      seriesMetadata: metadataResult,
      chaptersLoading: true,
    })
  }

  let chapterListResult:
    Awaited<ReturnType<typeof fetchMangadexChapterList>> | undefined
  let chapterListError: string | undefined
  try {
    chapterListResult = await fetchMangadexChapterList(
      seriesId,
      input.language,
      input.mangadexPreferences,
      "interactive"
    )
  } catch (error) {
    chapterListError = resolutionError(error)
  }

  return {
    seriesId,
    seriesMetadata: metadataResult,
    chapterList: chapterListResult,
    metadataError,
    chapterListError,
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
