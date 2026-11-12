import type { ChapterArchiveMetadata, ChapterStatus } from "@/src/types/chapter"
import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"

export interface ChapterState extends ChapterArchiveMetadata {
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
  /** A site catalog section such as collected volumes or extras. */
  isCategory?: true
}

export interface MangaPageState {
  /** Exact series-page URL that produced this snapshot. */
  sourceUrl: string
  siteIntegrationId: string
  mangaId: string
  seriesTitle: string
  chapters: ChapterState[]
  volumes: VolumeState[]
  metadata?: SeriesMetadataSnapshot
  chaptersLoading?: boolean
  chapterListNotice?: "adult-consent-required"
  lastUpdated: number
}

export interface LoadingTabContext {
  loading: true
  /** URL matched to an enabled integration while resolving the series. */
  sourceUrl?: string
}

export interface TabContextError {
  error: string
  sourceUrl?: string
}

export type ProjectedTabContext =
  MangaPageState | LoadingTabContext | TabContextError | null

export interface WindowTabContext {
  windowId: number
  activeTabId: number
  context: ProjectedTabContext
  revision: number
  timestamp: number
}

export type ActiveTabContextByWindow = Record<number, WindowTabContext>
