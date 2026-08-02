import type {
  BackgroundIntegration,
  ParseImageUrlsFromHtmlInput,
  RuntimeSiteIntegration,
} from "../../types/site-integrations"
import { prepareMangadexDispatchContext } from "../mangadex-dispatch-context"
import {
  downloadMangadexChapterImage,
  parseMangadexImageUrlsFromHtml,
  processMangadexImageUrls,
  resolveMangadexChapterImageUrls,
} from "./chapter-api"
import {
  fetchMangadexChapterList,
  fetchMangadexSeriesMetadata,
} from "./series-api"

export type { MangadexUserPreferences } from "./preferences"

export const mangadexBackgroundIntegration: BackgroundIntegration = {
  name: "MangaDex API Background",
  series: {
    fetchSeriesMetadata: (seriesId, _language, signal) =>
      fetchMangadexSeriesMetadata(seriesId, "resilient", signal),
    fetchChapterList: (seriesId, language, signal) =>
      fetchMangadexChapterList(
        seriesId,
        language,
        undefined,
        "resilient",
        signal
      ),
  },
  async prepareDispatchContext(
    input
  ): Promise<Record<string, unknown> | undefined> {
    return prepareMangadexDispatchContext({ seriesKey: input.seriesKey })
  },
  chapter: {
    async resolveImageUrls(
      chapter: { id: string; url: string },
      context?: Record<string, unknown>
    ): Promise<string[]> {
      return resolveMangadexChapterImageUrls(chapter, context)
    },

    async parseImageUrlsFromHtml(
      input: ParseImageUrlsFromHtmlInput
    ): Promise<string[]> {
      return parseMangadexImageUrlsFromHtml(input)
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      return processMangadexImageUrls(urls)
    },

    async downloadImage(
      imageUrl: string,
      opts?: {
        signal?: AbortSignal
        context?: Record<string, unknown>
        onBytesReceived?: (bytesReceived: number) => void | Promise<void>
      }
    ): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
      return downloadMangadexChapterImage(imageUrl, opts)
    },
  },
}

export const mangadexIntegration = {
  id: "mangadex",
  background: mangadexBackgroundIntegration,
} satisfies RuntimeSiteIntegration
