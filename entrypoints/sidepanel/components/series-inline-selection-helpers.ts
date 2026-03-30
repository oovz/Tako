import type { VolumeOrChapter } from '@/entrypoints/sidepanel/types'

export interface InlineSelectionViewSummary {
  chapterCount: number
  volumeCount: number
  canToggleView: boolean
}

export function syncInlineSelectionItems(
  items: VolumeOrChapter[],
  selectedChapterIds: string[],
  previousItems: VolumeOrChapter[] = [],
): VolumeOrChapter[] {
  const selectedSet = new Set(selectedChapterIds)
  const previousCollapsedState = new Map<string, boolean>()

  previousItems.forEach((item) => {
    if ('chapters' in item) {
      previousCollapsedState.set(item.groupId, item.collapsed)
    }
  })

  return items.map((item) => {
    if ('chapters' in item) {
      return {
        ...item,
        // Preserve the user's collapse choice for known groups and expand new groups by default.
        collapsed: previousCollapsedState.get(item.groupId) ?? false,
        chapters: item.chapters.map((chapter) => ({
          ...chapter,
          selected: chapter.locked === true ? false : selectedSet.has(chapter.id),
        })),
      }
    }

    return {
      ...item,
      selected: item.locked === true ? false : selectedSet.has(item.id),
    }
  })
}

export function getExpandedGroupKeys(items: VolumeOrChapter[]): Set<string> {
  return new Set(
    items.flatMap((item) => ('chapters' in item && !item.collapsed ? [item.groupId] : [])),
  )
}

export function getInlineSelectionViewSummary(items: VolumeOrChapter[]): InlineSelectionViewSummary {
  let chapterCount = 0
  let volumeCount = 0

  items.forEach((item) => {
    if ('chapters' in item) {
      volumeCount += 1
      chapterCount += item.chapters.length
      return
    }

    chapterCount += 1
  })

  return {
    chapterCount,
    volumeCount,
    canToggleView: volumeCount > 0,
  }
}
