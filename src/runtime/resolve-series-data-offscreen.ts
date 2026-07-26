import type { SeriesDataResolutionResult } from "@/src/types/site-integrations"
import type { OffscreenParseSeriesHtmlResponse } from "@/src/types/offscreen-messages"
import { ensureOffscreenDocumentReady } from "@/entrypoints/background/offscreen-lifecycle"

export interface ResolveSeriesDataViaOffscreenInput {
  siteIntegrationId: string
  seriesUrl: string
  html: string
  language?: string
}

/**
 * Ask the offscreen document to parse a fetched series page HTML using the
 * integration's DOM-based resolver.
 */
export async function resolveSeriesDataViaOffscreen(
  input: ResolveSeriesDataViaOffscreenInput
): Promise<SeriesDataResolutionResult> {
  await ensureOffscreenDocumentReady()

  const response: OffscreenParseSeriesHtmlResponse | undefined =
    await chrome.runtime.sendMessage({
      type: "OFFSCREEN_PARSE_SERIES_HTML",
      payload: {
        siteIntegrationId: input.siteIntegrationId,
        seriesUrl: input.seriesUrl,
        html: input.html,
        language: input.language,
      },
    })

  if (!response) {
    throw new Error("No response from offscreen series HTML parser")
  }

  if (response.success === false) {
    throw new Error(response.error ?? "Offscreen series HTML parse failed")
  }

  return {
    seriesMetadata:
      response.seriesMetadata as SeriesDataResolutionResult["seriesMetadata"],
    chapterList: response.chapterList,
    metadataError: response.metadataError,
    chapterListError: response.chapterListError,
    chapterListNotice: response.chapterListNotice,
  }
}
