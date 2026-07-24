import { useCallback, useRef } from "react"
import type { VolumeOrChapter, SidePanelChapter } from "../types"

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

function getAllChapters(items: VolumeOrChapter[]): SidePanelChapter[] {
  const chapters: SidePanelChapter[] = []
  items.forEach((item) => {
    if ("chapters" in item) {
      chapters.push(...item.chapters)
    } else {
      chapters.push(item)
    }
  })
  return chapters
}

/**
 * Compute the next set of selected chapter IDs after applying a selection
 * change to the given chapter IDs. Locked chapters are always excluded.
 */
function computeNextSelectedIds(
  currentSelected: Set<string>,
  targetIds: string[],
  selected: boolean
): string[] {
  const next = new Set(currentSelected)
  for (const id of targetIds) {
    if (selected) {
      next.add(id)
    } else {
      next.delete(id)
    }
  }
  return Array.from(next)
}

export function useSelection({
  items,
  setSelectedChapterIds,
  setCollapsedGroups,
  tabId,
  isDownloading,
}: UseSelectionOptions): UseSelectionReturn {
  const lastClickedIndexRef = useRef<number>(-1)

  const handleChapterSelect = useCallback(
    (chapterId: string, checked: boolean, isShiftClick = false) => {
      if (isDownloading || tabId == null) return

      const allChapters = getAllChapters(items)
      const clickedIndex = allChapters.findIndex((ch) => ch.id === chapterId)

      if (clickedIndex === -1) return
      if (allChapters[clickedIndex].locked === true) return

      let chapterIdsToUpdate: string[]

      if (isShiftClick && lastClickedIndexRef.current !== -1) {
        const start = Math.min(lastClickedIndexRef.current, clickedIndex)
        const end = Math.max(lastClickedIndexRef.current, clickedIndex)
        chapterIdsToUpdate = allChapters
          .slice(start, end + 1)
          .filter((ch) => ch.locked !== true)
          .map((ch) => ch.id)
      } else {
        chapterIdsToUpdate = [allChapters[clickedIndex].id]
        lastClickedIndexRef.current = clickedIndex
      }

      if (chapterIdsToUpdate.length === 0) return

      // Compute next selected IDs from current items state
      const currentSelected = new Set(
        allChapters
          .filter((ch) => ch.selected && ch.locked !== true)
          .map((ch) => ch.id)
      )
      const nextIds = computeNextSelectedIds(
        currentSelected,
        chapterIdsToUpdate,
        checked
      )
      setSelectedChapterIds(nextIds)
    },
    [isDownloading, items, setSelectedChapterIds, tabId]
  )

  const handleSelectAll = useCallback(
    (forceSelect?: boolean | "indeterminate") => {
      if (isDownloading || tabId == null) return

      const allChapters = getAllChapters(items)
      const selectableChapters = allChapters.filter((ch) => ch.locked !== true)
      const allSelected =
        selectableChapters.length > 0 &&
        selectableChapters.every((ch) => ch.selected)
      // If forceSelect is a boolean, use it; otherwise toggle (ignore 'indeterminate')
      const newSelected =
        typeof forceSelect === "boolean" ? forceSelect : !allSelected

      const chapterIdsToUpdate = selectableChapters.map((ch) => ch.id)

      if (chapterIdsToUpdate.length === 0) return

      const currentSelected = new Set(
        allChapters
          .filter((ch) => ch.selected && ch.locked !== true)
          .map((ch) => ch.id)
      )
      const nextIds = computeNextSelectedIds(
        currentSelected,
        chapterIdsToUpdate,
        newSelected
      )
      setSelectedChapterIds(nextIds)
    },
    [isDownloading, items, setSelectedChapterIds, tabId]
  )

  const handleVolumeToggle = useCallback(
    (groupId: string) => {
      if (isDownloading || tabId == null) return

      setCollapsedGroups((prev) => {
        const next = new Set(prev)
        if (next.has(groupId)) {
          next.delete(groupId)
        } else {
          next.add(groupId)
        }
        return next
      })
    },
    [isDownloading, setCollapsedGroups, tabId]
  )

  const handleVolumeSelectAll = useCallback(
    (groupId: string) => {
      if (isDownloading || tabId == null) return

      const volume = items.find(
        (item) => "chapters" in item && item.groupId === groupId
      )
      if (!volume || !("chapters" in volume)) return

      const selectableChapters = volume.chapters.filter(
        (ch) => ch.locked !== true
      )
      const allSelected =
        selectableChapters.length > 0 &&
        selectableChapters.every((ch) => ch.selected)
      const newSelected = !allSelected

      const chapterIdsToUpdate = selectableChapters.map((ch) => ch.id)

      if (chapterIdsToUpdate.length === 0) return

      const allChapters = getAllChapters(items)
      const currentSelected = new Set(
        allChapters
          .filter((ch) => ch.selected && ch.locked !== true)
          .map((ch) => ch.id)
      )
      const nextIds = computeNextSelectedIds(
        currentSelected,
        chapterIdsToUpdate,
        newSelected
      )
      setSelectedChapterIds(nextIds)
    },
    [isDownloading, items, setSelectedChapterIds, tabId]
  )

  return {
    handleChapterSelect,
    handleSelectAll,
    handleVolumeToggle,
    handleVolumeSelectAll,
  }
}
