import type {
  InlineSelectionPresentationBySeries,
  InlineSelectionPresentationState,
  VolumeOrChapter,
  SidePanelChapter,
} from "@/entrypoints/sidepanel/types"

export interface InlineSelectionViewSummary {
  chapterCount: number
  volumeCount: number
  canToggleView: boolean
}

const DEFAULT_PRESENTATION: InlineSelectionPresentationState = {
  viewMode: "volumes",
  collapsedGroupIds: [],
}

export function getInlineSelectionPresentation(
  presentationBySeries: InlineSelectionPresentationBySeries,
  seriesKey: string | undefined
): InlineSelectionPresentationState {
  if (!seriesKey) return DEFAULT_PRESENTATION
  return presentationBySeries[seriesKey] ?? DEFAULT_PRESENTATION
}

/**
 * Apply a series-specific selector presentation update without touching other
 * series. The parent-held map survives the selector's Collapsible unmount.
 */
export function updateInlineSelectionPresentation(
  previousBySeries: InlineSelectionPresentationBySeries,
  seriesKey: string | undefined,
  update: (
    previous: InlineSelectionPresentationState
  ) => InlineSelectionPresentationState
): InlineSelectionPresentationBySeries {
  if (!seriesKey) return previousBySeries

  const previous = previousBySeries[seriesKey] ?? DEFAULT_PRESENTATION
  const next = update(previous)
  if (next === previous) return previousBySeries
  return { ...previousBySeries, [seriesKey]: next }
}

/**
 * Apply selected chapter IDs to the raw items. Collapse state remains
 * separate so toggling a group does not rebuild the chapter list.
 */
export function buildInlineSelectionItems(
  items: VolumeOrChapter[],
  selectedChapterIds: string[]
): VolumeOrChapter[] {
  const selectedSet = new Set(selectedChapterIds)

  return items.map((item) => {
    if ("chapters" in item) {
      return {
        ...item,
        chapters: item.chapters.map((chapter) => ({
          ...chapter,
          selected:
            chapter.locked === true ? false : selectedSet.has(chapter.id),
        })),
      }
    }

    return {
      ...item,
      selected: item.locked === true ? false : selectedSet.has(item.id),
    }
  })
}

export function getExpandedGroupKeys(
  items: VolumeOrChapter[],
  collapsedGroups: ReadonlySet<string>
): Set<string> {
  return new Set(
    items.flatMap((item) =>
      "chapters" in item && !collapsedGroups.has(item.groupId)
        ? [item.groupId]
        : []
    )
  )
}

export function getInlineSelectionViewSummary(
  items: VolumeOrChapter[]
): InlineSelectionViewSummary {
  let chapterCount = 0
  let volumeCount = 0

  items.forEach((item) => {
    if ("chapters" in item) {
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

export function getInlineSelectionChapters(
  items: VolumeOrChapter[]
): SidePanelChapter[] {
  return items.flatMap((item) => ("chapters" in item ? item.chapters : [item]))
}

export function getInlineSelectionCounts(chapters: SidePanelChapter[]): {
  selectedCount: number
  selectableCount: number
} {
  const selectable = chapters.filter((chapter) => chapter.locked !== true)
  return {
    selectedCount: selectable.filter((chapter) => chapter.selected).length,
    selectableCount: selectable.length,
  }
}

export function updateCollapsedInlineGroups(
  previous: InlineSelectionPresentationState,
  updater: (previous: Set<string>) => Set<string>
): InlineSelectionPresentationState {
  const collapsedGroupIds = [...updater(new Set(previous.collapsedGroupIds))]
  const isUnchanged =
    collapsedGroupIds.length === previous.collapsedGroupIds.length &&
    collapsedGroupIds.every(
      (groupId, index) => groupId === previous.collapsedGroupIds[index]
    )
  return isUnchanged ? previous : { ...previous, collapsedGroupIds }
}
