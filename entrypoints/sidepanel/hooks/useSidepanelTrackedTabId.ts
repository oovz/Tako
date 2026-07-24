import { useCallback, useEffect, useRef, useState } from "react"

import {
  resolveTabUrlForSupportCheck,
  resolveTrackedTabId,
} from "@/entrypoints/sidepanel/hooks/sidepanelActiveTabHelpers"
import logger from "@/src/runtime/logger"

export function createTrackedTabRefreshCoordinator(input: {
  queryActiveTab: () => Promise<chrome.tabs.Tab[]>
  getCurrentTabId: () => number | undefined
  commit: (tabId: number | undefined) => void
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
        const nextTrackedTabId = resolveTrackedTabId(
          input.getCurrentTabId(),
          activeTab
        )
        logger.debug("[sidepanel] Refreshed tracked active tab candidate", {
          activeTabId: activeTab?.id,
          activeUrl,
          nextTrackedTabId,
        })
        input.commit(nextTrackedTabId)
      } catch (error) {
        if (disposed || requestId !== latestRequestId) return
        logger.debug("[sidepanel] Failed to refresh tracked active tab", error)
        input.commit(undefined)
      }
    },
    dispose(): void {
      disposed = true
      latestRequestId++
    },
  }
}

export function useSidepanelTrackedTabId(): number | undefined {
  const [tabId, setTabId] = useState<number | undefined>(undefined)
  const tabIdRef = useRef<number | undefined>(undefined)

  const setTrackedTabId = useCallback((nextTabId: number | undefined) => {
    logger.debug("[sidepanel] Updating tracked tab id", {
      previousTabId: tabIdRef.current,
      nextTabId,
    })
    tabIdRef.current = nextTabId
    setTabId(nextTabId)
  }, [])

  useEffect(() => {
    logger.debug("[sidepanel] Initializing tracked-tab hook")
    const coordinator = createTrackedTabRefreshCoordinator({
      queryActiveTab: () =>
        chrome.tabs.query({ currentWindow: true, active: true }),
      getCurrentTabId: () => tabIdRef.current,
      commit: setTrackedTabId,
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
  }, [setTrackedTabId])

  return tabId
}
