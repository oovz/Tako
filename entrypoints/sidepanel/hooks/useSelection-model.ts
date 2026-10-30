import type { SidePanelChapter, VolumeOrChapter } from "../types"

export function getAllChapters(items: VolumeOrChapter[]): SidePanelChapter[] {
  return items.flatMap((item) => ("chapters" in item ? item.chapters : [item]))
}

function selectableChapters(chapters: SidePanelChapter[]): SidePanelChapter[] {
  return chapters.filter((chapter) => chapter.locked !== true)
}

function updateSelection(
  chapters: SidePanelChapter[],
  targetIds: string[],
  selected: boolean
): string[] {
  const next = new Set(
    selectableChapters(chapters)
      .filter((chapter) => chapter.selected)
      .map((chapter) => chapter.id)
  )
  for (const id of targetIds) {
    if (selected) next.add(id)
    else next.delete(id)
  }
  return [...next]
}

export function getChapterSelectionChange(
  chapters: SidePanelChapter[],
  chapterId: string,
  checked: boolean,
  shiftClick: boolean,
  anchorIndex: number
): { selectedIds: string[]; anchorIndex: number } | undefined {
  const clickedIndex = chapters.findIndex((chapter) => chapter.id === chapterId)
  if (clickedIndex === -1 || chapters[clickedIndex].locked === true) return

  const hasRange = shiftClick && anchorIndex !== -1
  const targets = hasRange
    ? selectableChapters(
        chapters.slice(
          Math.min(anchorIndex, clickedIndex),
          Math.max(anchorIndex, clickedIndex) + 1
        )
      )
    : [chapters[clickedIndex]]
  return {
    selectedIds: updateSelection(
      chapters,
      targets.map((chapter) => chapter.id),
      checked
    ),
    anchorIndex: hasRange ? anchorIndex : clickedIndex,
  }
}

export function getBulkSelectionChange(
  chapters: SidePanelChapter[],
  targets: SidePanelChapter[],
  forceSelect?: boolean | "indeterminate"
): string[] | undefined {
  const selectable = selectableChapters(targets)
  if (selectable.length === 0) return
  const selected =
    typeof forceSelect === "boolean"
      ? forceSelect
      : !selectable.every((chapter) => chapter.selected)
  return updateSelection(
    chapters,
    selectable.map((chapter) => chapter.id),
    selected
  )
}

export function getVolumeSelectionChange(
  items: VolumeOrChapter[],
  groupId: string
): string[] | undefined {
  const volume = items.find(
    (item) => "chapters" in item && item.groupId === groupId
  )
  if (!volume || !("chapters" in volume)) return
  return getBulkSelectionChange(getAllChapters(items), volume.chapters)
}

export function toggleCollapsedGroup(
  groups: Set<string>,
  groupId: string
): Set<string> {
  const next = new Set(groups)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  return next
}
