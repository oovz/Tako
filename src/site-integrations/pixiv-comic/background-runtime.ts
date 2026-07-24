import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { preparePixivDispatchContext } from "./background-context"
import { fetchPixivChapterList, fetchPixivSeriesMetadata } from "./series-api"
import { parseWorkIdFromUrl } from "./page-context"

function resolvePixivSeriesDataError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function resolvePixivSeriesData(input: {
  seriesUrl: string
  seriesId?: string
  language?: string
}): Promise<SeriesDataResolutionResult> {
  const workId = input.seriesId ?? parseWorkIdFromUrl(input.seriesUrl)
  if (!workId) {
    throw new Error("Could not determine Pixiv work ID from series URL")
  }

  const [metadataResult, chapterListResult] = await Promise.allSettled([
    fetchPixivSeriesMetadata(workId),
    fetchPixivChapterList(workId),
  ])

  return {
    seriesId: workId,
    seriesMetadata:
      metadataResult.status === "fulfilled" ? metadataResult.value : undefined,
    chapterList:
      chapterListResult.status === "fulfilled"
        ? chapterListResult.value
        : undefined,
    metadataError:
      metadataResult.status === "rejected"
        ? resolvePixivSeriesDataError(metadataResult.reason)
        : undefined,
    chapterListError:
      chapterListResult.status === "rejected"
        ? resolvePixivSeriesDataError(chapterListResult.reason)
        : undefined,
  }
}

const background: ServiceWorkerIntegration = {
  name: "Pixiv Comic Background",
  series: {
    fetchSeriesMetadata: fetchPixivSeriesMetadata,
    fetchChapterList: fetchPixivChapterList,
    resolveSeriesData: resolvePixivSeriesData,
  },
  prepareDispatchContext: (input) =>
    Promise.resolve(preparePixivDispatchContext(input.taskId)),
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: "pixiv-comic",
  background,
}
