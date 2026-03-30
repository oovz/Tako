import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/src/shared/utils'
import type { SidePanelChapter, VolumeOrChapter } from '@/entrypoints/sidepanel/types'

const MAX_NON_VIRTUALIZED_ROWS = 28

interface ChapterSelectorProps {
  items: VolumeOrChapter[]
  viewMode: 'volumes' | 'chapters'
  expandedGroups: Set<string>
  isEnqueuing: boolean
  onToggleGroup: (groupKey: string) => void
  onToggleChapter: (chapterId: string, checked: boolean) => void
  onVolumeSelectAll: (groupId: string) => void
}

type SelectorRow =
  | {
    kind: 'volume-header'
    key: string
    groupKey: string
    number: number
    chapterCount: number
    selectableChapterCount: number
    allSelected: boolean
    groupId: string
    isExpanded: boolean
  }
  | {
    kind: 'standalone-chapter'
    key: string
    chapter: SidePanelChapter
  }
  | {
    kind: 'volume-chapter' | 'chapter-mode-chapter'
    key: string
    chapter: SidePanelChapter
  }

function getGroupKey(item: VolumeOrChapter): string {
  if ('chapters' in item) {
    return item.groupId
  }
  return `standalone-${item.id}`
}

function flattenRows(items: VolumeOrChapter[], viewMode: 'volumes' | 'chapters', expandedGroups: Set<string>): SelectorRow[] {
  if (viewMode === 'chapters') {
    return items.flatMap((item) => {
      if ('chapters' in item) {
        return item.chapters.map((chapter) => ({
          kind: 'chapter-mode-chapter' as const,
          key: chapter.id,
          chapter,
        }))
      }

      return [{ kind: 'chapter-mode-chapter' as const, key: item.id, chapter: item }]
    })
  }

  const rows: SelectorRow[] = []
  items.forEach((item) => {
    if ('chapters' in item) {
      const groupKey = getGroupKey(item)
      const selectableChapters = item.chapters.filter((chapter) => chapter.locked !== true)
      const allSelected = selectableChapters.length > 0 && selectableChapters.every((chapter) => chapter.selected)
      const isExpanded = expandedGroups.has(groupKey)

      rows.push({
        kind: 'volume-header',
        key: `${groupKey}-header`,
        groupKey,
        number: item.number,
        chapterCount: item.chapters.length,
        selectableChapterCount: selectableChapters.length,
        allSelected,
        groupId: item.groupId,
        isExpanded,
      })

      if (isExpanded) {
        item.chapters.forEach((chapter) => {
          rows.push({
            kind: 'volume-chapter',
            key: `${groupKey}-${chapter.id}`,
            chapter,
          })
        })
      }

      return
    }

    rows.push({
      kind: 'standalone-chapter',
      key: `standalone-${item.id}`,
      chapter: item,
    })
  })

  return rows
}

export function ChapterSelector({
  items,
  viewMode,
  expandedGroups,
  isEnqueuing,
  onToggleGroup,
  onToggleChapter,
  onVolumeSelectAll,
}: ChapterSelectorProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const rows = useMemo(
    () => flattenRows(items, viewMode, expandedGroups),
    [items, viewMode, expandedGroups],
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: () => 40,
    overscan: 6,
  })

  const renderRow = (row: SelectorRow) => {
    if (row.kind !== 'volume-header') {
      const isChapterDisabled = isEnqueuing || row.chapter.locked === true

      return (
        <div
          className={cn(
            'group flex items-center gap-2 border-b border-border/40 px-3 py-2 text-sm transition-colors duration-150',
            isChapterDisabled
              ? 'cursor-default'
              : 'cursor-pointer hover:bg-muted/35',
          )}
          data-testid={row.kind === 'standalone-chapter' ? 'inline-item' : undefined}
          data-kind={row.kind === 'standalone-chapter' ? 'standalone' : undefined}
          onClick={() => {
            if (isChapterDisabled) return
            onToggleChapter(row.chapter.id, !row.chapter.selected)
          }}
        >
          <Checkbox
            id={row.chapter.id}
            aria-label={row.chapter.title}
            checked={row.chapter.selected}
            onCheckedChange={() => onToggleChapter(row.chapter.id, !row.chapter.selected)}
            onClick={(event) => event.stopPropagation()}
            disabled={isChapterDisabled}
          />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="w-7 shrink-0 font-mono text-[11px] font-medium tabular-nums text-muted-foreground">
              {row.chapter.index}
            </span>
            <span className="flex-1 truncate text-sm leading-5 text-foreground">
              {row.chapter.title}
            </span>
            {row.chapter.locked === true && (
              <span className="shrink-0 text-[11px] text-muted-foreground">Locked</span>
            )}
          </div>
        </div>
      )
    }

    return (
      <div className="border-b border-border/30" data-testid="inline-item" data-kind="volume">
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-2 transition-colors duration-150',
            isEnqueuing
              ? 'cursor-default bg-muted/20'
              : 'cursor-pointer bg-muted/20 hover:bg-muted/45',
          )}
          onClick={() => {
            if (isEnqueuing) return
            onToggleGroup(row.groupKey)
          }}
        >
          <ChevronRight
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none',
              row.isExpanded && 'rotate-90',
            )}
          />
          <Checkbox
            checked={row.chapterCount > 0 && row.allSelected}
            onCheckedChange={() => onVolumeSelectAll(row.groupId)}
            onClick={(event) => event.stopPropagation()}
            disabled={row.selectableChapterCount === 0 || isEnqueuing}
          />
          <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
            <span className="truncate">
              Volume
              {' '}
              {row.number}
            </span>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{row.chapterCount}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation()
              onVolumeSelectAll(row.groupId)
            }}
            disabled={row.selectableChapterCount === 0 || isEnqueuing}
          >
            Select All
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 border-b border-border bg-background overflow-y-auto">
      {rows.length <= MAX_NON_VIRTUALIZED_ROWS ? (
        rows.map((row) => <div key={row.key}>{renderRow(row)}</div>)
      ) : (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const row = rows[virtualItem.index]
            if (!row) return null

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {renderRow(row)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

