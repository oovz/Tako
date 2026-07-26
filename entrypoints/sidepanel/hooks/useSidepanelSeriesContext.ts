import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { VolumeOrChapter } from "../types"
import { useSidepanelTrackedTabId } from "@/entrypoints/sidepanel/hooks/useSidepanelTrackedTabId"
import {
  applyDownloadedChapterMarkers,
  deriveSeriesContextFromActiveTabContext,
  normalizeStoredSeriesContext,
  type ActiveTabContextValue,
} from "@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers"
import {
  LOCAL_STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
} from "@/src/runtime/storage-keys"
import type { MangaPageState } from "@/src/types/tab-state"
import { useChromeStorageValue } from "@/src/ui/shared/hooks/useChromeStorageValue"
import {
  parseDownloadedChapters,
  type DownloadedChapterRecord,
} from "@/src/storage/chapter-persistence-service"

export interface SidepanelSeriesContextData {
  tabId: number | undefined
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

function useCurrentWindowId(): number | undefined {
  const [windowId, setWindowId] = useState<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const resolve = async () => {
      try {
        const currentWindow = await chrome.windows.getCurrent()
        if (!cancelled) {
          setWindowId(currentWindow?.id)
          return
        }
      } catch {
        // Fall through to tabs.getCurrent.
      }

      try {
        const currentTab = await chrome.tabs.getCurrent()
        if (!cancelled && currentTab?.windowId !== undefined) {
          setWindowId(currentTab.windowId)
          return
        }
      } catch {
        // ignore
      }

      if (!cancelled) {
        setWindowId(undefined)
      }
    }

    void resolve()

    return () => {
      cancelled = true
    }
  }, [])

  return windowId
}

export function useSidepanelSeriesContext(): SidepanelSeriesContextData {
  const tabId = useSidepanelTrackedTabId()
  const windowId = useCurrentWindowId()
  const recoveredTabWindowKeys = useRef(new Set<string>())
  const storageKeys = useMemo(
    () =>
      typeof tabId === "number"
        ? [
            `tab_${tabId}`,
            `seriesContextError_${tabId}`,
            SESSION_STORAGE_KEYS.activeTabContext,
            SESSION_STORAGE_KEYS.activeTabContextByWindow,
          ]
        : [
            SESSION_STORAGE_KEYS.activeTabContext,
            SESSION_STORAGE_KEYS.activeTabContextByWindow,
          ],
    [tabId]
  )
  const parseStoredContext = useCallback(
    (value: unknown) => normalizeStoredSeriesContext(value, tabId, windowId),
    [tabId, windowId]
  )
  const { value: activeTabContext, hydrated } =
    useChromeStorageValue<ActiveTabContextValue>({
      areaName: "session",
      key: storageKeys,
      initialValue: { kind: "unsupported" },
      parse: parseStoredContext,
    })
  const { value: downloadedChapters } = useChromeStorageValue<
    DownloadedChapterRecord[]
  >({
    areaName: "local",
    key: LOCAL_STORAGE_KEYS.downloadedChapters,
    initialValue: [],
    parse: parseDownloadedChapters,
  })

  useEffect(() => {
    if (
      !hydrated ||
      typeof tabId !== "number" ||
      typeof windowId !== "number"
    ) {
      return
    }

    const recoveryKey = `${windowId}:${tabId}`
    if (recoveredTabWindowKeys.current.has(recoveryKey)) return
    recoveredTabWindowKeys.current.add(recoveryKey)

    // A complete ready state is authoritative. A metadata-only partial remains
    // recoverable work and must not become terminal after a worker restart.
    if (
      activeTabContext.kind === "ready" &&
      activeTabContext.mangaState.chaptersLoading !== true
    ) {
      return
    }

    // A Side Panel can open after an MV3 worker restart or a dropped page
    // projection. Ask the background to own a fresh resolution instead of
    // leaving a persisted loading snapshot on screen indefinitely.
    void chrome.runtime
      .sendMessage({
        type: "REQUEST_TAB_CONTEXT_REFRESH",
        payload: { tabId, windowId, reason: "sidepanel-mount" },
      })
      .catch(() => undefined)
  }, [activeTabContext, hydrated, tabId, windowId])

  const data = useMemo(() => {
    const derived = deriveSeriesContextFromActiveTabContext(activeTabContext)
    if (!derived.seriesId || derived.items.length === 0) return derived

    const downloadedChapterIds = new Set(
      downloadedChapters
        .filter((chapter) => chapter.seriesId === derived.seriesId)
        .map((chapter) => chapter.chapterId)
    )

    return {
      ...derived,
      items: applyDownloadedChapterMarkers(derived.items, downloadedChapterIds),
    }
  }, [activeTabContext, downloadedChapters])

  return {
    tabId,
    ...data,
    // Until the session snapshot has hydrated, an initial "unsupported"
    // placeholder is not a resolved result. Keep the loading projection so a
    // panel opening on a supported page does not flash the wrong state.
    isLoading: !hydrated || data.isLoading,
  }
}
