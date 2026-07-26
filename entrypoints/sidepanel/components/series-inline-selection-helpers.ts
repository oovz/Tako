import type {
  InlineSelectionPresentationBySeries,
  InlineSelectionPresentationState,
  VolumeOrChapter,
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
 * Build the display items from raw data, applying selection state from
 * `selectedChapterIds`.
 *
 * Collapse state is intentionally not projected into every item. It is passed
 * separately to ChapterSelector so toggling one volume does not clone every
 * chapter in a large series.
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
