import { useMemo, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { CheckCircle2, ChevronRight } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/src/shared/utils"
import type {
  SidePanelChapter,
  VolumeOrChapter,
} from "@/entrypoints/sidepanel/types"
import { t } from "@/src/runtime/i18n"

interface ChapterSelectorProps {
  items: VolumeOrChapter[]
  viewMode: "volumes" | "chapters"
  expandedGroups: Set<string>
  isEnqueuing: boolean
  onToggleGroup: (groupKey: string) => void
  onToggleChapter: (chapterId: string, checked: boolean) => void
  onVolumeSelectAll: (groupId: string) => void
}

type SelectorRow =
  | {
      kind: "volume-header"
      key: string
      groupKey: string
      title: string
      chapterCount: number
      selectableChapterCount: number
      allSelected: boolean
      groupId: string
      isExpanded: boolean
    }
  | {
      kind: "standalone-chapter"
      key: string
      chapter: SidePanelChapter
    }
  | {
      kind: "volume-chapter" | "chapter-mode-chapter"
      key: string
      chapter: SidePanelChapter
    }

function getGroupKey(item: VolumeOrChapter): string {
  if ("chapters" in item) {
    return item.groupId
  }
  return `standalone-${item.id}`
}

function flattenRows(
  items: VolumeOrChapter[],
  viewMode: "volumes" | "chapters",
  expandedGroups: Set<string>
): SelectorRow[] {
  if (viewMode === "chapters") {
    return items.flatMap((item) => {
      if ("chapters" in item) {
        return item.chapters.map((chapter) => ({
          kind: "chapter-mode-chapter" as const,
          key: chapter.id,
          chapter,
        }))
      }

      return [
        { kind: "chapter-mode-chapter" as const, key: item.id, chapter: item },
      ]
    })
  }

  const rows: SelectorRow[] = []
  items.forEach((item) => {
    if ("chapters" in item) {
      const groupKey = getGroupKey(item)
      const selectableChapters = item.chapters.filter(
        (chapter) => chapter.locked !== true
      )
      const allSelected =
        selectableChapters.length > 0 &&
        selectableChapters.every((chapter) => chapter.selected)
      const isExpanded = expandedGroups.has(groupKey)

      rows.push({
        kind: "volume-header",
        key: `${groupKey}-header`,
        groupKey,
        title: item.title,
        chapterCount: item.chapters.length,
        selectableChapterCount: selectableChapters.length,
        allSelected,
        groupId: item.groupId,
        isExpanded,
      })

      if (isExpanded) {
        item.chapters.forEach((chapter) => {
          rows.push({
            kind: "volume-chapter",
            key: `${groupKey}-${chapter.id}`,
            chapter,
          })
        })
      }

      return
    }

    rows.push({
      kind: "standalone-chapter",
      key: `standalone-${item.id}`,
      chapter: item,
    })
  })

  return rows
}

function countPotentialRows(items: VolumeOrChapter[]): number {
  return items.reduce(
    (count, item) =>
      count + ("chapters" in item ? 1 + item.chapters.length : 1),
    0
  )
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
    [items, viewMode, expandedGroups]
  )
  // React Compiler safely skips this component because TanStack Virtual returns
  // imperative functions whose identities cannot be compiler-memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: () => 40,
    overscan: 6,
  })
  // Expanding a volume changes the visible row count. Base the rendering mode
  // on the list's stable maximum instead so disclosure never remounts the full
  // selector across the virtualization boundary.
  const shouldVirtualize = useMemo(
    () => countPotentialRows(items) > 48,
    [items]
  )

  const renderRow = (row: SelectorRow) => {
    if (row.kind !== "volume-header") {
      const isChapterDisabled = isEnqueuing || row.chapter.locked === true

      return (
        <div
          className={cn(
            "group flex items-center gap-2 border-b border-border/40 px-3 py-2 text-sm transition-colors duration-150",
            isChapterDisabled
              ? "cursor-default"
              : "cursor-pointer hover:bg-muted/35"
          )}
          data-testid={
            row.kind === "standalone-chapter" ? "inline-item" : undefined
          }
          data-kind={
            row.kind === "standalone-chapter" ? "standalone" : undefined
          }
          onClick={() => {
            if (isChapterDisabled) return
            onToggleChapter(row.chapter.id, !row.chapter.selected)
          }}
        >
          <Checkbox
            id={row.chapter.id}
            aria-label={row.chapter.title}
            checked={row.chapter.selected}
            onCheckedChange={() =>
              onToggleChapter(row.chapter.id, !row.chapter.selected)
            }
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
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
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {t("common_locked")}
              </span>
            )}
            {row.chapter.downloaded === true && (
              <span
                data-downloaded-marker
                className="inline-flex shrink-0 items-center text-emerald-600 dark:text-emerald-400 animate-in zoom-in-75 duration-200"
                title={t("status_completed")}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                <span className="sr-only">{t("status_completed")}</span>
              </span>
            )}
          </div>
        </div>
      )
    }

    return (
      <div
        className="flex items-center border-b border-border/30 bg-muted/20"
        data-testid="inline-item"
        data-kind="volume"
      >
        <button
          type="button"
          aria-expanded={row.isExpanded}
          aria-label={t("sidepanel_volumeToggleAria", [row.title])}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors duration-150",
            isEnqueuing
              ? "cursor-default bg-muted/20"
              : "cursor-pointer bg-muted/20 hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
          disabled={isEnqueuing}
          onClick={() => {
            onToggleGroup(row.groupKey)
          }}
        >
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
              row.isExpanded && "rotate-90"
            )}
          />
          <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
            <span className="truncate">{row.title}</span>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {row.chapterCount}
          </span>
        </button>
        <Checkbox
          className="mr-3"
          checked={row.chapterCount > 0 && row.allSelected}
          onCheckedChange={() => onVolumeSelectAll(row.groupId)}
          // Keep checkbox activation isolated from the adjacent volume toggle.
          // Radix emits keyboard and pointer events from the checkbox root;
          // without stopping them here a bubbled activation can also toggle the
          // volume disclosure in layouts where the row receives the event.
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          disabled={row.selectableChapterCount === 0 || isEnqueuing}
          aria-label={t("sidepanel_volumeSelectAllAria", [
            row.title,
            String(row.chapterCount),
          ])}
        />
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      data-virtualized={shouldVirtualize}
      className="flex-1 min-h-0 border-b border-border bg-background overflow-y-auto"
    >
      {!shouldVirtualize ? (
        rows.map((row) => <div key={row.key}>{renderRow(row)}</div>)
      ) : (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const row = rows[virtualItem.index]
            if (!row) return null

            return (
              <div
                key={virtualItem.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
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
