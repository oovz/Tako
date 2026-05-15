import type {
  SidePanelChapter,
  StandaloneChapter,
  Volume,
  VolumeOrChapter,
} from '../types'
import { NO_MANGA_FOUND_MSG, TAB_NOT_SUPPORTED_MSG } from '../messages'
import type { DownloadTaskState } from '@/src/types/queue-state'
import { isMangaPageState } from '@/src/runtime/state-shapes'
import { isRecord } from '@/src/shared/type-guards'
import type { ChapterState, MangaPageState, VolumeState } from '@/src/types/tab-state'

export interface DerivedSidepanelSeriesContextData {
  mangaState?: MangaPageState
  items: VolumeOrChapter[]
  mangaTitle: string
  seriesId?: string
  isLoading: boolean
  blockingMessage: string | undefined
  siteId: string | undefined
  author?: string
  coverUrl?: string
}

export type ActiveTabContextValue =
  | { kind: 'ready'; mangaState: MangaPageState }
  | { kind: 'error'; error: string }
  | { kind: 'loading' }
  | { kind: 'unsupported' }

function getTabStorageKey(tabId: number): string {
  return `tab_${tabId}`
}

function getTabErrorStorageKey(tabId: number): string {
  return `seriesContextError_${tabId}`
}

export function selectPreferredSeriesContextTask(
  tasks: DownloadTaskState[],
): DownloadTaskState | undefined {
  const byCreatedAscending = (left: DownloadTaskState, right: DownloadTaskState) => left.created - right.created

  const downloadingTask = tasks
    .filter((task) => task.status === 'downloading')
    .sort(byCreatedAscending)[0]

  if (downloadingTask) {
    return downloadingTask
  }

  return tasks
    .filter((task) => task.status === 'queued')
    .sort(byCreatedAscending)[0]
}

function isLoadingContext(value: unknown): value is { loading: true } {
  return !!value && typeof value === 'object' && (value as { loading?: unknown }).loading === true
}

function isErrorContext(value: unknown): value is { error: string } {
  return !!value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string'
}

function normalizeBlockingMessage(error: string): string {
  return error.includes('No manga found') ? NO_MANGA_FOUND_MSG : error
}

function getEmptySeriesContext(
  blockingMessage?: string,
  isLoading: boolean = false,
): DerivedSidepanelSeriesContextData {
  return {
    mangaState: undefined,
    items: [],
    mangaTitle: '',
    seriesId: undefined,
    isLoading,
    blockingMessage,
    siteId: undefined,
    author: undefined,
    coverUrl: undefined,
  }
}

export function deriveSeriesContextFromActiveTabContext(
  context: ActiveTabContextValue,
  previousItems?: VolumeOrChapter[],
): DerivedSidepanelSeriesContextData {
  switch (context.kind) {
    case 'ready': {
      const { mangaState } = context
      return {
        mangaState,
        items: groupChapters(mangaState.chapters, mangaState.volumes, previousItems),
        mangaTitle: mangaState.seriesTitle,
        seriesId: mangaState.mangaId,
        isLoading: false,
        blockingMessage: undefined,
        siteId: mangaState.siteIntegrationId,
        author: mangaState.metadata?.author,
        coverUrl: mangaState.metadata?.coverUrl,
      }
    }

    case 'loading':
      return getEmptySeriesContext(undefined, true)

    case 'error':
      return getEmptySeriesContext(normalizeBlockingMessage(context.error), false)

    case 'unsupported':
      return getEmptySeriesContext(TAB_NOT_SUPPORTED_MSG, false)
  }
}

export function normalizeActiveTabContext(value: unknown): ActiveTabContextValue {
  if (isMangaPageState(value)) {
    return { kind: 'ready', mangaState: value }
  }

  if (isLoadingContext(value)) {
    return { kind: 'loading' }
  }

  if (isErrorContext(value)) {
    return { kind: 'error', error: value.error }
  }

  return { kind: 'unsupported' }
}

