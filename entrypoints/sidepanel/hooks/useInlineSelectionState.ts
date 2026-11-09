import { useCallback, useState } from "react"

import type { ChapterSelectionsBySeries } from "@/entrypoints/sidepanel/hooks/useChapterSelections"
import type { InlineSelectionPresentationBySeries } from "@/entrypoints/sidepanel/types"
import type { SidepanelSeriesContextData } from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"

export function useInlineSelectionState({
  windowId,
  tabId,
  seriesRevision,
  siteId,
  seriesId,
  items,
  isChaptersLoading,
}: Pick<SidepanelSeriesContextData, "windowId" | "tabId" | "seriesRevision"> &
  Partial<
    Pick<
      SidepanelSeriesContextData,
      "siteId" | "seriesId" | "items" | "isChaptersLoading"
    >
  >) {
  const [chapterSelectionsBySeries, setChapterSelectionsBySeries] =
    useState<ChapterSelectionsBySeries>({})
  const [presentationBySeries, setPresentationBySeries] =
    useState<InlineSelectionPresentationBySeries>({})
  const seriesKey = siteId && seriesId ? siteId + "#" + seriesId : undefined
  if (
    seriesKey &&
    items &&
    !isChaptersLoading &&
    !presentationBySeries[seriesKey]
  ) {
    setPresentationBySeries({
      ...presentationBySeries,
      [seriesKey]: {
        viewMode: "volumes",
        collapsedGroupIds: items.flatMap((item) =>
          "chapters" in item ? [item.groupId] : []
        ),
      },
    })
  }
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
