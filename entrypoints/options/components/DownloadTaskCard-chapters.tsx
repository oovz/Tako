import { ChevronDown, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { DownloadTaskState, TaskChapter } from "@/src/domain/queue/state"
import { getDownloadErrorMessage } from "@/src/runtime/download-error-presentation"
import { t } from "@/src/runtime/i18n"
import {
  chapterStatusBadgeClass,
  formatChapterStatusLabel,
  getChapterImageSummary,
  getTaskStatusSummaryLabel,
  shouldShowChapterError,
} from "./downloads-tab-helpers"

function ChapterResultRow({ chapter }: { chapter: TaskChapter }) {
  const showError = shouldShowChapterError(chapter.status)
  const error = showError ? getDownloadErrorMessage(chapter.errorCategory) : ""
  return (
    <div
      role="row"
      className="grid grid-cols-[minmax(0,1fr)_140px_100px_minmax(0,1fr)] items-center gap-2 border-t px-3 py-2 text-xs"
    >
      <span role="cell" className="truncate" title={chapter.title}>
        {chapter.title}
      </span>
      <div role="cell">
        <Badge className={chapterStatusBadgeClass(chapter.status)}>
          {formatChapterStatusLabel(
            chapter.status,
            chapter.outputDestination,
            chapter.saveConfirmedAt
          )}
        </Badge>
      </div>
      <span role="cell" className="font-mono text-[11px]">
        {getChapterImageSummary(chapter)}
      </span>
      <span
        role="cell"
        className="truncate text-muted-foreground"
        title={error}
      >
        {showError ? error : "-"}
      </span>
    </div>
  )
}

export function DownloadTaskCardChapters({
  task,
  id,
  expanded,
  onToggle,
}: {
  task: DownloadTaskState
  id: string
  expanded: boolean
  onToggle: () => void
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
        aria-expanded={expanded}
        aria-controls={id}
      >
        <Chevron className="size-4 shrink-0" />
        <span>{getTaskStatusSummaryLabel(task)}</span>
      </button>
      {expanded && (
        <div
          id={id}
          role="table"
          className="mt-2 overflow-x-auto rounded-md border"
        >
          <div
            role="row"
            className="grid min-w-[38rem] grid-cols-[minmax(0,1fr)_140px_100px_minmax(0,1fr)] bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            <span role="columnheader">{t("options_chapter")}</span>
            <span role="columnheader">{t("options_status")}</span>
            <span role="columnheader">{t("options_images")}</span>
            <span role="columnheader">{t("options_error")}</span>
          </div>
          <div
            role="rowgroup"
            className="max-h-56 min-w-[38rem] overflow-y-auto"
          >
            {task.chapters.map((chapter, index) => (
              <ChapterResultRow
                key={chapter.id ?? chapter.url ?? `chapter-row-${index}`}
                chapter={chapter}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
