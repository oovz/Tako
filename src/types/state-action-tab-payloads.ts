import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"
import type { VolumeState } from "@/src/types/tab-state"

export interface InitializeTabReadyPayload {
  context: "ready"
  siteIntegrationId: string
  mangaId: string
  seriesTitle: string
  chapters?: Array<{
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

export interface InitializeTabUnsupportedPayload {
  context: "unsupported"
}

export interface InitializeTabErrorPayload {
  context: "error"
  error: string
}

export type InitializeTabPayload =
  | InitializeTabReadyPayload
  | InitializeTabUnsupportedPayload
  | InitializeTabErrorPayload
