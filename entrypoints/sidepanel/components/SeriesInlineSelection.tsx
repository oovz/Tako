import { playPanelMotion, stopPanelMotion } from "../hooks/panel-motion"
import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
import { PanelCheckbox } from "./PanelCheckbox"
import { DownloadLabel } from "./DownloadLabel"
import { SeriesContextCard } from "./SeriesContextCard"
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
import { Loader2 } from "lucide-react"
import { PanelIcon } from "./PanelIcon"
import { SelectionReview } from "./SelectionReview"
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

function SeriesSelectionLoading({
  data,
}: {
  data: SidepanelSeriesContextData
}) {
  return (
    <div className="manga-selection">
      <div className="manga-scroll">
        <SeriesContextCard data={data} />
        <div className="manga-controls manga-loading-status" role="status">
          {t(
            data.isLoading
              ? "sidepanel_loadingManga"
              : "sidepanel_loadingChapters"
          )}
        </div>
        <div aria-hidden="true">
          {[65, 51, 72, 47].map((width) => (
            <div key={width} className="manga-chapter manga-skeleton-row">
              <span />
              <span style={{ width: `${width}%` }} />
              <span />
            </div>
          ))}
        </div>
      </div>
      <div className="selection-footer">
        <button type="button" className="panel-primary" disabled>
          <PanelIcon name="download" />
          {t("sidepanel_downloadAction")}
        </button>
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
  const pill = useRef<HTMLSpanElement>(null)
  const from = useRef<DOMRect | null>(null)
  useLayoutEffect(() => {
    const previous = from.current
    from.current = null
    const element = pill.current
    if (
      !previous ||
      !element ||
      !matchMedia("(prefers-reduced-motion: no-preference)").matches ||
      document.documentElement.dataset.takoMotion === "reduce"
    )
      return
    stopPanelMotion(element)
    const end = element.getBoundingClientRect()
    const delta = previous.left + previous.width / 2 - end.left - end.width / 2
    playPanelMotion(
      element,
      [
        {
          transform:
            "translateX(" +
            delta +
            "px) scaleX(" +
            previous.width / end.width +
            ")",
        },
        {
          transform: "translateX(" + delta * 0.55 + "px) scale(1.14,.91)",
          offset: 0.42,
        },
        { transform: "translateX(0) scale(.98,1.02)", offset: 0.81 },
        { transform: "translateX(0) scale(1)" },
      ],
      230
    )
  }, [viewMode])
  const allSelected = selectedCount > 0 && selectedCount === selectableCount
  return (
    <div className="manga-controls">
      {canToggleView ? (
        <ToggleGroup
          type="single"
          value={viewMode}
          className="chapter-modes"
          data-view={viewMode}
          onValueChange={(value) => {
            if (
              (value === "volumes" || value === "chapters") &&
              value !== viewMode
            ) {
              from.current = pill.current?.getBoundingClientRect() ?? null
              updatePresentation((previous) => ({
                ...previous,
                viewMode: value,
              }))
            }
          }}
        >
          <span ref={pill} className="mode-pill" aria-hidden="true" />
          <ToggleGroupItem value="volumes" aria-label={t("sidepanel_volumes")}>
            <PanelIcon name="volumes" />
            <span>{t("sidepanel_volumes")}</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="chapters"
            aria-label={t("sidepanel_chaptersView")}
          >
            <PanelIcon name="chapters" />
            <span>{t("sidepanel_chaptersView")}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      ) : (
        <h3>{t("sidepanel_chaptersView")}</h3>
      )}
      <PanelCheckbox
        label={t("sidepanel_selectAllChapters")}
        id="select-all-ctx"
        aria-label={t("sidepanel_selectAllChapters")}
        title={t("sidepanel_selectAllChapters")}
        checked={
          selectedCount > 0 && !allSelected ? "indeterminate" : allSelected
        }
        onCheckedChange={onSelectAll}
        disabled={isEnqueuing || selectableCount === 0}
        className="select-all-toggle"
      />
    </div>
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
  const [reviewIds, setReviewIds] = useState<string[] | null>(null)
  const reviewTrigger = useRef<HTMLButtonElement>(null)
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null)
  const [body, setBody] = useState<HTMLDivElement | null>(null)
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
    return <SeriesSelectionLoading data={data} />
  }

  const handleStart = async () => {
    const selectedChapterIdsToStart = allChapters
      .filter((chapter) => chapter.selected && chapter.locked !== true)
      .map((chapter) => chapter.id)
    const didStart = await download.startDownload(selectedChapterIdsToStart)
    if (!didStart) return
    clearSeriesSelections()
    setReviewIds(null)
    onAfterStart?.()
  }

  return (
    <div className="manga-selection">
      <div className="manga-body" ref={setBody}>
        <div
          className="manga-scroll"
          ref={setScroll}
          inert={reviewIds !== null}
        >
          <SeriesContextCard data={data} />
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
            scrollElement={scroll}
            items={items}
            viewMode={viewMode}
            expandedGroups={expandedGroups}
            isEnqueuing={download.isEnqueuing}
            onToggleGroup={selection.handleVolumeToggle}
            onToggleChapter={selection.handleChapterSelect}
            onVolumeSelectAll={selection.handleVolumeSelectAll}
          />
        </div>
        {body && (
          <SelectionReview
            container={body}
            ids={reviewIds}
            chapters={allChapters}
            pending={download.isEnqueuing}
            errorMessage={download.errorMessage}
            onClose={() => setReviewIds(null)}
            onToggle={selection.handleChapterSelect}
            onClear={() => selection.handleSelectAll(false)}
            trigger={reviewTrigger}
          />
        )}
      </div>
      {download.errorMessage && reviewIds === null && (
        <p className="selection-error" role="alert">
          {download.errorMessage}
        </p>
      )}
      <div className="selection-footer">
        <div
          className="batch-actions"
          data-selected={selectedCount > 0 || reviewIds !== null}
        >
          <div className="review-slot">
            <button
              type="button"
              ref={reviewTrigger}
              className="batch-review"
              aria-label={t(
                reviewIds === null
                  ? "sidepanel_reviewSelection"
                  : "sidepanel_hideReview"
              )}
              aria-haspopup="dialog"
              aria-expanded={reviewIds !== null}
              disabled={download.isEnqueuing}
              tabIndex={selectedCount > 0 || reviewIds !== null ? 0 : -1}
              onClick={() =>
                setReviewIds(
                  reviewIds !== null
                    ? null
                    : allChapters
                        .filter((chapter) => chapter.selected)
                        .map((chapter) => chapter.id)
                )
              }
            >
              <PanelIcon name="list" />
            </button>
          </div>
          <Button
            type="button"
            className="panel-primary"
            disabled={selectedCount === 0 || download.isEnqueuing}
            aria-busy={download.isEnqueuing}
            aria-label={
              selectedCount
                ? t("sidepanel_downloadCount", [String(selectedCount)])
                : t("sidepanel_downloadAction")
            }
            onClick={handleStart}
          >
            {download.isEnqueuing ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <PanelIcon name="download" />
            )}
            <DownloadLabel count={selectedCount} />
          </Button>
        </div>
      </div>
    </div>
  )
}
