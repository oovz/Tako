/**
 * Side Panel Types
 *
 * These types define the UI state for the Command Center Side Panel.
 */

import type { DownloadedChapterRecord } from "@/src/domain/history/types"
import type { ChapterState } from "@/src/types/tab-state"

export interface SidePanelChapter {
  id: string
  title: string
  index: number // 1-based index from site integration extraction order
  chapterLabel?: string
  chapterNumber?: number
  volumeId?: string
  volumeNumber?: number
  volumeLabel?: string
  locked?: boolean
  downloaded?: boolean
  outputDestination?: DownloadedChapterRecord["outputDestination"]
  saveConfirmedAt?: DownloadedChapterRecord["saveConfirmedAt"]
  selected: boolean
  url: string
  status: ChapterState["status"]
}

export interface Volume {
  number?: number
  title: string
  chapters: SidePanelChapter[]
  collapsed: boolean
  groupId: string
}

export interface StandaloneChapter extends SidePanelChapter {
  isStandalone: true
}

export type VolumeOrChapter = Volume | StandaloneChapter

/** Series selection presentation persists while the selector is collapsed. */
export type InlineSelectionViewMode = "volumes" | "chapters"

export interface InlineSelectionPresentationState {
  viewMode: InlineSelectionViewMode
  collapsedGroupIds: string[]
}

export type InlineSelectionPresentationBySeries = Record<
  string,
  InlineSelectionPresentationState
>

/** Repeated cancellation clicks report pending work separately from failure. */
export type CancelTaskResult =
  | { kind: "completed" }
  | { kind: "already-pending" }
  | { kind: "failed"; message: string }
