import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"
import type { VolumeState } from "@/src/types/tab-state"

export interface ResolvedTabReadyContext {
  context: "ready"
  sourceUrl: string
  siteIntegrationId: string
  mangaId: string
  seriesTitle: string
  chapters: Array<{
    id: string
    url: string
    title: string
    locked?: boolean
    chapterLabel?: string
    chapterNumber?: number
    volumeId?: string
    volumeNumber?: number
    volumeLabel?: string
    language?: string
  }>
  volumes?: VolumeState[]
  metadata?: SeriesMetadataSnapshot
  chaptersLoading?: boolean
  chapterListNotice?: "adult-consent-required"
}

export interface ResolvedTabUnsupportedContext {
  context: "unsupported"
}

export interface ResolvedTabErrorContext {
  context: "error"
  error: string
}

export type ResolvedTabContext =
  | ResolvedTabReadyContext
  | ResolvedTabUnsupportedContext
  | ResolvedTabErrorContext
