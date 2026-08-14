import type { SidePanelChapter, VolumeOrChapter } from "../types"
import { NO_MANGA_FOUND_MSG, TAB_NOT_SUPPORTED_MSG } from "../messages"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import {
  isMangaPageState,
  parseActiveTabContextByWindow,
} from "@/src/runtime/tab-state-schemas"
import type {
  ChapterState,
  MangaPageState,
  VolumeState,
  WindowTabContext,
} from "@/src/types/tab-state"

export interface DerivedSidepanelSeriesContextData {
  mangaState?: MangaPageState
  items: VolumeOrChapter[]
  mangaTitle: string
  seriesId?: string
  isLoading: boolean
  isChaptersLoading: boolean
  chapterListNotice?: "adult-consent-required"
  blockingMessage: string | undefined
  siteId: string | undefined
  author?: string
  coverUrl?: string
}

export type ActiveTabContextValue =
  | { kind: "ready"; mangaState: MangaPageState; revision?: number }
  | { kind: "error"; error: string }
  | { kind: "loading" }
  | { kind: "unsupported" }

export function selectPreferredSeriesContextTask(
  tasks: DownloadTaskState[]
): DownloadTaskState | undefined {
  const byCreatedAscending = (
    left: DownloadTaskState,
    right: DownloadTaskState
  ) => left.created - right.created

  const downloadingTask = tasks
    .filter((task) => task.status === "downloading")
    .sort(byCreatedAscending)[0]

  if (downloadingTask) {
    return downloadingTask
  }

  return tasks
    .filter((task) => task.status === "queued")
    .sort(byCreatedAscending)[0]
}

function isLoadingContext(value: unknown): value is { loading: true } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { loading?: unknown }).loading === true
  )
}

function isErrorContext(value: unknown): value is { error: string } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { error?: unknown }).error === "string"
  )
}

function normalizeBlockingMessage(error: string): string {
  return error.includes("No manga found") ? NO_MANGA_FOUND_MSG : error
}

function getEmptySeriesContext(
  blockingMessage?: string,
  isLoading: boolean = false
): DerivedSidepanelSeriesContextData {
  return {
    mangaState: undefined,
    items: [],
    mangaTitle: "",
    seriesId: undefined,
    isLoading,
    isChaptersLoading: false,
    chapterListNotice: undefined,
    blockingMessage,
    siteId: undefined,
    author: undefined,
    coverUrl: undefined,
  }
}

export function deriveSeriesContextFromActiveTabContext(
  context: ActiveTabContextValue,
  previousItems?: VolumeOrChapter[]
): DerivedSidepanelSeriesContextData {
  switch (context.kind) {
    case "ready": {
      const { mangaState } = context
      return {
        mangaState,
        items: groupChapters(
          mangaState.chapters,
          mangaState.volumes,
          previousItems
        ),
        mangaTitle: mangaState.seriesTitle,
        seriesId: mangaState.mangaId,
        isLoading: false,
        isChaptersLoading: mangaState.chaptersLoading ?? false,
        chapterListNotice: mangaState.chapterListNotice,
        blockingMessage: undefined,
        siteId: mangaState.siteIntegrationId,
        author: mangaState.metadata?.author,
        coverUrl: mangaState.metadata?.coverUrl,
      }
    }

    case "loading":
      return getEmptySeriesContext(undefined, true)

    case "error":
      return getEmptySeriesContext(
        normalizeBlockingMessage(context.error),
        false
      )

    case "unsupported":
      return getEmptySeriesContext(TAB_NOT_SUPPORTED_MSG, false)
  }
}

export function normalizeActiveTabContext(
  value: unknown,
  revision?: number
): ActiveTabContextValue {
  if (isMangaPageState(value)) {
    return {
      kind: "ready",
      mangaState: value,
      ...(typeof revision === "number" ? { revision } : {}),
    }
  }

  if (isLoadingContext(value)) {
    return { kind: "loading" }
  }

  if (isErrorContext(value)) {
    return { kind: "error", error: value.error }
  }

  return { kind: "unsupported" }
}

function resolveWindowContext(
  value: unknown,
  windowId: number
): WindowTabContext | undefined {
  return parseActiveTabContextByWindow(value)?.[windowId]
}

export function normalizeStoredSeriesContext(
  value: unknown,
  tabId: number | undefined,
  windowId?: number,
  activeUrl?: string
): ActiveTabContextValue {
  if (typeof windowId !== "number") {
    return { kind: "loading" }
  }

  if (typeof tabId === "number") {
    const windowContext = resolveWindowContext(value, windowId)
    if (!windowContext || windowContext.activeTabId !== tabId) {
      return { kind: "loading" }
    }

    const normalized = normalizeActiveTabContext(
      windowContext.context,
      windowContext.revision
    )
    if (
      normalized.kind === "ready" &&
      normalized.mangaState.sourceUrl !== activeUrl
    ) {
      return { kind: "loading" }
    }
    return normalized
  }

  const windowContext = resolveWindowContext(value, windowId)
  if (windowContext) {
    return normalizeActiveTabContext(
      windowContext.context,
      windowContext.revision
    )
  }
  return { kind: "loading" }
}

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

export function applyDownloadedChapterMarkers(
  items: VolumeOrChapter[],
  downloadedChapterIds: ReadonlySet<string>
): VolumeOrChapter[] {
  const markChapter = (chapter: SidePanelChapter): SidePanelChapter => ({
    ...chapter,
    downloaded: downloadedChapterIds.has(chapter.id),
  })

  return items.map((item) => {
    if ("chapters" in item) {
      return {
        ...item,
        chapters: item.chapters.map(markChapter),
      }
    }

    return {
      ...markChapter(item),
      isStandalone: true,
    }
  })
}

