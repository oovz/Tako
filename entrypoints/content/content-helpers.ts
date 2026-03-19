import type { InitializeTabPayload, InitializeTabReadyPayload } from '@/src/types/state-action-tab-payloads'
import type { GetTabIdResponse } from '@/src/types/runtime-command-messages'

import type {
  ContentSiteIntegration,
  InitializeTabRawChapter,
  InitializeTabRawVolume,
  NormalizedSeriesData,
  ResolveInitializeTabPayloadInput,
  SeriesDataStrategy,
} from '@/entrypoints/content/content-types'

export function resolvePageReadyHook(
  integration: ContentSiteIntegration,
): (() => Promise<void>) | undefined {
  return integration.content.series.waitForPageReady
}

export function resolveSeriesDataStrategy(
  integration: ContentSiteIntegration,
): SeriesDataStrategy {
  const backgroundSeries = integration.background.series
  if (
    backgroundSeries
    && typeof backgroundSeries.fetchSeriesMetadata === 'function'
    && typeof backgroundSeries.fetchChapterList === 'function'
  ) {
    return {
      kind: 'background',
      fetchSeriesMetadata: (seriesId, language) => backgroundSeries.fetchSeriesMetadata(seriesId, language),
      fetchChapterList: (seriesId, language) => backgroundSeries.fetchChapterList(seriesId, language),
    }
  }

  return { kind: 'content-dom' }
}

export function normalizeFetchedSeriesData(result: unknown): NormalizedSeriesData {
  if (Array.isArray(result)) {
    return {
      chapters: result as InitializeTabRawChapter[],
      volumes: [],
    }
  }

  if (result && typeof result === 'object' && Array.isArray((result as { chapters?: unknown }).chapters)) {
    const normalizedResult = result as { chapters: InitializeTabRawChapter[]; volumes?: InitializeTabRawVolume[] }
    return {
      chapters: normalizedResult.chapters,
      volumes: Array.isArray(normalizedResult.volumes) ? normalizedResult.volumes : [],
    }
  }

  return {
    chapters: [],
    volumes: [],
  }
}

export async function bootstrapContentScript(
  initialize: () => void,
  warmSettings: () => Promise<unknown>,
): Promise<void> {
  initialize()

  try {
    await warmSettings()
  } catch {
    // Ignore settings load error - non-fatal
  }
}

export function scheduleInitialContentInitialization(initialize: () => Promise<void>): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void initialize()
    }, { once: true })
    return
  }

  void initialize()
}

export async function resolveContentTabId(
  requestTabId: () => Promise<GetTabIdResponse>,
): Promise<number | null> {
  try {
    const response = await requestTabId()
    return typeof response?.tabId === 'number' ? response.tabId : null
  } catch {
    return null
  }
}

export function resolveInitializeTabPayload(
  input: ResolveInitializeTabPayloadInput,
): InitializeTabPayload {
  const rawMangaId = typeof input.rawMangaId === 'string' && input.rawMangaId.trim().length > 0
    ? input.rawMangaId.trim()
    : null

  if (!rawMangaId) {
    return { context: 'unsupported' }
  }

  if (input.extractionError) {
    const errorMessage = input.extractionError instanceof Error
      ? input.extractionError.message
      : typeof input.extractionError === 'string'
        ? input.extractionError
        : 'Failed to extract series metadata'
    return {
      context: 'error',
      error: errorMessage || 'Failed to extract series metadata',
    }
  }

  const seriesTitle = typeof input.seriesMetadata?.title === 'string'
    ? input.seriesMetadata.title.trim()
    : ''

  if (!seriesTitle) {
    return {
      context: 'error',
      error: 'Failed to extract series metadata',
    }
  }

  const hasMissingChapterIds = input.chapters.some(
    (chapter) => typeof chapter.id !== 'string' || chapter.id.trim().length === 0,
  )

  if (hasMissingChapterIds) {
    return {
      context: 'error',
      error: 'Failed to extract stable chapter ids',
    }
  }

  const chaptersWithIds = input.chapters as Array<InitializeTabRawChapter & { id: string }>

  const payload: InitializeTabReadyPayload = {
    context: 'ready',
    siteIntegrationId: input.siteIntegrationId,
    mangaId: rawMangaId,
    seriesTitle,
    chapters: chaptersWithIds.map((chapter) => ({
      id: chapter.id,
      url: chapter.url,
      title: chapter.title,
      locked: chapter.locked === true,
      chapterLabel: chapter.chapterLabel,
      chapterNumber: chapter.chapterNumber,
      volumeNumber: chapter.volumeNumber,
      volumeLabel: chapter.volumeLabel,
      language: chapter.language,
    })),
    volumes: input.volumes,
    metadata: input.seriesMetadata,
  }

  return payload
}

