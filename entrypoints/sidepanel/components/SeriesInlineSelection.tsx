import React, { useCallback, useMemo } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type {
  InlineSelectionPresentationBySeries,
  InlineSelectionPresentationState,
  InlineSelectionViewMode,
} from "@/entrypoints/sidepanel/types"
import type { ChapterSelectionsBySeries } from "@/entrypoints/sidepanel/hooks/useChapterSelections"
import type { SidepanelSeriesContextData } from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"
import { useSelection } from "@/entrypoints/sidepanel/hooks/useSelection"
import { useDownload } from "@/entrypoints/sidepanel/hooks/useDownload"
import {
  buildSeriesKey,
  useChapterSelections,
} from "@/entrypoints/sidepanel/hooks/useChapterSelections"
import { ChapterSelector } from "@/entrypoints/sidepanel/components/ChapterSelector"
import {
  buildInlineSelectionItems,
  getExpandedGroupKeys,
  getInlineSelectionChapters,
  getInlineSelectionCounts,
  updateCollapsedInlineGroups,
  getInlineSelectionPresentation,
  getInlineSelectionViewSummary,
  updateInlineSelectionPresentation,
} from "@/entrypoints/sidepanel/components/series-inline-selection-helpers"
import { Download, ListChecks, Loader2 } from "lucide-react"
import { t } from "@/src/runtime/i18n"

interface SeriesInlineSelectionProps {
  data: SidepanelSeriesContextData
  chapterSelectionsBySeries: ChapterSelectionsBySeries
  setChapterSelectionsBySeries: React.Dispatch<
    React.SetStateAction<ChapterSelectionsBySeries>
  >
  presentationBySeries: InlineSelectionPresentationBySeries
  setPresentationBySeries: React.Dispatch<
    React.SetStateAction<InlineSelectionPresentationBySeries>
  >
  onAfterStart?: () => void
}

type PresentationUpdater = (
  update: (
    previous: InlineSelectionPresentationState
  ) => InlineSelectionPresentationState
) => void

function SeriesSelectionLoading() {
  return (
    <div
      className="flex flex-col h-full"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={t("common_loading")}
    >
      <div className="px-3 py-2 bg-muted/50 border-b border-border">
        <div className="h-4 w-24 bg-muted rounded" />
      </div>
      <div className="flex-1 p-3 flex flex-col gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 bg-muted rounded" />
        ))}
      </div>
    </div>
  )
}

function SeriesSelectionToolbar({
  selectedCount,
  selectableCount,
  isEnqueuing,
  onSelectAll,
  canToggleView,
  viewMode,
  updatePresentation,
}: {
  selectedCount: number
  selectableCount: number
  isEnqueuing: boolean
  onSelectAll: (checked: boolean | "indeterminate") => void
  canToggleView: boolean
  viewMode: InlineSelectionViewMode
  updatePresentation: PresentationUpdater
}) {
  const allSelected = selectedCount > 0 && selectedCount === selectableCount
  const partiallySelected = selectedCount > 0 && !allSelected
  const selectAllLabel = t("sidepanel_selectAllChapters")

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-background">
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <Checkbox
            id="select-all-ctx"
            aria-label={selectAllLabel}
            title={selectAllLabel}
            checked={partiallySelected ? "indeterminate" : allSelected}
            onCheckedChange={onSelectAll}
            disabled={isEnqueuing || selectableCount === 0}
            className="size-8 cursor-pointer rounded-md border-input data-[state=unchecked]:hover:bg-muted"
            uncheckedIndicator={
              selectedCount === 0 && (
                <ListChecks aria-hidden="true" className="size-4" />
              )
            }
          />
          <span className="shrink-0 text-xs text-muted-foreground">
            {selectedCount > 0
              ? t("sidepanel_selectedCount", [String(selectedCount)])
              : t("sidepanel_availableCount", [String(selectableCount)])}
          </span>
        </div>

        {canToggleView && (
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(value) => {
              if (value === "volumes" || value === "chapters") {
                updatePresentation((previous) =>
                  previous.viewMode === value
                    ? previous
                    : { ...previous, viewMode: value }
                )
              }
            }}
            className="rounded-md bg-muted p-1"
          >
            <ToggleGroupItem
              value="volumes"
              aria-label={t("sidepanel_volumes")}
              className="h-8 flex-1 rounded-sm border-0 px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-background hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-none"
            >
              {t("sidepanel_volumes")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="chapters"
              aria-label={t("sidepanel_allChapters")}
              className="h-8 flex-1 rounded-sm border-0 px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-background hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-none"
            >
              {t("sidepanel_allChapters")}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
    </div>
  )
}

function SeriesSelectionFooter({
  download,
  selectedCount,
  onStart,
}: {
  download: ReturnType<typeof useDownload>
  selectedCount: number
  onStart: () => Promise<void>
}) {
  return (
    <>
      {download.errorMessage && (
        <p
          role="alert"
          className="border-t border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
        >
          {download.errorMessage}
        </p>
      )}

      <div className="shrink-0 bg-background px-3 py-2.5">
        <Button
          type="button"
          className="h-10 w-full gap-2 text-sm font-semibold tabular-nums"
          onClick={download.isEnqueuing ? undefined : onStart}
          disabled={selectedCount === 0}
          aria-disabled={download.isEnqueuing || undefined}
          aria-busy={download.isEnqueuing || undefined}
        >
          {download.isEnqueuing ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Download aria-hidden="true" className="size-4" />
          )}
          {t("sidepanel_downloadCount", [String(selectedCount)])}
        </Button>
      </div>
    </>
  )
}

