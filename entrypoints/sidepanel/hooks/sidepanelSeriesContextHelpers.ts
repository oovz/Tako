import type {
  FormatDisplay,
  SidePanelChapter,
  StandaloneChapter,
  Volume,
  VolumeOrChapter,
} from '../types'
import { NO_MANGA_FOUND_MSG, TAB_NOT_SUPPORTED_MSG } from '../messages'
import type { DownloadTaskState } from '@/src/types/queue-state'
import type { ChapterState, MangaPageState } from '@/src/types/tab-state'

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
  defaultFormat: FormatDisplay
}

export type ActiveTabContextValue = MangaPageState | { error: string } | { loading: true } | null

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

const isMangaPageState = (value: unknown): value is MangaPageState => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as MangaPageState
  return (
    typeof candidate.siteIntegrationId === 'string' &&
    typeof candidate.mangaId === 'string' &&
    typeof candidate.seriesTitle === 'string' &&
    Array.isArray(candidate.chapters) &&
    Array.isArray(candidate.volumes)
  )
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
  defaultFormat: FormatDisplay,
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
    defaultFormat,
  }
}

export function deriveSeriesContextFromActiveTabContext(
  context: ActiveTabContextValue,
  defaultFormat: FormatDisplay,
  previousItems?: VolumeOrChapter[],
): DerivedSidepanelSeriesContextData {
  if (isMangaPageState(context)) {
    return {
      mangaState: context,
      items: groupChapters(context.chapters, previousItems),
      mangaTitle: context.seriesTitle,
      seriesId: context.mangaId,
      isLoading: false,
      blockingMessage: undefined,
      siteId: context.siteIntegrationId,
      author: context.metadata?.author,
      coverUrl: context.metadata?.coverUrl,
      defaultFormat,
    }
  }

  if (isLoadingContext(context)) {
    return getEmptySeriesContext(defaultFormat, undefined, true)
  }

  if (isErrorContext(context)) {
    return getEmptySeriesContext(defaultFormat, normalizeBlockingMessage(context.error), false)
  }

  return getEmptySeriesContext(defaultFormat, TAB_NOT_SUPPORTED_MSG, false)
}

export function normalizeActiveTabContext(value: unknown): ActiveTabContextValue {
  if (isMangaPageState(value)) {
    return value
  }

  if (isLoadingContext(value)) {
    return { loading: true }
  }

  if (isErrorContext(value)) {
    return { error: value.error }
  }

  return null
}

function convertToSidePanelChapter(chapter: ChapterState): SidePanelChapter {
  return {
    id: chapter.id,
    title: chapter.title,
    index: chapter.index,
    chapterLabel: chapter.chapterLabel,
    chapterNumber: chapter.chapterNumber,
    volumeNumber: chapter.volumeNumber,
    locked: chapter.locked === true,
    selected: false,
    url: chapter.url,
    status: chapter.status,
  }
}

export function groupChapters(
  chapters: ChapterState[],
  previousItems?: VolumeOrChapter[],
): VolumeOrChapter[] {
  const sidePanelChapters = chapters.map(convertToSidePanelChapter)

  const previousCollapsedState = new Map<string, boolean>()
  if (previousItems) {
    previousItems.forEach((item) => {
      if ('chapters' in item) {
        previousCollapsedState.set(item.groupId, item.collapsed)
      }
    })
  }

  type VolumeNode = { kind: 'volume'; volumeNumber: number; groupId: string; chapters: SidePanelChapter[] }
  type StandaloneNode = { kind: 'standalone'; chapter: SidePanelChapter }

  const nodes: Array<VolumeNode | StandaloneNode> = []
  let currentVolumeNode: VolumeNode | null = null

  sidePanelChapters.forEach((chapter) => {
    if (chapter.volumeNumber !== undefined) {
      if (!currentVolumeNode || currentVolumeNode.volumeNumber !== chapter.volumeNumber) {
        const groupId = `${chapter.volumeNumber}:${chapter.url}`
        currentVolumeNode = {
          kind: 'volume',
          volumeNumber: chapter.volumeNumber,
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
        title: `Volume ${node.volumeNumber}`,
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
