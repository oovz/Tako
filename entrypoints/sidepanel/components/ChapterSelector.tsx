import { playPanelMotion, stopPanelMotion } from "../hooks/panel-motion"
import { useId, useLayoutEffect, useMemo, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { History } from "lucide-react"
import { PanelIcon } from "./PanelIcon"
import { PanelCheckbox } from "./PanelCheckbox"
import { usePanelScrollMargin } from "../hooks/usePanelScrollMargin"
import type { SidePanelChapter, Volume, VolumeOrChapter } from "../types"
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
  scrollElement?: HTMLDivElement | null
}
type VolumeRow = {
  kind: "volume-header"
  key: string
  groupKey: string
  groupId: string
  title: string
  number?: number
  range: string
  chapterCount: number
  selectableChapterCount: number
  selectionState: boolean | "indeterminate"
  isExpanded: boolean
}
type ChapterRowData = {
  kind: "standalone-chapter" | "volume-chapter" | "chapter-mode-chapter"
  key: string
  chapter: SidePanelChapter
}
type SelectorRow = VolumeRow | ChapterRowData
type Actions = Pick<
  ChapterSelectorProps,
  "isEnqueuing" | "onToggleGroup" | "onToggleChapter" | "onVolumeSelectAll"
>

function volumeRow(volume: Volume, expanded: Set<string>): VolumeRow {
  const selectable = volume.chapters.filter((chapter) => !chapter.locked)
  const selected = selectable.filter((chapter) => chapter.selected).length
  const first = volume.chapters[0],
    last = volume.chapters.at(-1)
  const start = first?.chapterNumber ?? first?.index
  const end = last?.chapterNumber ?? last?.index
  return {
    kind: "volume-header",
    key: volume.groupId + "-header",
    groupKey: volume.groupId,
    groupId: volume.groupId,
    title: volume.title,
    number: volume.number,
    range:
      start === undefined
        ? t("sidepanel_chapterCount", ["0"])
        : t("sidepanel_chapterNumber", [
            start === end ? String(start) : start + "–" + end,
          ]),
    chapterCount: volume.chapters.length,
    selectableChapterCount: selectable.length,
    selectionState:
      selected > 0 && (selected === selectable.length ? true : "indeterminate"),
    isExpanded: volume.chapters.length > 0 && expanded.has(volume.groupId),
  }
}
function flattenRows(
  items: VolumeOrChapter[],
  mode: ChapterSelectorProps["viewMode"],
  expanded: Set<string>
): SelectorRow[] {
  return items.flatMap((item): SelectorRow[] => {
    if (!("chapters" in item))
      return [
        {
          kind:
            mode === "chapters" ? "chapter-mode-chapter" : "standalone-chapter",
          key: item.id,
          chapter: item,
        },
      ]
    const children: ChapterRowData[] = item.chapters.map((chapter) => ({
      kind: mode === "chapters" ? "chapter-mode-chapter" : "volume-chapter",
      key: item.groupId + "-" + chapter.id,
      chapter,
    }))
    if (mode === "chapters") return children
    const header = volumeRow(item, expanded)
    return [header, ...(header.isExpanded ? children : [])]
  })
}

