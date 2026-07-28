import { useCallback, useEffect, useMemo, useState } from "react"

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
import type { RequestTabContextRefreshResponse } from "@/src/types/runtime-command-messages"
import logger from "@/src/runtime/logger"

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

interface SeriesContextRecoveryObservation {
  activeTabContext: ActiveTabContextValue
  hydrated: boolean
  tabId: number | undefined
  windowId: number | undefined
}

function describeRecoverableSeriesContext(
  activeTabContext: ActiveTabContextValue
): string {
  switch (activeTabContext.kind) {
    case "ready":
      return [
        "ready",
        activeTabContext.mangaState.siteIntegrationId,
        activeTabContext.mangaState.mangaId,
        activeTabContext.mangaState.lastUpdated,
      ].join(":")
    case "error":
      return `error:${activeTabContext.error}`
    default:
      return activeTabContext.kind
  }
}

export function createSeriesContextRecoveryCoordinator(input: {
  requestRefresh: (target: {
    tabId: number
    windowId: number
  }) => Promise<RequestTabContextRefreshResponse>
}) {
  let activeAttempt:
    | {
        key: string
      }
    | undefined

  return {
    async recoverIfNeeded(
      observation: SeriesContextRecoveryObservation
    ): Promise<void> {
      if (
        !observation.hydrated ||
        typeof observation.tabId !== "number" ||
        typeof observation.windowId !== "number"
      ) {
        return
      }

      if (
        observation.activeTabContext.kind === "ready" &&
        observation.activeTabContext.mangaState.chaptersLoading !== true
      ) {
        activeAttempt = undefined
        return
      }
      const key = [
        observation.windowId,
        observation.tabId,
        describeRecoverableSeriesContext(observation.activeTabContext),
      ].join(":")
      if (activeAttempt?.key === key) return

      const attempt = { key }
      activeAttempt = attempt
      try {
        const response = await input.requestRefresh({
          tabId: observation.tabId,
          windowId: observation.windowId,
        })
        if (!response.success && activeAttempt === attempt) {
          activeAttempt = undefined
        }
      } catch (error) {
        if (activeAttempt === attempt) {
          activeAttempt = undefined
        }
        throw error
      }
    },
  }
}

export function useSidepanelSeriesContext(): SidepanelSeriesContextData {
  const tabId = useSidepanelTrackedTabId()
  const windowId = useCurrentWindowId()
  const recoveryCoordinator = useMemo(
    () =>
      createSeriesContextRecoveryCoordinator({
        requestRefresh: ({ tabId: targetTabId, windowId: targetWindowId }) =>
          chrome.runtime.sendMessage({
            type: "REQUEST_TAB_CONTEXT_REFRESH",
            payload: {
              tabId: targetTabId,
              windowId: targetWindowId,
              reason: "sidepanel-mount",
            },
          }),
      }),
    []
  )
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

    // A Side Panel can open after an MV3 worker restart or a dropped page
    // projection. Ask the background to own a fresh resolution instead of
    // leaving a persisted loading snapshot on screen indefinitely.
    void recoveryCoordinator
      .recoverIfNeeded({
        activeTabContext,
        hydrated,
        tabId,
        windowId,
      })
      .catch((error) =>
        logger.debug("[sidepanel] Context refresh request failed", error)
      )
  }, [activeTabContext, hydrated, recoveryCoordinator, tabId, windowId])

  const data = useMemo(() => {
    const derived = deriveSeriesContextFromActiveTabContext(activeTabContext)
    if (!derived.seriesId || derived.items.length === 0) return derived

    const downloadedChapterIds = new Set(
      downloadedChapters
        .filter(
          (chapter) =>
            chapter.siteIntegrationId === derived.siteId &&
            chapter.seriesId === derived.seriesId
        )
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
