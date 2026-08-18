import { useCallback, useEffect, useRef, useState } from "react"

import {
  resolveTabUrlForSupportCheck,
  resolveTrackedTabId,
} from "@/entrypoints/sidepanel/hooks/sidepanelActiveTabHelpers"
import logger from "@/src/runtime/logger"

export function createTrackedTabRefreshCoordinator(input: {
  queryActiveTab: () => Promise<chrome.tabs.Tab[]>
  commit: (tabId: number | undefined, activeUrl: string | undefined) => void
}) {
  let latestRequestId = 0
  let disposed = false

  return {
    async refresh(): Promise<void> {
      const requestId = ++latestRequestId
      try {
        const [activeTab] = await input.queryActiveTab()
        if (disposed || requestId !== latestRequestId) return

        const activeUrl = resolveTabUrlForSupportCheck(activeTab)
        const nextTrackedTabId = resolveTrackedTabId(activeTab)
        logger.debug("[sidepanel] Refreshed tracked active tab candidate", {
          activeTabId: activeTab?.id,
          activeUrl,
          nextTrackedTabId,
        })
        input.commit(
          nextTrackedTabId,
          nextTrackedTabId === activeTab?.id ? activeUrl : undefined
        )
      } catch (error) {
        if (disposed || requestId !== latestRequestId) return
        logger.debug("[sidepanel] Failed to refresh tracked active tab", error)
        input.commit(undefined, undefined)
      }
    },
    dispose(): void {
      disposed = true
      latestRequestId++
    },
  }
}

export function useSidepanelTrackedTabId(): {
  tabId: number | undefined
  activeUrl: string | undefined
} {
  const [trackedTab, setTrackedTab] = useState<{
    tabId: number | undefined
    activeUrl: string | undefined
  }>({ tabId: undefined, activeUrl: undefined })
  const tabIdRef = useRef<number | undefined>(undefined)
  const activeUrlRef = useRef<string | undefined>(undefined)

  const commitTrackedTab = useCallback(
    (nextTabId: number | undefined, nextActiveUrl: string | undefined) => {
      const activeUrl =
        nextTabId === tabIdRef.current && nextActiveUrl === undefined
          ? activeUrlRef.current
          : nextActiveUrl
      logger.debug("[sidepanel] Updating tracked tab", {
        previousTabId: tabIdRef.current,
        previousActiveUrl: activeUrlRef.current,
        nextTabId,
        nextActiveUrl: activeUrl,
      })
      tabIdRef.current = nextTabId
      activeUrlRef.current = activeUrl
      setTrackedTab({ tabId: nextTabId, activeUrl })
    },
    []
  )

  useEffect(() => {
    logger.debug("[sidepanel] Initializing tracked-tab hook")
    const coordinator = createTrackedTabRefreshCoordinator({
      queryActiveTab: () =>
        chrome.tabs.query({ currentWindow: true, active: true }),
      commit: commitTrackedTab,
    })
    const handleActivated = (activeInfo: {
      tabId: number
      windowId: number
    }) => {
      logger.debug("[sidepanel] Active tab changed", {
        reason: "tabs.onActivated",
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
        previousTrackedTabId: tabIdRef.current,
      })
      if (tabIdRef.current !== activeInfo.tabId) {
        void coordinator.refresh()
      }
    }
    const handleUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab
    ) => {
      if (!changeInfo.url || !tab.active) return
      if (tabIdRef.current !== undefined && tabIdRef.current !== updatedTabId)
        return

      void coordinator.refresh()
    }

    void coordinator.refresh()
    chrome.tabs.onActivated.addListener(handleActivated)
    chrome.tabs.onUpdated.addListener(handleUpdated)
    return () => {
      logger.debug("[sidepanel] Disposing tracked-tab hook")
      coordinator.dispose()
      chrome.tabs.onActivated.removeListener(handleActivated)
      chrome.tabs.onUpdated.removeListener(handleUpdated)
    }
  }, [commitTrackedTab])

  return trackedTab
}
