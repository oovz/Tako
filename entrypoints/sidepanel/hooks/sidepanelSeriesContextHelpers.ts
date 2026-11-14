import type { SidePanelChapter, VolumeOrChapter } from "../types"
import { groupChapters } from "./sidepanelSeriesContextHelpers-grouping"
import { NO_MANGA_FOUND_MSG, TAB_NOT_SUPPORTED_MSG } from "../messages"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import {
  isLoadingTabContext,
  isMangaPageState,
  parseActiveTabContextByWindow,
  TabContextErrorSchema,
} from "@/src/runtime/tab-state-schemas"
import type {
  MangaPageState,
  TabContextError,
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
  | ({ kind: "error" } & TabContextError)
  | { kind: "loading"; sourceUrl?: string }
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

  if (isLoadingTabContext(value)) {
    return {
      kind: "loading",
      ...(value.sourceUrl ? { sourceUrl: value.sourceUrl } : {}),
    }
  }

  const error = TabContextErrorSchema.safeParse(value).data
  if (error) return { kind: "error", ...error }

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
      (normalized.kind === "ready" &&
        normalized.mangaState.sourceUrl !== activeUrl) ||
      (normalized.kind === "error" &&
        normalized.sourceUrl !== undefined &&
        normalized.sourceUrl !== activeUrl)
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

export function applyDownloadedChapterMarkers(
  items: VolumeOrChapter[],
  downloadedChapters: ReadonlyMap<
    string,
    Pick<SidePanelChapter, "outputDestination" | "saveConfirmedAt">
  >
): VolumeOrChapter[] {
  const markChapter = (chapter: SidePanelChapter): SidePanelChapter => ({
    ...chapter,
    downloaded: downloadedChapters.has(chapter.id),
    outputDestination: downloadedChapters.get(chapter.id)?.outputDestination,
    saveConfirmedAt: downloadedChapters.get(chapter.id)?.saveConfirmedAt,
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

export { groupChapters } from "./sidepanelSeriesContextHelpers-grouping"
