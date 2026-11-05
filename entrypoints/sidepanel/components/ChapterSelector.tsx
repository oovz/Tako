import { useId, useMemo, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { CheckCircle2, ChevronRight, History, LockKeyhole } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/src/shared/utils"
import type {
  SidePanelChapter,
  VolumeOrChapter,
} from "@/entrypoints/sidepanel/types"
import { getOutputResultLabel } from "@/src/runtime/output-result-presentation"
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
      selectionState: boolean | "indeterminate"
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
      const groupKey = item.groupId
      const selectableChapters = item.chapters.filter(
        (chapter) => chapter.locked !== true
      )
      const selectedCount = selectableChapters.filter(
        (chapter) => chapter.selected
      ).length
      const isExpanded =
        item.chapters.length > 0 && expandedGroups.has(groupKey)

      rows.push({
        kind: "volume-header",
        key: `${groupKey}-header`,
        groupKey,
        title: item.title,
        chapterCount: item.chapters.length,
        selectableChapterCount: selectableChapters.length,
        selectionState:
          selectedCount > 0 &&
          (selectedCount === selectableChapters.length
            ? true
            : "indeterminate"),
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

type SelectorActions = Pick<
  ChapterSelectorProps,
  "isEnqueuing" | "onToggleGroup" | "onToggleChapter" | "onVolumeSelectAll"
>

function ChapterDownloadMarker({ chapter }: { chapter: SidePanelChapter }) {
  if (chapter.downloaded !== true) return null
  const saveConfirmed = chapter.saveConfirmedAt !== undefined
  const Icon = saveConfirmed ? CheckCircle2 : History
  const label = getOutputResultLabel(
    chapter.outputDestination,
    chapter.saveConfirmedAt
  )

  return (
    <span
      data-downloaded-marker
      className={cn(
        "inline-flex shrink-0 items-center",
        saveConfirmed
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground"
      )}
      title={label}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function ChapterRow({
  row,
  isEnqueuing,
  onToggleChapter,
}: Pick<SelectorActions, "isEnqueuing" | "onToggleChapter"> & {
  row: Exclude<SelectorRow, { kind: "volume-header" }>
}) {
  const statusId = useId()
  const isLocked = row.chapter.locked === true
  const hasStatus = isLocked || row.chapter.downloaded === true
  const isChapterDisabled = isEnqueuing || isLocked
  const lockedLabel = isLocked ? t("common_locked") : undefined

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
      data-kind={row.kind === "standalone-chapter" ? "standalone" : undefined}
      onClick={() => {
        if (isChapterDisabled) return
        onToggleChapter(row.chapter.id, !row.chapter.selected)
      }}
    >
      <Checkbox
        id={row.chapter.id}
        aria-label={row.chapter.title}
        aria-describedby={hasStatus ? statusId : undefined}
        checked={row.chapter.selected}
        onCheckedChange={() =>
          onToggleChapter(row.chapter.id, !row.chapter.selected)
        }
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        disabled={isChapterDisabled}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="w-7 shrink-0 text-right text-[11px] max-[280px]:w-5 font-medium tabular-nums text-muted-foreground">
          {row.chapter.index}
        </span>
        <span
          className="line-clamp-2 min-w-0 flex-1 wrap-anywhere text-sm leading-5 text-foreground"
          title={row.chapter.title}
        >
          {row.chapter.title}
        </span>
        {hasStatus && (
          <span id={statusId} className="flex shrink-0 items-center gap-1.5">
            {lockedLabel && (
              <span
                className="text-[11px] text-muted-foreground"
                title={lockedLabel}
              >
                <span className="max-[280px]:sr-only">{lockedLabel}</span>
                <LockKeyhole
                  aria-hidden="true"
                  className="hidden size-4 max-[280px]:block"
                />
              </span>
            )}
            <ChapterDownloadMarker chapter={row.chapter} />
          </span>
        )}
      </div>
    </div>
  )
}

function VolumeHeaderRow({
  row,
  isEnqueuing,
  onToggleGroup,
  onVolumeSelectAll,
}: Omit<SelectorActions, "onToggleChapter"> & {
  row: Extract<SelectorRow, { kind: "volume-header" }>
}) {
  const isDisclosureDisabled = isEnqueuing || row.chapterCount === 0

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
          isDisclosureDisabled
            ? "cursor-default bg-muted/20"
            : "cursor-pointer bg-muted/20 hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        disabled={isDisclosureDisabled}
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
        checked={row.selectionState}
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

function ChapterSelectorRow({
  row,
  ...actions
}: SelectorActions & {
  row: SelectorRow
}) {
  return row.kind === "volume-header" ? (
    <VolumeHeaderRow row={row} {...actions} />
  ) : (
    <ChapterRow row={row} {...actions} />
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

  const actions = {
    isEnqueuing,
    onToggleGroup,
    onToggleChapter,
    onVolumeSelectAll,
  }

  return (
    <div
      ref={scrollRef}
      data-virtualized={shouldVirtualize}
      className="flex-1 min-h-0 border-b border-border bg-background overflow-y-auto"
    >
      {!shouldVirtualize ? (
        rows.map((row) => (
          <div key={row.key}>
            <ChapterSelectorRow row={row} {...actions} />
          </div>
        ))
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
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <ChapterSelectorRow row={row} {...actions} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