export function normalizeStoredSeriesContext(
  value: unknown,
  tabId: number | undefined,
): ActiveTabContextValue {
  if (!isRecord(value)) {
    return { kind: 'unsupported' }
  }

  if (typeof tabId === 'number') {
    const tabState = value[getTabStorageKey(tabId)]
    if (isMangaPageState(tabState)) {
      return { kind: 'ready', mangaState: tabState }
    }

    const tabError = value[getTabErrorStorageKey(tabId)]
    if (typeof tabError === 'string' && tabError.length > 0) {
      return { kind: 'error', error: tabError }
    }
  }

  return normalizeActiveTabContext(value.activeTabContext)
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

export function groupChapters(
  chapters: ChapterState[],
  volumesOrPreviousItems: VolumeState[] | VolumeOrChapter[] = [],
  previousItems?: VolumeOrChapter[],
): VolumeOrChapter[] {
  const firstSecondaryItem = volumesOrPreviousItems[0]
  const receivedPreviousItems = firstSecondaryItem
    && (('chapters' in firstSecondaryItem) || ('isStandalone' in firstSecondaryItem))
  const volumes = receivedPreviousItems ? [] : volumesOrPreviousItems as VolumeState[]
  const collapsedStateSource = receivedPreviousItems
    ? volumesOrPreviousItems as VolumeOrChapter[]
    : previousItems
  const sidePanelChapters = chapters.map(convertToSidePanelChapter)

  const previousCollapsedState = new Map<string, boolean>()
  if (collapsedStateSource) {
    collapsedStateSource.forEach((item) => {
      if ('chapters' in item) {
        previousCollapsedState.set(item.groupId, item.collapsed)
      }
    })
  }

  type VolumeNode = { kind: 'volume'; volumeNumber?: number; title: string; groupId: string; chapters: SidePanelChapter[] }
  type StandaloneNode = { kind: 'standalone'; chapter: SidePanelChapter }

  const explicitVolumeIds = new Set(volumes.map((volume) => volume.id))
  const hasExplicitVolumeMembership = sidePanelChapters.some((chapter) => (
    typeof chapter.volumeId === 'string' && explicitVolumeIds.has(chapter.volumeId)
  ))

  if (volumes.length > 0 && hasExplicitVolumeMembership) {
    const result: VolumeOrChapter[] = []
    for (const volume of volumes) {
      const volumeChapters = sidePanelChapters.filter((chapter) => chapter.volumeId === volume.id)
      if (volumeChapters.length === 0) {
        continue
      }

      const firstNumberedChapter = volumeChapters.find((chapter) => chapter.volumeNumber !== undefined)
      const volumeNumber = firstNumberedChapter?.volumeNumber
      const title = volume.title
        ?? volume.label
        ?? volumeChapters.find((chapter) => chapter.volumeLabel)?.volumeLabel
        ?? (volumeNumber !== undefined ? `Volume ${volumeNumber}` : 'Volume')
      const nextSelected = volumeChapters
        .filter((chapter) => chapter.selected && chapter.locked !== true)
        .map((chapter) => chapter.id)

      result.push({
        number: volumeNumber,
        title,
        chapters: volumeChapters.map((chapter) => ({
          ...chapter,
          selected: chapter.locked === true ? false : nextSelected.includes(chapter.id),
        })),
        collapsed: previousCollapsedState.get(volume.id) ?? true,
        groupId: volume.id,
      } as Volume)
    }

    sidePanelChapters
      .filter((chapter) => typeof chapter.volumeId !== 'string' || !explicitVolumeIds.has(chapter.volumeId))
      .forEach((chapter) => {
        result.push({
          ...chapter,
          isStandalone: true,
          selected: chapter.locked === true ? false : chapter.selected,
        } as StandaloneChapter)
      })

    return result
  }

  const nodes: Array<VolumeNode | StandaloneNode> = []
  let currentVolumeNode: VolumeNode | null = null

  sidePanelChapters.forEach((chapter) => {
    if (chapter.volumeNumber !== undefined) {
      if (!currentVolumeNode || currentVolumeNode.volumeNumber !== chapter.volumeNumber) {
        const groupId = `${chapter.volumeNumber}:${chapter.url}`
        const title = chapter.volumeLabel ?? `Volume ${chapter.volumeNumber}`
        currentVolumeNode = {
          kind: 'volume',
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
      nodes.push({ kind: 'standalone', chapter })
    }
  })

  const result: VolumeOrChapter[] = []

  nodes.forEach((node) => {
    if (node.kind === 'volume') {
      const nextSelected = node.chapters
        .filter((chapter) => chapter.selected && chapter.locked !== true)
        .map((chapter) => chapter.id)

      result.push({
        number: node.volumeNumber,
        title: node.title,
        chapters: node.chapters.map((chapter) => ({
          ...chapter,
          selected: chapter.locked === true ? false : nextSelected.includes(chapter.id),
        })),
        collapsed: previousCollapsedState.get(node.groupId) ?? true,
        groupId: node.groupId,
      } as Volume)
      return
    }

    result.push({
      ...node.chapter,
      isStandalone: true,
      selected: node.chapter.locked === true ? false : node.chapter.selected,
    } as StandaloneChapter)
  })

  return result
}