export function SelectionChapterRow({
  chapter,
  pending,
  onToggle,
  standalone = false,
  review = false,
}: {
  chapter: SidePanelChapter
  pending: boolean
  onToggle: (id: string, selected: boolean) => void
  standalone?: boolean
  review?: boolean
}) {
  const statusId = useId()
  const locked = chapter.locked === true
  const disabled = pending || locked
  const savedLabel = getOutputResultLabel(
    chapter.outputDestination,
    chapter.saveConfirmedAt
  )
  const hasStatus = locked || chapter.downloaded === true
  return (
    <div
      className={"manga-chapter" + (review ? " review-chapter" : "")}
      data-selected={chapter.selected}
      data-locked={locked}
      data-testid={standalone ? "inline-item" : undefined}
      data-kind={standalone ? "standalone" : undefined}
      onClick={() => {
        if (!disabled) onToggle(chapter.id, !chapter.selected)
      }}
    >
      <span className="chapter-number">{chapter.index}</span>
      <span className="chapter-title" title={chapter.title}>
        {chapter.title}
      </span>
      {hasStatus && (
        <span id={statusId} className="chapter-marks">
          {locked && (
            <span className="chapter-mark" title={t("common_locked")}>
              <PanelIcon name="lock" />
              <span className="mark-label">{t("common_locked")}</span>
            </span>
          )}
          {chapter.downloaded && (
            <span
              data-downloaded-marker
              className={
                "chapter-mark" +
                (chapter.saveConfirmedAt === undefined ? "" : " saved-mark")
              }
              title={savedLabel}
            >
              {chapter.saveConfirmedAt === undefined ? (
                <History aria-hidden="true" />
              ) : (
                <PanelIcon name="archive" />
              )}
              <span className="mark-label">{savedLabel}</span>
            </span>
          )}
        </span>
      )}
      <PanelCheckbox
        id={review ? undefined : chapter.id}
        className="chapter-checkbox"
        checked={chapter.selected}
        aria-label={chapter.title}
        aria-describedby={hasStatus ? statusId : undefined}
        disabled={disabled}
        onCheckedChange={(checked) => onToggle(chapter.id, checked === true)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </div>
  )
}

function VolumeHeaderRow({
  row,
  isEnqueuing,
  onToggleGroup,
  onVolumeSelectAll,
}: Omit<Actions, "onToggleChapter"> & { row: VolumeRow }) {
  const label =
    row.number === undefined
      ? row.title
      : t("sidepanel_volumeNumber", [String(row.number)])
  const generic = "Volume " + row.number
  const raw = row.title.trim()
  const genericLabels = [
    generic,
    label,
    "Vol. " + row.number,
    String(row.number),
  ].map((value) => value.toLowerCase())
  const subtitle =
    row.number === undefined || genericLabels.includes(raw.toLowerCase())
      ? ""
      : raw.toLowerCase().startsWith(generic.toLowerCase() + ":")
        ? raw.slice(generic.length + 1).trim()
        : raw
  return (
    <div
      className="manga-volume-header"
      data-expanded={row.isExpanded}
      data-testid="inline-item"
      data-kind="volume"
    >
      <button
        type="button"
        className="manga-volume-toggle"
        aria-expanded={row.isExpanded}
        aria-label={t("sidepanel_volumeToggleAria", [
          subtitle ? label + ": " + subtitle : label,
        ])}
        disabled={isEnqueuing || row.chapterCount === 0}
        onClick={() => onToggleGroup(row.groupKey)}
      >
        <PanelIcon name="next" />
        <span className="volume-copy">
          <strong>{label}</strong>
          <span className="volume-range">{row.range}</span>
          {subtitle && <span className="volume-title">{subtitle}</span>}
        </span>
      </button>
      <PanelCheckbox
        className="volume-checkbox"
        checked={row.selectionState}
        disabled={isEnqueuing || row.selectableChapterCount === 0}
        aria-label={t("sidepanel_volumeSelectAllAria", [
          row.title,
          String(row.chapterCount),
        ])}
        onCheckedChange={() => onVolumeSelectAll(row.groupId)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </div>
  )
}

function VolumeGroup({
  item,
  row,
  actions,
}: {
  item: Volume
  row: VolumeRow
  actions: Actions
}) {
  const content = useRef<HTMLDivElement>(null)
  const previous = useRef(row.isExpanded)
  useLayoutEffect(() => {
    const changed = previous.current !== row.isExpanded
    previous.current = row.isExpanded
    const chapters = [
      ...(content.current?.querySelectorAll<HTMLElement>(".manga-chapter") ??
        []),
    ].slice(0, 4)
    if (changed && row.isExpanded)
      chapters.forEach((chapter, index) =>
        playPanelMotion(
          chapter,
          [
            { opacity: 0.65, translate: "0 -3px" },
            { opacity: 1, translate: "0 0" },
          ],
          150,
          index * 12
        )
      )
    else if (!row.isExpanded) chapters.forEach(stopPanelMotion)
  }, [row.isExpanded])
  return (
    <div className="manga-volume" data-expanded={row.isExpanded}>
      <VolumeHeaderRow row={row} {...actions} />
      <div className="volume-chapters" inert={!row.isExpanded}>
        <div className="volume-leaves" ref={content}>
          {item.chapters.map((chapter) => (
            <div key={chapter.id}>
              <SelectionChapterRow
                chapter={chapter}
                pending={actions.isEnqueuing}
                onToggle={actions.onToggleChapter}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ChapterSelector({
  items,
  viewMode,
  expandedGroups,
  scrollElement: parentScroll,
  ...actions
}: ChapterSelectorProps) {
  const ownScroll = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const scrollMargin = usePanelScrollMargin(parentScroll, list)
  const previousMode = useRef(viewMode)
  useLayoutEffect(() => {
    if (previousMode.current === viewMode) return
    previousMode.current = viewMode
    if (parentScroll)
      parentScroll.scrollTop = Math.min(
        parentScroll.scrollTop,
        parentScroll.querySelector<HTMLElement>(".manga-header")
          ?.offsetHeight ?? 0
      )
    if (list.current)
      playPanelMotion(list.current, [{ opacity: 0.78 }, { opacity: 1 }], 145)
  }, [viewMode, parentScroll])

  const rows = useMemo(
    () => flattenRows(items, viewMode, expandedGroups),
    [items, viewMode, expandedGroups]
  )
  const shouldVirtualize = useMemo(
    () =>
      items.reduce(
        (count, item) =>
          count + ("chapters" in item ? item.chapters.length + 1 : 1),
        0
      ) > 64,
    [items]
  )
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => parentScroll ?? ownScroll.current,
    getItemKey: (index) => rows[index].key,
    estimateSize: () => 40,
    overscan: 6,
    scrollMargin,
    measureElement: (element, entry) =>
      Math.ceil(entry?.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight),
  })
  const chapter = (item: SidePanelChapter, standalone = false) => (
    <SelectionChapterRow
      chapter={item}
      pending={actions.isEnqueuing}
      onToggle={actions.onToggleChapter}
      standalone={standalone}
    />
  )
  const renderRow = (row: SelectorRow) =>
    row.kind === "volume-header" ? (
      <VolumeHeaderRow row={row} {...actions} />
    ) : (
      chapter(row.chapter, row.kind === "standalone-chapter")
    )
  return (
    <div
      ref={ownScroll}
      className={
        "manga-chapter-list" + (parentScroll ? " shared-scroll-list" : "")
      }
      data-virtualized={shouldVirtualize}
    >
      <div ref={list}>
        {rows.length === 0 && (
          <p className="panel-empty" role="status">
            {t("sidepanel_noChaptersFound")}
          </p>
        )}
        {shouldVirtualize ? (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                style={{
                  position: "absolute",
                  top: 0,
                  width: "100%",
                  transform:
                    "translateY(" + (item.start - scrollMargin) + "px)",
                }}
              >
                {renderRow(rows[item.index])}
              </div>
            ))}
          </div>
        ) : viewMode === "chapters" ? (
          rows.map((row) => <div key={row.key}>{renderRow(row)}</div>)
        ) : (
          items.map((item) => {
            if (!("chapters" in item))
              return <div key={item.id}>{chapter(item, true)}</div>
            const header = volumeRow(item, expandedGroups)
            return (
              <VolumeGroup
                key={item.groupId}
                item={item}
                row={header}
                actions={actions}
              />
            )
          })
        )}
      </div>
    </div>
  )
}