export function SeriesInlineSelection({
  data,
  chapterSelectionsBySeries,
  setChapterSelectionsBySeries,
  presentationBySeries,
  setPresentationBySeries,
  onAfterStart,
}: SeriesInlineSelectionProps) {
  const seriesKey = useMemo(
    () => buildSeriesKey(data.siteId, data.seriesId),
    [data.siteId, data.seriesId]
  )
  const { selectedChapterIds, setSelectedChapterIds, clearSeriesSelections } =
    useChapterSelections(
      seriesKey,
      chapterSelectionsBySeries,
      setChapterSelectionsBySeries
    )

  const presentation = getInlineSelectionPresentation(
    presentationBySeries,
    seriesKey
  )
  const collapsedGroups = useMemo(
    () => new Set(presentation.collapsedGroupIds),
    [presentation.collapsedGroupIds]
  )
  const viewMode: InlineSelectionViewMode = presentation.viewMode

  const updatePresentation = useCallback(
    (
      update: (
        previous: InlineSelectionPresentationState
      ) => InlineSelectionPresentationState
    ) => {
      setPresentationBySeries((previousBySeries) =>
        updateInlineSelectionPresentation(previousBySeries, seriesKey, update)
      )
    },
    [seriesKey, setPresentationBySeries]
  )

  const setCollapsedGroupsUpdater = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      updatePresentation((previous) =>
        updateCollapsedInlineGroups(previous, updater)
      )
    },
    [updatePresentation]
  )

  const items = useMemo(
    () => buildInlineSelectionItems(data.items, selectedChapterIds),
    [data.items, selectedChapterIds]
  )

  const download = useDownload({
    windowId: data.windowId,
    tabId: data.tabId,
    mangaState: data.mangaState,
    seriesRevision: data.seriesRevision,
  })

  // Selection controls remain available while prior tasks exist.
  // The UI only blocks during the active enqueue request.
  const selection = useSelection({
    items,
    setSelectedChapterIds,
    setCollapsedGroups: setCollapsedGroupsUpdater,
    tabId: data.tabId,
    isDownloading: download.isEnqueuing, // Only block during actual enqueue request
  })

  const allChapters = useMemo(() => getInlineSelectionChapters(items), [items])
  const { selectedCount, selectableCount } = useMemo(
    () => getInlineSelectionCounts(allChapters),
    [allChapters]
  )

  const expandedGroups = useMemo(
    () => getExpandedGroupKeys(data.items, collapsedGroups),
    [data.items, collapsedGroups]
  )
  const viewSummary = useMemo(
    () => getInlineSelectionViewSummary(items),
    [items]
  )

  if (data.blockingMessage) {
    return null
  }

  if (data.isLoading || data.isChaptersLoading) {
    return <SeriesSelectionLoading />
  }

  const handleStart = async () => {
    const selectedChapterIdsToStart = allChapters
      .filter((chapter) => chapter.selected && chapter.locked !== true)
      .map((chapter) => chapter.id)
    const didStart = await download.startDownload(selectedChapterIdsToStart)
    if (!didStart) return
    clearSeriesSelections()
    onAfterStart?.()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SeriesSelectionToolbar
        selectedCount={selectedCount}
        selectableCount={selectableCount}
        isEnqueuing={download.isEnqueuing}
        onSelectAll={selection.handleSelectAll}
        canToggleView={viewSummary.canToggleView}
        viewMode={viewMode}
        updatePresentation={updatePresentation}
      />

      <ChapterSelector
        items={items}
        viewMode={viewMode}
        expandedGroups={expandedGroups}
        isEnqueuing={download.isEnqueuing}
        onToggleGroup={selection.handleVolumeToggle}
        onToggleChapter={selection.handleChapterSelect}
        onVolumeSelectAll={selection.handleVolumeSelectAll}
      />

      <SeriesSelectionFooter
        download={download}
        selectedCount={selectedCount}
        onStart={handleStart}
      />
    </div>
  )
}
