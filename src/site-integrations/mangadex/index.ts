import type {
  BackgroundIntegration,
  ContentScriptIntegration,
  ParseImageUrlsFromHtmlInput,
  SiteIntegration,
} from '../../types/site-integrations'
import logger from '@/src/runtime/logger'
import { prepareMangadexDispatchContext } from '../mangadex-dispatch-context'
import { parseUuidFromPath } from './api'
import {
  cacheMangadexPreferencesForSeries,
} from './preferences'
import {
  downloadMangadexChapterImage,
  parseMangadexImageUrlsFromHtml,
  processMangadexImageUrls,
  resolveMangadexChapterImageUrls,
} from './chapter-api'
import { fetchMangadexChapterList, fetchMangadexSeriesMetadata } from './series-api'

export type { MangadexUserPreferences } from './preferences'
export {
  getCachedMangadexPreferences,
  readMangadexUserPreferences,
  setCachedMangadexPreferences,
} from './preferences'

const mangadexContentIntegration: ContentScriptIntegration = {
  name: 'MangaDex API Content',
  series: {
    getSeriesId(): string {
      const id = parseUuidFromPath(window.location.pathname, 'title')
      if (!id) {
        throw new Error(`Failed to extract series ID from URL: ${window.location.pathname}`)
      }

      void cacheMangadexPreferencesForSeries(id).catch((error) => {
        logger.debug('[mangadex] Failed to cache localStorage preferences for series', error)
      })
      return id
    },
  },
}

const mangadexBackgroundIntegration: BackgroundIntegration = {
  name: 'MangaDex API Background',
  series: {
    fetchSeriesMetadata: fetchMangadexSeriesMetadata,
    fetchChapterList: fetchMangadexChapterList,
  },
  async prepareDispatchContext(input): Promise<Record<string, unknown> | undefined> {
    return prepareMangadexDispatchContext({ seriesKey: input.seriesKey })
  },
  chapter: {
    async resolveImageUrls(
      chapter: { id: string; url: string },
      context?: Record<string, unknown>,
    ): Promise<string[]> {
      return resolveMangadexChapterImageUrls(chapter, context)
    },

    async parseImageUrlsFromHtml(input: ParseImageUrlsFromHtmlInput): Promise<string[]> {
      return parseMangadexImageUrlsFromHtml(input)
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      return processMangadexImageUrls(urls)
    },

    async downloadImage(
      imageUrl: string,
      opts?: { signal?: AbortSignal; context?: Record<string, unknown> },
    ): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
      return downloadMangadexChapterImage(imageUrl, opts)
    },
  },
}

export const mangadexIntegration: SiteIntegration = {
  id: 'mangadex',
  content: mangadexContentIntegration,
  background: mangadexBackgroundIntegration,
}

