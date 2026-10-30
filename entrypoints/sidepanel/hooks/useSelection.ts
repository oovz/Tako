import { useCallback, useRef } from "react"
import type { VolumeOrChapter } from "../types"
import {
  getAllChapters,
  getChapterSelectionChange,
  getBulkSelectionChange,
  getVolumeSelectionChange,
  toggleCollapsedGroup,
} from "./useSelection-model"

interface UseSelectionOptions {
  items: VolumeOrChapter[]
  setSelectedChapterIds: (chapterIds: string[]) => void
  setCollapsedGroups: (updater: (prev: Set<string>) => Set<string>) => void
  tabId: number | undefined
  isDownloading: boolean
}

interface UseSelectionReturn {
  handleChapterSelect: (
    chapterId: string,
    checked: boolean,
    isShiftClick?: boolean
  ) => void
  handleSelectAll: (forceSelect?: boolean | "indeterminate") => void
  handleVolumeToggle: (groupId: string) => void
  handleVolumeSelectAll: (groupId: string) => void
}

export function useSelection({
  items,
  setSelectedChapterIds,
  setCollapsedGroups,
  tabId,
  isDownloading,
}: UseSelectionOptions): UseSelectionReturn {
  const lastClickedIndexRef = useRef(-1)
  const canSelect = !isDownloading && tabId != null

  const handleChapterSelect = useCallback(
    (chapterId: string, checked: boolean, isShiftClick = false) => {
      if (!canSelect) return
      const change = getChapterSelectionChange(
        getAllChapters(items),
        chapterId,
        checked,
        isShiftClick,
        lastClickedIndexRef.current
      )
      if (!change) return
      lastClickedIndexRef.current = change.anchorIndex
      setSelectedChapterIds(change.selectedIds)
    },
    [canSelect, items, setSelectedChapterIds]
  )

  const handleSelectAll = useCallback(
    (forceSelect?: boolean | "indeterminate") => {
      if (!canSelect) return
      const chapters = getAllChapters(items)
      const next = getBulkSelectionChange(chapters, chapters, forceSelect)
      if (next) setSelectedChapterIds(next)
    },
    [canSelect, items, setSelectedChapterIds]
  )

  const handleVolumeToggle = useCallback(
    (groupId: string) => {
      if (canSelect)
        setCollapsedGroups((previous) =>
          toggleCollapsedGroup(previous, groupId)
        )
    },
    [canSelect, setCollapsedGroups]
  )

  const handleVolumeSelectAll = useCallback(
    (groupId: string) => {
      if (!canSelect) return
      const next = getVolumeSelectionChange(items, groupId)
      if (next) setSelectedChapterIds(next)
    },
    [canSelect, items, setSelectedChapterIds]
  )

  return {
    handleChapterSelect,
    handleSelectAll,
    handleVolumeToggle,
    handleVolumeSelectAll,
  }
}
