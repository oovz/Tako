import type { SeriesMetadata } from '@/src/types/series-metadata'
import type { ContentSiteAdapter } from '@/src/types/site-integrations'
import type { VolumeState } from '@/src/types/tab-state'

export type ContentScriptInstance = {
  resetPageHiddenFlag?: () => void
  reinitializeMangaState?: () => Promise<void>
}

export type InitializeTabRawChapter = {
  id?: string
  url: string
  title: string
  locked?: boolean
  chapterLabel?: string
  chapterNumber?: number
  volumeId?: string
  volumeNumber?: number
  volumeLabel?: string
  language?: string
}

export type InitializeTabRawVolume = VolumeState

export type ResolveInitializeTabPayloadInput = {
  siteIntegrationId: string
  rawMangaId: string | null
  chapters: InitializeTabRawChapter[]
  volumes?: InitializeTabRawVolume[]
  seriesMetadata?: SeriesMetadata
  extractionError?: unknown
}

export type NormalizedSeriesData = {
  chapters: InitializeTabRawChapter[]
  volumes: InitializeTabRawVolume[]
}

export type ContentScriptGlobal = typeof globalThis & {
  __takoContentScriptInstance?: ContentScriptInstance
}

export type SeriesDataStrategy =
  | {
      kind: 'background-message'
      fetchSeriesData: (seriesId: string, language?: string) => Promise<BackgroundSeriesDataResponse>
    }
  | {
      kind: 'content-dom'
    }

export type BackgroundSeriesDataResponse = {
  seriesMetadata?: SeriesMetadata
  chapterList?: unknown
  metadataError?: string
  chapterListError?: string
}

export type RequestBackgroundSeriesData = (
  siteIntegrationId: string,
  seriesId: string,
  language?: string,
) => Promise<BackgroundSeriesDataResponse>

export type ContentSiteIntegration = ContentSiteAdapter
