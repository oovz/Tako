import type { ChapterStatus } from "@/src/types/chapter"
import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"

export interface ChapterState {
  id: string
  url: string
  title: string
  locked?: boolean
  index: number
  language?: string
  chapterLabel?: string
  chapterNumber?: number
  volumeId?: string
  volumeNumber?: number
  volumeLabel?: string
  status: ChapterStatus
  errorMessage?: string
  totalImages?: number
  imagesFailed?: number
  lastUpdated: number
}

export interface VolumeState {
  id: string
  title?: string
  label?: string
}

export interface MangaPageState {
  siteIntegrationId: string
  mangaId: string
  seriesTitle: string
  chapters: ChapterState[]
  volumes: VolumeState[]
  metadata?: SeriesMetadataSnapshot
  lastUpdated: number
}

export type ProjectedTabContext =
  MangaPageState | { loading: true } | { error: string } | null

export interface WindowTabContext {
  windowId: number
  activeTabId: number
  context: ProjectedTabContext
  revision: number
  timestamp: number
}

export type ActiveTabContextByWindow = Record<number, WindowTabContext>
