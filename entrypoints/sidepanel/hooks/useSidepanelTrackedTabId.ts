import { useCallback, useEffect, useRef, useState } from 'react'

import {
  resolveTabUrlForSupportCheck,
} from '@/entrypoints/sidepanel/hooks/sidepanelActiveTabHelpers'
import logger from '@/src/runtime/logger'

function isExtensionUrl(url: string | undefined): boolean {
  return !!url && url.startsWith('chrome-extension://')
}

export function useSidepanelTrackedTabId(): number | undefined {
  const [tabId, setTabId] = useState<number | undefined>(undefined)
  const tabIdRef = useRef<number | undefined>(undefined)

  const setTrackedTabId = useCallback((nextTabId: number | undefined) => {
    logger.debug('[sidepanel] Updating tracked tab id', {
      previousTabId: tabIdRef.current,
      nextTabId,
    })
    tabIdRef.current = nextTabId
    setTabId(nextTabId)
  }, [])

  const refreshTrackedActiveTab = useCallback(async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ currentWindow: true, active: true })
      const activeUrl = resolveTabUrlForSupportCheck(activeTab)
      const candidate = typeof activeTab?.id === 'number'
        ? await chrome.tabs.get(activeTab.id).catch(() => undefined)
        : undefined
      logger.debug('[sidepanel] Refreshed tracked active tab candidate', {
        activeTabId: activeTab?.id,
        activeUrl,
        candidateTabId: candidate?.id,
        candidateUrl: resolveTabUrlForSupportCheck(candidate ?? undefined),
      })
      if (isExtensionUrl(activeUrl)) {
        setTrackedTabId(undefined)
        return
      }
      setTrackedTabId(activeTab?.id)
    } catch (error) {
      logger.debug('[sidepanel] Failed to refresh tracked active tab', error)
      setTrackedTabId(undefined)
    }
  }, [setTrackedTabId])

  useEffect(() => {
    logger.debug('[sidepanel] Initializing tracked-tab hook')
    void refreshTrackedActiveTab()
    return () => {
      logger.debug('[sidepanel] Disposing tracked-tab hook')
    }
  }, [refreshTrackedActiveTab])

  useEffect(() => {
    const handleActivated = (activeInfo: { tabId: number; windowId: number }) => {
      void (async () => {
        try {
          if (tabIdRef.current !== activeInfo.tabId) {
            await refreshTrackedActiveTab()
          }
        } catch {
          if (tabIdRef.current !== activeInfo.tabId) {
            await refreshTrackedActiveTab()
          }
        }
      })()
    }

    chrome.tabs.onActivated.addListener(handleActivated)
    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated)
    }
  }, [refreshTrackedActiveTab])

  useEffect(() => {
    const handleUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (!changeInfo.url || !tab.active) return
      if (tabIdRef.current !== undefined && tabIdRef.current !== updatedTabId) return

      void refreshTrackedActiveTab()
    }

    chrome.tabs.onUpdated.addListener(handleUpdated)
    return () => {
      chrome.tabs.onUpdated.removeListener(handleUpdated)
    }
  }, [refreshTrackedActiveTab])

  return tabId
}

