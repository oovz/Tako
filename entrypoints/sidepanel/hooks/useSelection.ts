import { useCallback, useRef } from 'react'
import type { VolumeOrChapter, SidePanelChapter } from '../types'

interface UseSelectionOptions {
  items: VolumeOrChapter[]
  setItems: (items: VolumeOrChapter[]) => void
  tabId: number | undefined
  isDownloading: boolean
}

interface UseSelectionReturn {
  handleChapterSelect: (chapterId: string, checked: boolean, isShiftClick?: boolean) => void
  handleSelectAll: (forceSelect?: boolean | 'indeterminate') => void
  handleVolumeToggle: (groupId: string) => void
  handleVolumeSelectAll: (groupId: string) => void
}

function getAllChapters(items: VolumeOrChapter[]): SidePanelChapter[] {
  const chapters: SidePanelChapter[] = []
  items.forEach(item => {
    if ('chapters' in item) {
      chapters.push(...item.chapters)
    } else {
      chapters.push(item)
    }
  })
  return chapters
}

function applySelectionToItems(
  items: VolumeOrChapter[],
  chapterIds: Set<string>,
  selected: boolean,
): VolumeOrChapter[] {
  return items.map((item) => {
    if ('chapters' in item) {
      return {
        ...item,
        chapters: item.chapters.map((chapter) => {
          if (chapter.locked === true) {
            return chapter.selected ? { ...chapter, selected: false } : chapter
          }

          return chapterIds.has(chapter.id) ? { ...chapter, selected } : chapter
        }),
      }
    }

    if (item.locked === true) {
      return item.selected ? { ...item, selected: false } : item
    }

    return chapterIds.has(item.id) ? { ...item, selected } : item
  })
}

export function __applySelectionToItemsForTests(
  items: VolumeOrChapter[],
  chapterIds: Set<string>,
  selected: boolean,
): VolumeOrChapter[] {
  return applySelectionToItems(items, chapterIds, selected)
}

export function useSelection({ items, setItems, tabId, isDownloading }: UseSelectionOptions): UseSelectionReturn {
  const lastClickedIndexRef = useRef<number>(-1)
  
  // Bug #4 fix: Use refs to keep callbacks stable while accessing latest values
  // This prevents ChapterRow re-renders when items/tabId/isDownloading change
  const itemsRef = useRef(items)
  const setItemsRef = useRef(setItems)
  const tabIdRef = useRef(tabId)
  const isDownloadingRef = useRef(isDownloading)
  
  // Keep refs in sync with latest values
  itemsRef.current = items
  setItemsRef.current = setItems
  tabIdRef.current = tabId
  isDownloadingRef.current = isDownloading
  
  const handleChapterSelect = useCallback((chapterId: string, checked: boolean, isShiftClick = false) => {
    if (isDownloadingRef.current || tabIdRef.current == null) return
    
    const allChapters = getAllChapters(itemsRef.current)
    const clickedIndex = allChapters.findIndex(ch => ch.id === chapterId)
    
    if (clickedIndex === -1) return
    if (allChapters[clickedIndex].locked === true) return
    
    let chapterIdsToUpdate: string[]
    
    if (isShiftClick && lastClickedIndexRef.current !== -1) {
      const start = Math.min(lastClickedIndexRef.current, clickedIndex)
      const end = Math.max(lastClickedIndexRef.current, clickedIndex)
      chapterIdsToUpdate = allChapters
        .slice(start, end + 1)
        .filter(ch => ch.locked !== true)
        .map(ch => ch.id)
    } else {
      chapterIdsToUpdate = [allChapters[clickedIndex].id]
      lastClickedIndexRef.current = clickedIndex
    }

    if (chapterIdsToUpdate.length === 0) return

    const updatedItems = applySelectionToItems(itemsRef.current, new Set(chapterIdsToUpdate), checked)
    setItemsRef.current(updatedItems)
  }, []) // Empty deps - uses refs for stable callback
  
  const handleSelectAll = useCallback((forceSelect?: boolean | 'indeterminate') => {
    if (isDownloadingRef.current || tabIdRef.current == null) return
    
    const allChapters = getAllChapters(itemsRef.current)
    const selectableChapters = allChapters.filter(ch => ch.locked !== true)
    const allSelected = selectableChapters.length > 0 && selectableChapters.every(ch => ch.selected)
    // If forceSelect is a boolean, use it; otherwise toggle (ignore 'indeterminate')
    const newSelected = typeof forceSelect === 'boolean' ? forceSelect : !allSelected
    
    const chapterIdsToUpdate = selectableChapters.map(ch => ch.id)

    if (chapterIdsToUpdate.length === 0) return

    const updatedItems = applySelectionToItems(itemsRef.current, new Set(chapterIdsToUpdate), newSelected)

    setItemsRef.current(updatedItems)
  }, []) // Empty deps - uses refs for stable callback
  
  const handleVolumeToggle = useCallback((groupId: string) => {
    const updatedItems = itemsRef.current.map(item => {
      if ('chapters' in item && item.groupId === groupId) {
        return { ...item, collapsed: !item.collapsed }
      }
      return item
    })
    setItemsRef.current(updatedItems)
  }, []) // Empty deps - uses refs for stable callback
  
  const handleVolumeSelectAll = useCallback((groupId: string) => {
    if (isDownloadingRef.current || tabIdRef.current == null) return
    
    const volume = itemsRef.current.find(item => 'chapters' in item && item.groupId === groupId)
    if (!volume || !('chapters' in volume)) return
    
    const selectableChapters = volume.chapters.filter(ch => ch.locked !== true)
    const allSelected = selectableChapters.length > 0 && selectableChapters.every(ch => ch.selected)
    const newSelected = !allSelected
    
    const chapterIdsToUpdate = selectableChapters.map(ch => ch.id)

    if (chapterIdsToUpdate.length === 0) return

    const updatedItems = applySelectionToItems(itemsRef.current, new Set(chapterIdsToUpdate), newSelected)

    setItemsRef.current(updatedItems)
  }, []) // Empty deps - uses refs for stable callback
  
  return {
    handleChapterSelect,
    handleSelectAll,
    handleVolumeToggle,
    handleVolumeSelectAll,
  }
}
