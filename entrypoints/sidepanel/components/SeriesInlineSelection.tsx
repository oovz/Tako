import React, { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/src/shared/utils'
import type { SidePanelChapter } from '@/entrypoints/sidepanel/types'
import type { ChapterSelectionsBySeries } from '@/entrypoints/sidepanel/hooks/useChapterSelections'
import type { SidepanelSeriesContextData } from '@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext'
import { useSelection } from '@/entrypoints/sidepanel/hooks/useSelection'
import { useDownload } from '@/entrypoints/sidepanel/hooks/useDownload'
import { buildSeriesKey, useChapterSelections } from '@/entrypoints/sidepanel/hooks/useChapterSelections'
import { ChapterSelector } from '@/entrypoints/sidepanel/components/ChapterSelector'
import {
  getExpandedGroupKeys,
  getInlineSelectionViewSummary,
  syncInlineSelectionItems,
} from '@/entrypoints/sidepanel/components/series-inline-selection-helpers'
import { Check, Download } from 'lucide-react'
import { t } from '@/src/runtime/i18n'

interface SeriesInlineSelectionProps {
  data: SidepanelSeriesContextData
  chapterSelectionsBySeries: ChapterSelectionsBySeries
  setChapterSelectionsBySeries: React.Dispatch<React.SetStateAction<ChapterSelectionsBySeries>>
  onAfterStart?: () => void
}

export function SeriesInlineSelection({
  data,
  chapterSelectionsBySeries,
  setChapterSelectionsBySeries,
  onAfterStart,
}: SeriesInlineSelectionProps) {
  const seriesKey = useMemo(
    () => buildSeriesKey(data.siteId, data.seriesId),
    [data.siteId, data.seriesId],
  )
  const { selectedChapterIds, setSelectedChapterIds, clearSeriesSelections } = useChapterSelections(
    seriesKey,
    chapterSelectionsBySeries,
    setChapterSelectionsBySeries,
  )

  const [items, setItems] = useState(() => syncInlineSelectionItems(data.items, selectedChapterIds))

  useEffect(() => {
    setItems(previousItems => syncInlineSelectionItems(data.items, selectedChapterIds, previousItems))
  }, [data.items, selectedChapterIds])

  useEffect(() => {
    const nextSelected = items.flatMap((item) => {
      if ('chapters' in item) {
        return item.chapters.filter((chapter) => chapter.selected).map((chapter) => chapter.id)
      }

      return item.selected ? [item.id] : []
    })

    setSelectedChapterIds(nextSelected)
  }, [items, setSelectedChapterIds])

  const downloadHook = useDownload({ tabId: data.tabId, mangaState: data.mangaState })
  const download = downloadHook

  // Selection controls remain available while prior tasks exist.
  // The UI only blocks during the active enqueue request.
  const selection = useSelection({
    items,
    setItems,
    tabId: data.tabId,
    isDownloading: download.isEnqueuing, // Only block during actual enqueue request
  })

  const allChapters = useMemo(() => {
    const chapters: SidePanelChapter[] = []
    items.forEach(item => {
      if ('chapters' in item) chapters.push(...item.chapters)
      else chapters.push(item)
    })
    return chapters
  }, [items])

  const { selectedCount, selectableCount } = useMemo(() => {
    const selectableChapters = allChapters.filter(ch => ch.locked !== true)
    return {
      selectedCount: selectableChapters.filter(ch => ch.selected).length,
      selectableCount: selectableChapters.length,
    }
  }, [allChapters])

  const [viewMode, setViewMode] = useState<'volumes' | 'chapters'>('volumes')
  const expandedGroups = useMemo(() => getExpandedGroupKeys(items), [items])
  const viewSummary = useMemo(() => getInlineSelectionViewSummary(items), [items])

  if (data.blockingMessage) {
    return null
  }

  if (data.isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 bg-muted/50 border-b border-border">
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex-1 p-3 flex flex-col gap-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-8 bg-muted rounded animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  const handleStart = async () => {
    const selectedChapterIdsToStart = allChapters
      .filter((chapter) => chapter.selected && chapter.locked !== true)
      .map((chapter) => chapter.id)
    const didStart = await download.startDownload(selectedChapterIdsToStart)
    if (didStart) {
      clearSeriesSelections()
    }

    if (didStart && onAfterStart) {
      onAfterStart()
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="flex flex-col gap-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <label
                htmlFor="select-all-ctx"
                className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
              >
                <Checkbox
                  id="select-all-ctx"
                  checked={selectedCount > 0 && selectedCount === selectableCount}
                  onCheckedChange={selection.handleSelectAll}
                  disabled={download.isEnqueuing || selectableCount === 0}
                />
                <span>{t('sidepanel_selectChaptersLabel')}</span>
              </label>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {selectedCount > 0 ? t('sidepanel_selectedCount', [String(selectedCount)]) : t('sidepanel_availableCount', [String(selectableCount)])}
            </span>
          </div>

          {viewSummary.canToggleView && (
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(value) => {
                if (value === 'volumes' || value === 'chapters') setViewMode(value)
              }}
              className="rounded-md bg-muted p-1"
            >
              <ToggleGroupItem
                value="volumes"
                aria-label={t('sidepanel_volumes')}
                className="h-8 flex-1 rounded-sm border-0 px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-background hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-none"
              >
                {t('sidepanel_volumes')}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="chapters"
                aria-label={t('sidepanel_allChapters')}
                className="h-8 flex-1 rounded-sm border-0 px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-background hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-none"
              >
                {t('sidepanel_allChapters')}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
      </div>

      <ChapterSelector
        items={items}
        viewMode={viewMode}
        expandedGroups={expandedGroups}
        isEnqueuing={download.isEnqueuing}
        onToggleGroup={selection.handleVolumeToggle}
        onToggleChapter={selection.handleChapterSelect}
        onVolumeSelectAll={selection.handleVolumeSelectAll}
      />

      <div
        className={cn(
          'overflow-hidden border-t border-border bg-background transition-[max-height,opacity] duration-200 ease-out motion-reduce:transition-none',
          selectedCount > 0 && !download.isEnqueuing ? 'max-h-[64px] opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <div className="h-[64px] px-3 py-2.5">
          <Button
            type="button"
            className="h-10 w-full gap-2 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none"
            onClick={handleStart}
            disabled={download.isEnqueuing}
          >
            {download.showSuccess ? (
              <>
                <Check className="size-4" />
                {t('sidepanel_addedToQueue')}
              </>
            ) : (
              <>
                <Download className="size-4" />
                {t('sidepanel_downloadCount', [String(selectedCount)])}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

