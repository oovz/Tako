import { useCallback, useEffect, useState } from 'react'

import type { ChapterSelectionsBySeries } from '@/entrypoints/sidepanel/hooks/useChapterSelections'
import logger from '@/src/runtime/logger'

export function shouldMountInlineSelection(isInlineSelectionOpen: boolean): boolean {
  return isInlineSelectionOpen
}

export function useInlineSelectionState() {
  const [chapterSelectionsBySeries, setChapterSelectionsBySeries] = useState<ChapterSelectionsBySeries>({})
  const [isInlineSelectionOpen, setIsInlineSelectionOpen] = useState(false)

  const closeInlineSelection = useCallback(() => {
    setIsInlineSelectionOpen(false)
  }, [])

  const toggleInlineSelection = useCallback(() => {
    setIsInlineSelectionOpen((previousValue) => !previousValue)
  }, [])

  useEffect(() => {
    const handleActivated = () => {
      closeInlineSelection()
    }

    const handleUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.url) {
        closeInlineSelection()
      }
    }

    try {
      chrome.tabs.onActivated.addListener(handleActivated)
      chrome.tabs.onUpdated.addListener(handleUpdated)
    } catch (error) {
      logger.error('[CommandCenter] Failed to attach tab listeners:', error)
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
    isInlineSelectionOpen,
    closeInlineSelection,
    toggleInlineSelection,
  }
}