export function groupChapters(
  chapters: ChapterState[],
  volumesOrPreviousItems: VolumeState[] | VolumeOrChapter[] = [],
  previousItems?: VolumeOrChapter[]
): VolumeOrChapter[] {
  const firstSecondaryItem = volumesOrPreviousItems[0]
  const receivedPreviousItems =
    firstSecondaryItem &&
    ("chapters" in firstSecondaryItem || "isStandalone" in firstSecondaryItem)
  const volumes = receivedPreviousItems
    ? []
    : (volumesOrPreviousItems as VolumeState[])
  const collapsedStateSource = receivedPreviousItems
    ? (volumesOrPreviousItems as VolumeOrChapter[])
    : previousItems
  const sidePanelChapters = chapters.map(convertToSidePanelChapter)

  const previousCollapsedState = new Map<string, boolean>()
  if (collapsedStateSource) {
    collapsedStateSource.forEach((item) => {
      if ("chapters" in item) {
        previousCollapsedState.set(item.groupId, item.collapsed)
      }
    })
  }

  type VolumeNode = {
    kind: "volume"
    volumeId?: string
    volumeNumber?: number
    title: string
    groupId: string
    chapters: SidePanelChapter[]
  }
  type StandaloneNode = { kind: "standalone"; chapter: SidePanelChapter }

  const explicitVolumeIds = new Set(volumes.map((volume) => volume.id))
  const hasExplicitVolumeMembership = sidePanelChapters.some(
    (chapter) =>
      typeof chapter.volumeId === "string" &&
      explicitVolumeIds.has(chapter.volumeId)
  )

  if (volumes.length > 0 && hasExplicitVolumeMembership) {
    const volumeById = new Map(volumes.map((volume) => [volume.id, volume]))
    const nodes: Array<VolumeNode | StandaloneNode> = []
    const seenVolumeIds = new Set<string>()
    let currentVolumeNode: VolumeNode | null = null

    sidePanelChapters.forEach((chapter) => {
      if (
        typeof chapter.volumeId === "string" &&
        volumeById.has(chapter.volumeId)
      ) {
        if (
          currentVolumeNode &&
          currentVolumeNode.volumeId === chapter.volumeId
        ) {
          currentVolumeNode.chapters.push(chapter)
          return
        }

        const volume = volumeById.get(chapter.volumeId)!
        const isFirstOccurrence = !seenVolumeIds.has(chapter.volumeId)
        const groupId = isFirstOccurrence
          ? chapter.volumeId
          : `${chapter.volumeId}:${chapter.url}`
        seenVolumeIds.add(chapter.volumeId)
        const title =
          volume.title ??
          volume.label ??
          chapter.volumeLabel ??
          (chapter.volumeNumber !== undefined
            ? `Volume ${chapter.volumeNumber}`
            : "Volume")
        currentVolumeNode = {
          kind: "volume",
          volumeId: chapter.volumeId,
          volumeNumber: chapter.volumeNumber,
          title,
          groupId,
          chapters: [chapter],
        }
        nodes.push(currentVolumeNode)
        return
      }

      currentVolumeNode = null
      nodes.push({ kind: "standalone", chapter })
    })

    const result: VolumeOrChapter[] = []

    nodes.forEach((node) => {
      if (node.kind === "volume") {
        const nextSelected = node.chapters
          .filter((chapter) => chapter.selected && chapter.locked !== true)
          .map((chapter) => chapter.id)

        result.push({
          number: node.volumeNumber,
          title: node.title,
          chapters: node.chapters.map((chapter) => ({
            ...chapter,
            selected:
              chapter.locked === true
                ? false
                : nextSelected.includes(chapter.id),
          })),
          collapsed: previousCollapsedState.get(node.groupId) ?? true,
          groupId: node.groupId,
        })
        return
      }

      result.push({
        ...node.chapter,
        isStandalone: true,
        selected: node.chapter.locked === true ? false : node.chapter.selected,
      })
    })

    return result
  }

  const nodes: Array<VolumeNode | StandaloneNode> = []
  let currentVolumeNode: VolumeNode | null = null

  sidePanelChapters.forEach((chapter) => {
    if (chapter.volumeNumber !== undefined) {
      if (
        !currentVolumeNode ||
        currentVolumeNode.volumeNumber !== chapter.volumeNumber
      ) {
        const groupId = `${chapter.volumeNumber}:${chapter.url}`
        const title = chapter.volumeLabel ?? `Volume ${chapter.volumeNumber}`
        currentVolumeNode = {
          kind: "volume",
          volumeNumber: chapter.volumeNumber,
          title,
          groupId,
          chapters: [chapter],
        }
        nodes.push(currentVolumeNode)
      } else {
        currentVolumeNode.chapters.push(chapter)
      }
    } else {
      currentVolumeNode = null
      nodes.push({ kind: "standalone", chapter })
    }
  })

  const result: VolumeOrChapter[] = []

  nodes.forEach((node) => {
    if (node.kind === "volume") {
      const nextSelected = node.chapters
        .filter((chapter) => chapter.selected && chapter.locked !== true)
        .map((chapter) => chapter.id)

      result.push({
        number: node.volumeNumber,
        title: node.title,
        chapters: node.chapters.map((chapter) => ({
          ...chapter,
          selected:
            chapter.locked === true ? false : nextSelected.includes(chapter.id),
        })),
        collapsed: previousCollapsedState.get(node.groupId) ?? true,
        groupId: node.groupId,
      })
      return
    }

    result.push({
      ...node.chapter,
      isStandalone: true,
      selected: node.chapter.locked === true ? false : node.chapter.selected,
    })
  })

  return result
}
