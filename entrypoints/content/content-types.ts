import type { SeriesMetadata } from '@/src/types/series-metadata'
import type { SiteIntegration } from '@/src/types/site-integrations'
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
      kind: 'background'
      fetchSeriesMetadata: (seriesId: string, language?: string) => Promise<SeriesMetadata>
      fetchChapterList: (seriesId: string, language?: string) => Promise<unknown>
    }
  | {
      kind: 'content-dom'
    }

export type ContentSiteIntegration = SiteIntegration
