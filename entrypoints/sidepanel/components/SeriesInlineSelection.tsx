import React, { useEffect, useMemo, useState } from 'react'

import { Download, Check, MoreVertical } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/src/shared/utils'
import type { SidePanelChapter, VolumeOrChapter } from '@/entrypoints/sidepanel/types'
import type { ChapterSelectionsBySeries } from '@/entrypoints/sidepanel/hooks/useChapterSelections'
import type { SidepanelSeriesContextData } from '@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext'
import { useSelection } from '@/entrypoints/sidepanel/hooks/useSelection'
import { useDownload } from '@/entrypoints/sidepanel/hooks/useDownload'
import { buildSeriesKey, useChapterSelections } from '@/entrypoints/sidepanel/hooks/useChapterSelections'
import { ChapterSelector } from '@/entrypoints/sidepanel/components/ChapterSelector'

interface SeriesInlineSelectionProps {
  data: SidepanelSeriesContextData
  chapterSelectionsBySeries: ChapterSelectionsBySeries
  setChapterSelectionsBySeries: React.Dispatch<React.SetStateAction<ChapterSelectionsBySeries>>
  onAfterStart?: () => void
}

function getGroupKey(item: VolumeOrChapter): string {
  if ('chapters' in item) {
    return item.groupId
  }

  return `standalone-${item.id}`
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

  const [items, setItems] = useState(data.items)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    setItems(prevItems => {
      const selectedSet = new Set(selectedChapterIds)
      const collapsedStateMap = new Map<string, boolean>()
      prevItems.forEach(item => {
        if ('chapters' in item) collapsedStateMap.set(item.groupId, item.collapsed)
      })
      return data.items.map(item => {
        if ('chapters' in item) {
          const preserved = collapsedStateMap.get(item.groupId)
          return {
            ...item,
            collapsed: preserved ?? item.collapsed,
            chapters: item.chapters.map((chapter) => ({
              ...chapter,
              selected: selectedSet.has(chapter.id),
            })),
          }
        }
        return {
          ...item,
          selected: selectedSet.has(item.id),
        }
      })
    })
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

  useEffect(() => {
    // Expand ALL volume groups by default for better UX
    const allExpanded = new Set<string>()
    items.forEach((item) => {
      if ('chapters' in item) {
        allExpanded.add(getGroupKey(item))
      }
    })
    setExpandedGroups(allExpanded)
  }, [items.length])

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

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }

  if (data.blockingMessage) {
    return null
  }

  if (data.isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 bg-muted/50 border-b border-border">
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex-1 p-3 space-y-2">
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
      {/* Selection controls - enlarged for better visibility */}
      <div className="px-3 py-2.5 bg-muted/50 border-b border-border flex items-center justify-between text-sm sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <Checkbox
            id="select-all-ctx"
            checked={selectedCount > 0 && selectedCount === selectableCount}
            onCheckedChange={selection.handleSelectAll}
            disabled={download.isEnqueuing || selectableCount === 0}
          />
          <label
            htmlFor="select-all-ctx"
            className="font-medium cursor-pointer select-none text-muted-foreground"
          >
            {selectedCount} selected
          </label>
        </div>
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            aria-label={viewMode === 'chapters' ? 'Group by Volume' : 'Show All Chapters'}
            onClick={() => setViewMode((currentViewMode) => currentViewMode === 'chapters' ? 'volumes' : 'chapters')}
          >
            <MoreVertical className="h-3.5 w-3.5" />
            {viewMode === 'chapters' ? 'Group by Volume' : 'Show All Chapters'}
          </Button>
        </div>
      </div>

      <ChapterSelector
        items={items}
        viewMode={viewMode}
        expandedGroups={expandedGroups}
        isEnqueuing={download.isEnqueuing}
        onToggleGroup={toggleGroup}
        onToggleChapter={selection.handleChapterSelect}
        onVolumeSelectAll={selection.handleVolumeSelectAll}
      />

      {/* Download button footer - enlarged for better visibility */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-200 ease-out',
          selectedCount > 0 && !download.isEnqueuing ? 'max-h-[64px] opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <div className="h-[64px] px-3 py-2.5 bg-background border-t border-border">
          <Button
            type="button"
            className="w-full gap-2 h-10 text-sm shadow-sm"
            onClick={handleStart}
            disabled={download.isEnqueuing}
          >
            {download.showSuccess ? (
              <>
                <Check className="h-4 w-4" />
                Added to Queue!
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Download ({selectedCount})
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

