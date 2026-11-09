import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { useRef, type RefObject } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { SelectionChapterRow } from "./ChapterSelector"
import { t } from "@/src/runtime/i18n"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { parseSettingsDocument } from "@/src/domain/settings/schema"
import { useChromeStorageValue } from "@/src/ui/shared/hooks/useChromeStorageValue"
import type { SidePanelChapter } from "../types"

const parseDefaults = (value: unknown) =>
  value === undefined ? null : parseSettingsDocument(value)

export function SelectionReview({
  ids,
  container,
  chapters,
  pending,
  errorMessage,
  onClose,
  onToggle,
  onClear,
  trigger,
}: {
  ids: string[] | null
  container: HTMLElement
  chapters: SidePanelChapter[]
  pending: boolean
  errorMessage?: string | null
  onClose: () => void
  onToggle: (id: string, selected: boolean) => void
  onClear: () => void
  trigger: RefObject<HTMLButtonElement | null>
}) {
  const { value: settings, status } = useChromeStorageValue({
    areaName: "local",
    key: LOCAL_STORAGE_KEYS.settings,
    initialValue: null,
    parse: parseDefaults,
  })
  const heading = useRef<HTMLHeadingElement>(null)
  const selected = chapters.filter((chapter) => chapter.selected).length
  const included = new Set(ids ?? [])
  return (
    <Dialog.Root
      modal={false}
      open={ids !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <Dialog.Portal container={container}>
        <div
          data-state={ids === null ? "closed" : "open"}
          className="selection-review-overlay"
          onPointerDown={() => {
            if (!pending) onClose()
          }}
        />
        <Dialog.Content
          className="selection-review"
          inert={ids === null}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            heading.current?.focus({ preventScroll: true })
          }}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (
              pending ||
              (event.target instanceof Element &&
                event.target.closest(".selection-footer"))
            )
              event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = [
              trigger.current,
              document.getElementById("select-all-ctx"),
            ].find(
              (element) =>
                element &&
                element.getBoundingClientRect().width > 0 &&
                getComputedStyle(element).visibility !== "hidden" &&
                !element.matches(":disabled")
            )
            if (target) target.focus()
            else
              document
                .querySelector<HTMLElement>(
                  '[role="tab"][aria-selected="true"]'
                )
                ?.focus()
          }}
        >
          <div className="selection-review-header">
            <Dialog.Title ref={heading} tabIndex={-1}>
              {t("sidepanel_reviewSelection")}
            </Dialog.Title>
            <div className="selection-review-header-actions">
              <button
                type="button"
                className="review-clear"
                disabled={pending || selected === 0}
                onClick={onClear}
              >
                {t("sidepanel_clearSelection")}
              </button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("sidepanel_closeReview")}
                  disabled={pending}
                >
                  <X aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            {settings && status === "ready" && (
              <p className="review-target">
                {settings.downloads.defaultFormat === "none"
                  ? t("sidepanel_images")
                  : settings.downloads.defaultFormat.toUpperCase()}
                {" · "}
                {t(
                  settings.downloads.destination === "file-system-access"
                    ? "sidepanel_selectedFolder"
                    : "sidepanel_chromeDownloads"
                )}
              </p>
            )}
            {errorMessage && (
              <p className="selection-error" role="alert">
                {errorMessage}
              </p>
            )}
          </div>
          <ReviewChapters
            chapters={chapters.filter((chapter) => included.has(chapter.id))}
            pending={pending}
            onToggle={onToggle}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ReviewChapters({
  chapters,
  pending,
  onToggle,
}: {
  chapters: SidePanelChapter[]
  pending: boolean
  onToggle: (id: string, selected: boolean) => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: chapters.length,
    getScrollElement: () => scroll.current,
    getItemKey: (index) => chapters[index].id,
    estimateSize: () => 48,
    overscan: 6,
    measureElement: (element, entry) =>
      Math.ceil(entry?.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight),
  })
  const row = (chapter: SidePanelChapter) => (
    <SelectionChapterRow
      chapter={chapter}
      pending={pending}
      onToggle={onToggle}
      review
    />
  )
  return (
    <div
      className="selection-review-list"
      ref={scroll}
      data-virtualized={chapters.length > 48}
    >
      {chapters.length <= 48 ? (
        chapters.map((chapter) => <div key={chapter.id}>{row(chapter)}</div>)
      ) : (
        <div
          style={{ position: "relative", height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                width: "100%",
                transform: "translateY(" + item.start + "px)",
              }}
            >
              {row(chapters[item.index])}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
