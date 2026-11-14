import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { preparePixivDispatchContext } from "./background-context"
import type { PixivDispatchContext } from "./contracts/dispatch-context"
import { fetchPixivChapterList, fetchPixivSeriesMetadata } from "./series-api"
import { parseWorkIdFromUrl } from "./page-context"
import { PIXIV_BASE_URL } from "./shared"
import type { RateLimitService } from "@/src/runtime/rate-limit"

function resolvePixivSeriesDataError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function resolvePixivSeriesData(input: {
  seriesUrl: string
  seriesId?: string
  language?: string
  signal?: AbortSignal
  rateLimitService: RateLimitService
}): Promise<SeriesDataResolutionResult> {
  const workId = input.seriesId ?? parseWorkIdFromUrl(input.seriesUrl)
  if (!workId) {
    throw new Error("Could not determine Pixiv work ID from series URL")
  }

  const [metadataResult, chapterListResult] = await Promise.allSettled([
    fetchPixivSeriesMetadata(
      workId,
      input.rateLimitService,
      undefined,
      input.signal
    ),
    fetchPixivChapterList(
      workId,
      input.rateLimitService,
      undefined,
      input.signal
    ),
  ])

  const metadata = resolvePixivSeriesPart(metadataResult)
  const chapterList = resolvePixivSeriesPart(chapterListResult)
  return {
    seriesId: workId,
    seriesMetadata: metadata.value,
    chapterList: chapterList.value,
    metadataError: metadata.error,
    chapterListError: chapterList.error,
  }
}

function resolvePixivSeriesPart<T>(result: PromiseSettledResult<T>): {
  value?: T
  error?: string
} {
  return result.status === "fulfilled"
    ? { value: result.value }
    : { error: resolvePixivSeriesDataError(result.reason) }
}

const background: ServiceWorkerIntegration<PixivDispatchContext> = {
  name: "Pixiv Comic Background",
  series: {
    getCatalogOrigin: () => PIXIV_BASE_URL,
    resolveSeriesData: resolvePixivSeriesData,
  },
  prepareDispatchContext: (input) =>
    Promise.resolve(preparePixivDispatchContext(input.taskId)),
}

export const backgroundSiteAdapter: BackgroundSiteAdapter<PixivDispatchContext> =
  {
    background,
  }
