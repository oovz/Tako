/**
 * Side Panel Types
 *
 * These types define the UI state for the Command Center Side Panel.
 */

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

/**
 * Presentation state that belongs to a series-specific chapter selection
 * session. It deliberately lives above the collapsible selector so closing
 * and reopening that region does not discard the user's chosen view or
 * expanded groups.
 */
export type InlineSelectionViewMode = "volumes" | "chapters"

export interface InlineSelectionPresentationState {
  viewMode: InlineSelectionViewMode
  collapsedGroupIds: string[]
}

export type InlineSelectionPresentationBySeries = Record<
  string,
  InlineSelectionPresentationState
>

/**
 * A cancellation request can either complete, already be in flight, or fail.
 * Keeping these states distinct prevents a duplicate click from being
 * presented as an error to the user.
 */
export type CancelTaskResult =
  | { kind: "completed" }
  | { kind: "already-pending" }
  | { kind: "failed"; message: string }
