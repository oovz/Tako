import { useCallback, useEffect, useState } from "react"

import type { ChapterSelectionsBySeries } from "@/entrypoints/sidepanel/hooks/useChapterSelections"
import type { InlineSelectionPresentationBySeries } from "@/entrypoints/sidepanel/types"
import {
  isExtensionUrl,
  resolveTabUrlForSupportCheck,
} from "@/entrypoints/sidepanel/hooks/sidepanelActiveTabHelpers"
import logger from "@/src/runtime/logger"

export function useInlineSelectionState() {
  const [chapterSelectionsBySeries, setChapterSelectionsBySeries] =
    useState<ChapterSelectionsBySeries>({})
  const [presentationBySeries, setPresentationBySeries] =
    useState<InlineSelectionPresentationBySeries>({})
  const [isInlineSelectionOpen, setIsInlineSelectionOpen] = useState(false)

  const closeInlineSelection = useCallback(() => {
    setIsInlineSelectionOpen(false)
  }, [])

  const setInlineSelectionOpen = useCallback((open: boolean) => {
    setIsInlineSelectionOpen(open)
  }, [])

  useEffect(() => {
    const handleActivated = (activeInfo: chrome.tabs.OnActivatedInfo) => {
      void (async () => {
        try {
          const activeTab = await chrome.tabs.get(activeInfo.tabId)
          if (isExtensionUrl(resolveTabUrlForSupportCheck(activeTab))) {
            return
          }
        } catch {
          // Fall through and close the selector when tab metadata cannot be read.
        }

        closeInlineSelection()
      })()
    }

    const handleUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab
    ) => {
      const nextUrl = changeInfo.url ?? resolveTabUrlForSupportCheck(tab)
      if (!changeInfo.url || isExtensionUrl(nextUrl)) return

      closeInlineSelection()
    }

    try {
      chrome.tabs.onActivated.addListener(handleActivated)
      chrome.tabs.onUpdated.addListener(handleUpdated)
    } catch (error) {
      logger.error("[CommandCenter] Failed to attach tab listeners:", error)
    }

    return () => {
      try {
        chrome.tabs.onActivated.removeListener(handleActivated)
        chrome.tabs.onUpdated.removeListener(handleUpdated)
      } catch {
        // ignore cleanup errors
      }
    }
  }, [closeInlineSelection])

  return {
    chapterSelectionsBySeries,
    setChapterSelectionsBySeries,
    presentationBySeries,
    setPresentationBySeries,
    isInlineSelectionOpen,
    closeInlineSelection,
    setInlineSelectionOpen,
  }
}
