import {
  resolveTabUrlForSupportCheck,
  resolveTrackedTabId,
} from "./sidepanelActiveTabHelpers"
import logger from "@/src/runtime/logger"

export function createTrackedTabRefreshCoordinator(input: {
  queryActiveTab: () => Promise<chrome.tabs.Tab[]>
  commit: (tabId: number | undefined, activeUrl: string | undefined) => void
}) {
  let latestRequestId = 0
  let disposed = false
  const isCurrent = (requestId: number) =>
    !disposed && requestId === latestRequestId

  function commit(activeTab: chrome.tabs.Tab | undefined) {
    const activeUrl = resolveTabUrlForSupportCheck(activeTab)
    const tabId = resolveTrackedTabId(activeTab)
    input.commit(tabId, tabId === activeTab?.id ? activeUrl : undefined)
  }

  return {
    async refresh(): Promise<void> {
      const requestId = ++latestRequestId
      try {
        const [activeTab] = await input.queryActiveTab()
        if (isCurrent(requestId)) commit(activeTab)
      } catch (error) {
        if (!isCurrent(requestId)) return
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

function shouldRefreshUpdatedTab(
  windowId: number,
  trackedTabId: number | undefined,
  updatedTabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab
) {
  if (!changeInfo.url || !tab.active || tab.windowId !== windowId) return false
  return trackedTabId === undefined || trackedTabId === updatedTabId
}

export function subscribeToTrackedTab(input: {
  windowId: number
  getTrackedTabId: () => number | undefined
  commit: (tabId: number | undefined, activeUrl: string | undefined) => void
}) {
  const coordinator = createTrackedTabRefreshCoordinator({
    queryActiveTab: () =>
      chrome.tabs.query({ windowId: input.windowId, active: true }),
    commit: input.commit,
  })
  const handleActivated = (activeInfo: chrome.tabs.OnActivatedInfo) => {
    if (
      activeInfo.windowId === input.windowId &&
      input.getTrackedTabId() !== activeInfo.tabId
    ) {
      void coordinator.refresh()
    }
  }
  const handleUpdated = (
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab
  ) => {
    if (
      shouldRefreshUpdatedTab(
        input.windowId,
        input.getTrackedTabId(),
        tabId,
        changeInfo,
        tab
      )
    ) {
      void coordinator.refresh()
    }
  }
  void coordinator.refresh()
  chrome.tabs.onActivated.addListener(handleActivated)
  chrome.tabs.onUpdated.addListener(handleUpdated)
  return () => {
    coordinator.dispose()
    chrome.tabs.onActivated.removeListener(handleActivated)
    chrome.tabs.onUpdated.removeListener(handleUpdated)
  }
}
