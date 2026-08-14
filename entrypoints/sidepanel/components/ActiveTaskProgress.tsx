import { useMemo } from "react"

import { Progress } from "@/components/ui/progress"
import { cn } from "@/src/shared/utils"
import type { ActiveTaskProgress as ActiveTaskProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"

interface ActiveTaskProgressProps {
  task: QueueTaskSummary
  progress: ActiveTaskProgressState | null
  inline?: boolean
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export function ActiveTaskProgress({
  task,
  progress,
  inline = false,
}: ActiveTaskProgressProps) {
  const totalChapters = task.chapters.total
  const completedChapters = task.chapters.completed

  const activeChapterProgressUnits = useMemo(() => {
    const activeChapters = progress?.activeChapters ?? []
    if (activeChapters.length === 0) {
      const processed = progress?.imagesProcessed ?? 0
      const total = progress?.totalImages ?? 0
      if (total <= 0) {
        return 0
      }

      return Math.max(0, processed / total)
    }

    return activeChapters.reduce((sum, chapter) => {
      if (chapter.totalImages <= 0) {
        return sum
      }

      const chapterRatio = Math.max(
        0,
        Math.min(1, chapter.imagesProcessed / chapter.totalImages)
      )
      return sum + chapterRatio
    }, 0)
  }, [
    progress?.activeChapters,
    progress?.imagesProcessed,
    progress?.totalImages,
  ])

  const blendedProgress = useMemo(() => {
    if (totalChapters <= 0) {
      return clampPercent(activeChapterProgressUnits * 100)
    }

    const blended =
      ((completedChapters + activeChapterProgressUnits) / totalChapters) * 100
    return clampPercent(blended)
  }, [activeChapterProgressUnits, completedChapters, totalChapters])

  const weightedProgress =
    typeof progress?.overallFraction === "number"
      ? clampPercent(progress.overallFraction * 100)
      : blendedProgress
  const progressDisplayValue =
    task.status === "downloading" && progress?.outputCommitted !== true
      ? Math.min(99, weightedProgress)
      : weightedProgress

  const chapterPosition = Math.min(totalChapters, completedChapters + 1)
  const stage = progress?.stage ?? "downloading"
  const activeChapterCount = Math.max(
    0,
    progress?.activeChapterCount ?? progress?.activeChapters?.length ?? 0
  )
  const isPreparingNextChapter =
    activeChapterCount === 0 &&
    completedChapters < totalChapters &&
    (stage === "accepted" || stage === "dispatching")
  const effectiveDownloadingChapterCount = Math.max(1, activeChapterCount)
  const chapterLabel = isPreparingNextChapter
    ? t("progressStage_preparingNextChapter")
    : totalChapters > 1
      ? t("sidepanel_chapterDownloading", [
          String(effectiveDownloadingChapterCount),
          effectiveDownloadingChapterCount === 1
            ? t("common_chapter")
            : t("common_chapters"),
        ])
      : t("sidepanel_chapterPosition", [
          String(chapterPosition),
          String(totalChapters),
        ])
  const singleChapterTitle =
    totalChapters <= 1 && activeChapterCount <= 1
      ? typeof progress?.chapterTitle === "string"
        ? progress.chapterTitle.trim()
        : ""
      : ""
  const chapterTitleSuffix =
    singleChapterTitle.length > 0 ? ` - ${singleChapterTitle}` : ""
  const processedImages = Math.max(0, progress?.imagesProcessed ?? 0)
  const totalImages = Math.max(0, progress?.totalImages ?? 0)
  const imageProgressValue =
    totalImages > 0 ? clampPercent((processedImages / totalImages) * 100) : 0
  const stageLabel = isPreparingNextChapter
    ? t("progressStage_preparingNextChapter")
    : stage === "dispatching" || stage === "accepted"
      ? t("progressStage_preparing")
      : stage === "resolving"
        ? t("progressStage_resolving")
        : stage === "downloading"
          ? t("progressStage_downloading", [
              String(processedImages),
              String(totalImages),
            ])
          : stage === "transforming"
            ? t("progressStage_transforming", [
                String(processedImages),
                String(totalImages),
              ])
            : stage === "archiving"
              ? t("progressStage_archiving")
              : t("progressStage_saving")
  const showImageProgress =
    totalImages > 0 && (stage === "downloading" || stage === "transforming")
  const showImageCounter = activeChapterCount > 0 && totalImages > 0
  const progressPercentLabel = `${Math.round(progressDisplayValue)}%`

  return (
    <div
      className={cn(
        "border border-border/60 bg-muted/25",
        inline
          ? "px-2 py-1.5 mt-1"
          : "px-3 py-2.5 border-t-0 border-l-2 border-l-primary/40 bg-muted/35 shadow-inner"
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("common_progress")}
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-foreground">
          {progressPercentLabel}
        </span>
      </div>

      <Progress
        value={progressDisplayValue}
        className={cn(
          "bg-border/70 [&>div]:bg-primary [&>div]:rounded-none rounded-none",
          inline ? "h-1" : "h-2"
        )}
        aria-label={`${t("common_progress")} ${progressPercentLabel}`}
      />

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span
          className="min-w-0 truncate font-medium"
          title={`${stageLabel} · ${chapterLabel}${chapterTitleSuffix}`}
        >
          {stageLabel} · {chapterLabel}
          {chapterTitleSuffix}
        </span>
        {showImageCounter ? (
          <span className="inline-flex shrink-0 items-center bg-muted px-1.5 py-0.5 tabular-nums transition-all duration-300 ease-out">
            {processedImages}/{totalImages} {t("common_images")}
          </span>
        ) : null}
      </div>
      <div
        className="mt-1 h-0.5"
        aria-hidden={!showImageProgress}
        data-image-progress-visible={showImageProgress ? "true" : "false"}
      >
        <Progress
          value={imageProgressValue}
          className={cn(
            "h-0.5 rounded-none bg-border/60 transition-opacity duration-150 motion-reduce:transition-none [&>div]:rounded-none [&>div]:bg-primary/65",
            showImageProgress ? "opacity-100" : "opacity-0"
          )}
          aria-label={`${stageLabel}: ${Math.round(imageProgressValue)}%`}
        />
      </div>
      {/* Polite live region: announces progress changes to screen readers
          without interrupting other speech. The text is visually hidden
          but kept in the accessibility tree. */}
      <span className="sr-only" role="status" aria-live="polite">
        {progressPercentLabel}. {stageLabel}. {chapterLabel}
        {chapterTitleSuffix}.
        {showImageCounter
          ? ` ${processedImages}/${totalImages} ${t("common_images")}.`
          : ""}
      </span>
    </div>
  )
}
