import type {
  BackgroundSiteAdapter,
  SeriesDataResolutionResult,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import logger from "@/src/runtime/logger"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { resolveSeriesDataViaOffscreen } from "@/src/runtime/resolve-series-data-offscreen"
import { MANHUAGUI_PAGE_HOSTS, parseSeriesIdFromPath } from "./shared"
import { MANHUAGUI_CREDENTIAL_POLICY } from "./policy"
import { ManhuaguiPageProbeDataSchema } from "./contracts/page-probe"
import type { RateLimitService } from "@/src/runtime/rate-limit"

function readManhuaguiLiveChapterHtml(
  pageProbeData: unknown
): string | undefined {
  if (pageProbeData === undefined) return undefined
  const data = ManhuaguiPageProbeDataSchema.parse(pageProbeData)
  if (data.adultGatePresent === true) return undefined
  const chapterHtml = data.chapterHtml
  if (
    typeof chapterHtml !== "string" ||
    chapterHtml.length === 0 ||
    chapterHtml.length > 512_000
  ) {
    return undefined
  }
  return chapterHtml
}

async function resolveManhuaguiSeriesData(input: {
  seriesUrl: string
  seriesId?: string
  language?: string
  pageProbeData?: unknown
  signal?: AbortSignal
  rateLimitService: RateLimitService
}): Promise<SeriesDataResolutionResult> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(input.seriesUrl)
  } catch {
    throw new Error("Invalid Manhuagui series URL")
  }

  if (
    parsedUrl.protocol !== "https:" ||
    !MANHUAGUI_PAGE_HOSTS.has(parsedUrl.hostname)
  ) {
    throw new Error("Manhuagui URL must use a trusted manhuagui.com origin")
  }

  const seriesId = input.seriesId ?? parseSeriesIdFromPath(parsedUrl.pathname)
  if (!seriesId) {
    throw new Error(
      "Manhuagui series URL must match /comic/{id} or include a seriesId"
    )
  }

  const liveChapterHtml = readManhuaguiLiveChapterHtml(input.pageProbeData)
  logger.debug("[manhuagui] Resolving series data", {
    seriesId,
    hasLiveChapterHtml: !!liveChapterHtml,
  })

  const response = await integrationHttpClient.request({
    integrationId: "manhuagui",
    endpointId: "manhuagui-series-html",
    url: input.seriesUrl,
    scope: "chapter",
    init: {
      credentials: MANHUAGUI_CREDENTIAL_POLICY.pageHtml,
      signal: input.signal,
    },
    rateLimitService: input.rateLimitService,
  })
  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Manhuagui series page could not be loaded (HTTP ${response.status}).`
      ),
      { status: response.status }
    )
  }

  const { html } = await decodeHtmlResponse(response)
  logger.debug("[manhuagui] Parsing fetched series HTML", { seriesId })
  const resolved = await resolveSeriesDataViaOffscreen({
    siteIntegrationId: "manhuagui",
    seriesUrl: input.seriesUrl,
    html,
    language: input.language,
    signal: input.signal,
    rateLimitService: input.rateLimitService,
  })

  if (!liveChapterHtml) {
    logger.debug("[manhuagui] Returning fetched chapter list", { seriesId })
    return {
      ...resolved,
      seriesId,
      ...(input.pageProbeData !== undefined &&
      ManhuaguiPageProbeDataSchema.parse(input.pageProbeData)
        .adultGatePresent === true
        ? { chapterListNotice: "adult-consent-required" as const }
        : {}),
    }
  }

  // The fetched response supplies stable metadata. Only replace its empty
  // server-rendered chapter list with chapter elements the user can already
  // see after completing Manhuagui's own adult gate.
  const liveResolved = await resolveSeriesDataViaOffscreen({
    siteIntegrationId: "manhuagui",
    seriesUrl: input.seriesUrl,
    html: liveChapterHtml,
    language: input.language,
    signal: input.signal,
    rateLimitService: input.rateLimitService,
  })
  const liveChapterList = liveResolved.chapterList as
    { chapters?: unknown[] } | undefined
  if (Array.isArray(liveChapterList?.chapters)) {
    logger.debug("[manhuagui] Returning live page chapter list", {
      seriesId,
      chapterCount: liveChapterList.chapters.length,
    })
    const stableResolved = { ...resolved }
    delete stableResolved.chapterListNotice
    return {
      ...stableResolved,
      seriesId,
      chapterList: liveResolved.chapterList,
      chapterListError: liveResolved.chapterListError,
    }
  }
  return { ...resolved, seriesId }
}

const background: ServiceWorkerIntegration = {
  name: "Manhuagui Background",
  series: {
    resolveSeriesData: resolveManhuaguiSeriesData,
  },
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: "manhuagui",
  background,
}
