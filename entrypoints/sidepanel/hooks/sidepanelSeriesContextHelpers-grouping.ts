import type { SidePanelChapter, VolumeOrChapter } from "../types"
import type { ChapterState, VolumeState } from "@/src/types/tab-state"

type VolumeGroup = {
  volumeId?: string
  volumeNumber?: number
  title: string
  key: string
  firstGroupId?: string
}
type VolumeNode = VolumeGroup & {
  kind: "volume"
  groupId: string
  chapters: SidePanelChapter[]
}
type ChapterNode =
  VolumeNode | { kind: "standalone"; chapter: SidePanelChapter }

function convertToSidePanelChapter(chapter: ChapterState): SidePanelChapter {
  return {
    id: chapter.id,
    title: chapter.title,
    index: chapter.index,
    chapterLabel: chapter.chapterLabel,
    chapterNumber: chapter.chapterNumber,
    volumeId: chapter.volumeId,
    volumeNumber: chapter.volumeNumber,
    volumeLabel: chapter.volumeLabel,
    locked: chapter.locked === true,
    selected: false,
    url: chapter.url,
    status: chapter.status,
  }
}

function resolveGroupingInputs(
  secondary: VolumeState[] | VolumeOrChapter[],
  previousItems?: VolumeOrChapter[]
) {
  const first = secondary[0]
  if (first && ("chapters" in first || "isStandalone" in first)) {
    return { volumes: [], previous: secondary as VolumeOrChapter[] }
  }
  return { volumes: secondary as VolumeState[], previous: previousItems }
}

function previousCollapsedState(items: VolumeOrChapter[] = []) {
  const collapsed = new Map<string, boolean>()
  for (const item of items) {
    if ("chapters" in item) collapsed.set(item.groupId, item.collapsed)
  }
  return collapsed
}

function usesExplicitVolumes(
  chapters: SidePanelChapter[],
  volumes: VolumeState[]
) {
  if (volumes.length === 0) return false
  const ids = new Set(volumes.map((volume) => volume.id))
  return (
    chapters.some(
      (chapter) => chapter.volumeId !== undefined && ids.has(chapter.volumeId)
    ) || chapters.every((chapter) => chapter.volumeNumber === undefined)
  )
}

function explicitGroup(
  chapter: SidePanelChapter,
  volumes: Map<string, VolumeState>
): VolumeGroup | undefined {
  if (chapter.volumeId === undefined) return
  const volume = volumes.get(chapter.volumeId)
  if (!volume) return
  return {
    key: volume.id,
    firstGroupId: volume.id,
    volumeId: volume.id,
    volumeNumber: chapter.volumeNumber,
    title:
      volume.title ??
      volume.label ??
      chapter.volumeLabel ??
      (chapter.volumeNumber !== undefined
        ? `Volume ${chapter.volumeNumber}`
        : "Volume"),
  }
}

function numberedGroup(chapter: SidePanelChapter): VolumeGroup | undefined {
  if (chapter.volumeNumber === undefined) return
  return {
    key: String(chapter.volumeNumber),
    volumeNumber: chapter.volumeNumber,
    title: chapter.volumeLabel ?? `Volume ${chapter.volumeNumber}`,
  }
}

function createChapterRuns(
  chapters: SidePanelChapter[],
  resolveGroup: (chapter: SidePanelChapter) => VolumeGroup | undefined
): ChapterNode[] {
  const nodes: ChapterNode[] = []
  const seenGroups = new Set<string>()
  let current: VolumeNode | undefined
  for (const chapter of chapters) {
    const group = resolveGroup(chapter)
    if (!group) {
      current = undefined
      nodes.push({ kind: "standalone", chapter })
    } else if (current?.key === group.key) {
      current.chapters.push(chapter)
    } else {
      const firstId = seenGroups.has(group.key) ? undefined : group.firstGroupId
      current = {
        ...group,
        kind: "volume",
        groupId: firstId ?? `${group.key}:${chapter.url}`,
        chapters: [chapter],
      }
      nodes.push(current)
      seenGroups.add(group.key)
    }
  }
  return nodes
}

function insertEmptyVolumes(nodes: ChapterNode[], volumes: VolumeState[]) {
  const populated = new Set(
    nodes.flatMap((node) => (node.kind === "volume" ? [node.volumeId] : []))
  )
  volumes.forEach((volume, index) => {
    if (populated.has(volume.id)) return
    const followingIds = new Set(
      volumes.slice(index + 1).map((entry) => entry.id)
    )
    const nextIndex = nodes.findIndex(
      (node) =>
        node.kind === "volume" &&
        node.volumeId !== undefined &&
        followingIds.has(node.volumeId)
    )
    const empty: VolumeNode = {
      kind: "volume",
      key: volume.id,
      volumeId: volume.id,
      title: volume.title ?? volume.label ?? "Volume",
      groupId: volume.id,
      chapters: [],
    }
    nodes.splice(nextIndex < 0 ? nodes.length : nextIndex, 0, empty)
  })
}

function materializeRuns(
  nodes: ChapterNode[],
  collapsed: ReadonlyMap<string, boolean>
): VolumeOrChapter[] {
  return nodes.map((node) =>
    node.kind === "standalone"
      ? { ...node.chapter, isStandalone: true }
      : {
          number: node.volumeNumber,
          title: node.title,
          chapters: node.chapters,
          collapsed: collapsed.get(node.groupId) ?? true,
          groupId: node.groupId,
        }
  )
}

export function groupChapters(
  chapters: ChapterState[],
  volumesOrPreviousItems: VolumeState[] | VolumeOrChapter[] = [],
  previousItems?: VolumeOrChapter[]
): VolumeOrChapter[] {
  const { volumes, previous } = resolveGroupingInputs(
    volumesOrPreviousItems,
    previousItems
  )
  const rows = chapters.map(convertToSidePanelChapter)
  const explicit = usesExplicitVolumes(rows, volumes)
  const volumeById = new Map(volumes.map((volume) => [volume.id, volume]))
  const nodes = createChapterRuns(
    rows,
    explicit ? (chapter) => explicitGroup(chapter, volumeById) : numberedGroup
  )
  if (explicit) insertEmptyVolumes(nodes, volumes)
  return materializeRuns(nodes, previousCollapsedState(previous))
}
