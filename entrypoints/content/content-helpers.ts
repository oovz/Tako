import type { InitializeTabPayload, InitializeTabReadyPayload } from '@/src/types/state-action-tab-payloads'
import type { GetTabIdResponse } from '@/src/types/runtime-command-messages'
import { isRecord } from '@/src/shared/type-guards'

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

function normalizeRawChapter(value: unknown): InitializeTabRawChapter | null {
  if (!isRecord(value)) {
    return null
  }

  const url = typeof value.url === 'string' ? value.url.trim() : ''
  const title = typeof value.title === 'string' ? value.title.trim() : ''

  if (url.length === 0 || title.length === 0) {
    return null
  }

  return {
    id: typeof value.id === 'string' && value.id.trim().length > 0 ? value.id.trim() : undefined,
    url,
    title,
    locked: value.locked === true,
    chapterLabel: typeof value.chapterLabel === 'string' && value.chapterLabel.trim().length > 0
      ? value.chapterLabel.trim()
      : undefined,
    chapterNumber: typeof value.chapterNumber === 'number' ? value.chapterNumber : undefined,
    volumeNumber: typeof value.volumeNumber === 'number' ? value.volumeNumber : undefined,
    volumeLabel: typeof value.volumeLabel === 'string' && value.volumeLabel.trim().length > 0
      ? value.volumeLabel.trim()
      : undefined,
    language: typeof value.language === 'string' && value.language.trim().length > 0
      ? value.language.trim()
      : undefined,
  }
}

function normalizeRawVolume(value: unknown): InitializeTabRawVolume | null {
  if (!isRecord(value)) {
    return null
  }

  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (id.length === 0) {
    return null
  }

  return {
    id,
    title: typeof value.title === 'string' && value.title.trim().length > 0 ? value.title.trim() : undefined,
    label: typeof value.label === 'string' && value.label.trim().length > 0 ? value.label.trim() : undefined,
  }
}

export function normalizeFetchedSeriesData(result: unknown): NormalizedSeriesData {
  if (Array.isArray(result)) {
    return {
      chapters: result.map(normalizeRawChapter).filter((chapter): chapter is InitializeTabRawChapter => chapter !== null),
      volumes: [],
    }
  }

  if (result && typeof result === 'object' && Array.isArray((result as { chapters?: unknown }).chapters)) {
    const normalizedResult = result as { chapters: unknown[]; volumes?: unknown[] }
    return {
      chapters: normalizedResult.chapters
        .map(normalizeRawChapter)
        .filter((chapter): chapter is InitializeTabRawChapter => chapter !== null),
      volumes: Array.isArray(normalizedResult.volumes)
        ? normalizedResult.volumes
          .map(normalizeRawVolume)
          .filter((volume): volume is InitializeTabRawVolume => volume !== null)
        : [],
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

