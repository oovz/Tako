import { useCallback, useEffect, useMemo, useState } from "react"

import type { VolumeOrChapter } from "../types"
import { useSidepanelTrackedTabId } from "@/entrypoints/sidepanel/hooks/useSidepanelTrackedTabId"
import {
  applyDownloadedChapterMarkers,
  deriveSeriesContextFromActiveTabContext,
  normalizeStoredSeriesContext,
  type ActiveTabContextValue,
} from "@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { MangaPageState } from "@/src/types/tab-state"
import {
  useChromeStorageValue,
  type StorageReadStatus,
} from "@/src/ui/shared/hooks/useChromeStorageValue"
import type { DownloadedChapterRecord } from "@/src/domain/history/types"
import { useSidepanelDownloadedChapters } from "./useSidepanelSeriesContextHistory"
import logger from "@/src/runtime/logger"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import { createSeriesContextRecoveryCoordinator } from "./useSidepanelSeriesContextRecovery"
export { createSeriesContextRecoveryCoordinator } from "./useSidepanelSeriesContextRecovery"

export interface SidepanelSeriesContextData {
  windowId: number | undefined
  tabId: number | undefined
  seriesRevision: number | undefined
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
  downloadedChapters?: DownloadedChapterRecord[]
  historyReadStatus?: StorageReadStatus
  retryHistory?: () => void
  retrySeriesContext?: () => void
}

export async function resolveCurrentSidepanelWindowId(): Promise<
  number | undefined
> {
  try {
    const currentWindow = await chrome.windows.getCurrent()
    if (typeof currentWindow?.id === "number") {
      return currentWindow.id
    }
  } catch {
    // Fall through to the side-panel tab lookup.
  }

  try {
    const currentTab = await chrome.tabs.getCurrent()
    return typeof currentTab?.windowId === "number"
      ? currentTab.windowId
      : undefined
  } catch {
    return undefined
  }
}

function useCurrentWindowId(): number | undefined {
  const [windowId, setWindowId] = useState<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    void resolveCurrentSidepanelWindowId().then((resolvedWindowId) => {
      if (!cancelled) {
        setWindowId(resolvedWindowId)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  return windowId
}

export function useSidepanelSeriesContext(): SidepanelSeriesContextData {
  const windowId = useCurrentWindowId()
  const { tabId, activeUrl } = useSidepanelTrackedTabId(windowId)
  const recoveryCoordinator = useMemo(
    () =>
      createSeriesContextRecoveryCoordinator({
        requestRefresh: ({
          tabId: targetTabId,
          windowId: targetWindowId,
          reason,
        }) =>
          sendRuntimeMessage({
            target: "background",
            type: "REQUEST_TAB_CONTEXT_REFRESH",
            payload: {
              tabId: targetTabId,
              windowId: targetWindowId,
              reason: reason ?? "sidepanel-mount",
            },
          }),
      }),
    []
  )
  const storageKeys = useMemo(
    () => SESSION_STORAGE_KEYS.activeTabContextByWindow,
    []
  )
  const parseStoredContext = useCallback(
    (value: unknown) =>
      normalizeStoredSeriesContext(value, tabId, windowId, activeUrl),
    [activeUrl, tabId, windowId]
  )
  const { value: activeTabContext, hydrated } =
    useChromeStorageValue<ActiveTabContextValue>({
      areaName: "session",
      key: storageKeys,
      initialValue: { kind: "unsupported" },
      parse: parseStoredContext,
    })
  const history = useSidepanelDownloadedChapters()
  const downloadedChapters = history.chapters

  useEffect(() => {
    // A Side Panel can open after an MV3 worker restart or a dropped page
    // projection. Ask the background to own a fresh resolution instead of
    // leaving a persisted loading snapshot on screen indefinitely.
    void recoveryCoordinator
      .recoverIfNeeded({
        activeTabContext,
        hydrated,
        tabId,
        windowId,
        sourceUrl: activeUrl,
      })
      .catch((error) =>
        logger.debug("[sidepanel] Context refresh request failed", error)
      )
  }, [
    activeTabContext,
    activeUrl,
    hydrated,
    recoveryCoordinator,
    tabId,
    windowId,
  ])

  const retrySeriesContext = useCallback(() => {
    void recoveryCoordinator
      .retry({
        activeTabContext,
        hydrated,
        tabId,
        windowId,
        sourceUrl: activeUrl,
      })
      .catch((error) =>
        logger.debug("[sidepanel] Context retry request failed", error)
      )
  }, [
    activeTabContext,
    activeUrl,
    hydrated,
    recoveryCoordinator,
    tabId,
    windowId,
  ])

  const data = useMemo(
    () => deriveDownloadedSeriesContext(activeTabContext, downloadedChapters),
    [activeTabContext, downloadedChapters]
  )

  return {
    windowId,
    tabId,
    seriesRevision:
      activeTabContext.kind === "ready" ? activeTabContext.revision : undefined,
    ...data,
    downloadedChapters,
    historyReadStatus: history.status,
    retryHistory: history.retry,
    retrySeriesContext:
      activeTabContext.kind === "error" ? retrySeriesContext : undefined,
    // Until the session snapshot has hydrated, an initial "unsupported"
    // placeholder is not a resolved result. Keep the loading projection so a
    // panel opening on a supported page does not flash the wrong state.
    isLoading: isSeriesContextLoading(
      hydrated,
      windowId,
      tabId,
      data.isLoading
    ),
  }
}

function isSeriesContextLoading(
  hydrated: boolean,
  windowId: number | undefined,
  tabId: number | undefined,
  loading: boolean
) {
  return !hydrated || windowId === undefined || tabId === undefined || loading
}

function deriveDownloadedSeriesContext(
  activeTabContext: ActiveTabContextValue,
  downloadedChapters: DownloadedChapterRecord[]
) {
  const derived = deriveSeriesContextFromActiveTabContext(activeTabContext)
  if (!derived.seriesId || derived.items.length === 0) return derived
  const downloadedChapterResults = new Map(
    downloadedChapters
      .filter(
        (chapter) =>
          chapter.siteIntegrationId === derived.siteId &&
          chapter.seriesId === derived.seriesId
      )
      .map(
        (chapter) =>
          [
            chapter.chapterId,
            {
              outputDestination: chapter.outputDestination,
              saveConfirmedAt: chapter.saveConfirmedAt,
            },
          ] as const
      )
  )
  return {
    ...derived,
    items: applyDownloadedChapterMarkers(
      derived.items,
      downloadedChapterResults
    ),
  }
}
