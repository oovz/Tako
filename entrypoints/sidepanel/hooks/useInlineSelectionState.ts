import { useCallback, useState } from "react"

import type { ChapterSelectionsBySeries } from "@/entrypoints/sidepanel/hooks/useChapterSelections"
import type { InlineSelectionPresentationBySeries } from "@/entrypoints/sidepanel/types"
import type { SidepanelSeriesContextData } from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"

export function useInlineSelectionState({
  windowId,
  tabId,
  seriesRevision,
}: Pick<SidepanelSeriesContextData, "windowId" | "tabId" | "seriesRevision">) {
  const [chapterSelectionsBySeries, setChapterSelectionsBySeries] =
    useState<ChapterSelectionsBySeries>({})
  const [presentationBySeries, setPresentationBySeries] =
    useState<InlineSelectionPresentationBySeries>({})
  const [selectionContext, setSelectionContext] = useState({
    windowId,
    tabId,
    seriesRevision,
    isOpen: false,
  })
  const contextChanged =
    selectionContext.windowId !== windowId ||
    selectionContext.tabId !== tabId ||
    selectionContext.seriesRevision !== seriesRevision

  if (contextChanged) {
    setSelectionContext({ windowId, tabId, seriesRevision, isOpen: false })
  }

  const closeInlineSelection = useCallback(() => {
    setSelectionContext((previous) => ({ ...previous, isOpen: false }))
  }, [])

  const setInlineSelectionOpen = useCallback((isOpen: boolean) => {
    setSelectionContext((previous) => ({ ...previous, isOpen }))
  }, [])

  return {
    chapterSelectionsBySeries,
    setChapterSelectionsBySeries,
    presentationBySeries,
    setPresentationBySeries,
    isInlineSelectionOpen: !contextChanged && selectionContext.isOpen,
    closeInlineSelection,
    setInlineSelectionOpen,
  }
}
