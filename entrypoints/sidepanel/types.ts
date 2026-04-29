/**
 * Side Panel Types
 * 
 * These types define the UI state for the Command Center Side Panel.
 */

import type { ChapterState } from '@/src/types/tab-state'

export interface SidePanelChapter {
  id: string
  title: string
  index: number // 1-based index from site integration extraction order
  chapterLabel?: string
  chapterNumber?: number
  volumeNumber?: number
  locked?: boolean
  selected: boolean
  url: string
  status: ChapterState['status']
}

export interface Volume {
  number: number
  title: string
  chapters: SidePanelChapter[]
  collapsed: boolean
  groupId: string
}

export interface StandaloneChapter extends SidePanelChapter {
  isStandalone: true
}

export type VolumeOrChapter = Volume | StandaloneChapter
