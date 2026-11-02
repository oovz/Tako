import type { ActiveTaskProgress as ProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function getActiveChapterProgressUnits(progress: ProgressState | null): number {
  const activeChapters = progress?.activeChapters ?? []
  if (activeChapters.length === 0) {
    return getImageProgressUnits(progress)
  }

  return activeChapters.reduce((sum, chapter) => {
    if (chapter.totalImages <= 0) return sum
    return (
      sum +
      Math.max(0, Math.min(1, chapter.imagesProcessed / chapter.totalImages))
    )
  }, 0)
}

function getImageProgressUnits(progress: ProgressState | null): number {
  const processed = progress?.imagesProcessed ?? 0
  const total = progress?.totalImages ?? 0
  return total > 0 ? Math.max(0, processed / total) : 0
}

function getBlendedProgress(
  task: QueueTaskSummary,
  progress: ProgressState | null
): number {
  const activeUnits = getActiveChapterProgressUnits(progress)
  if (task.chapters.total <= 0) return clampPercent(activeUnits * 100)
  return clampPercent(
    ((task.chapters.completed + activeUnits) / task.chapters.total) * 100
  )
}

function getTaskProgressValue(
  task: QueueTaskSummary,
  progress: ProgressState | null
): number {
  const weightedProgress =
    typeof progress?.overallFraction === "number"
      ? clampPercent(progress.overallFraction * 100)
      : getBlendedProgress(task, progress)
  return task.status === "downloading" && progress?.outputCommitted !== true
    ? Math.min(99, weightedProgress)
    : weightedProgress
}

export function getProgressNumbers(
  task: QueueTaskSummary,
  progress: ProgressState | null
) {
  const processedImages = Math.max(0, progress?.imagesProcessed ?? 0)
  const totalImages = Math.max(0, progress?.totalImages ?? 0)
  return {
    processedImages,
    totalImages,
    progressValue: getTaskProgressValue(task, progress),
    imageProgressValue:
      totalImages > 0 ? clampPercent((processedImages / totalImages) * 100) : 0,
  }
}

export function getProgressChapterContext(
  task: QueueTaskSummary,
  progress: ProgressState | null
) {
  const stage = progress?.stage ?? "downloading"
  const activeChapterCount = getActiveChapterCount(progress)
  return {
    stage,
    activeChapterCount,
    isPreparingNextChapter:
      activeChapterCount === 0 &&
      task.chapters.completed < task.chapters.total &&
      (stage === "accepted" || stage === "dispatching"),
  }
}

function getActiveChapterCount(progress: ProgressState | null): number {
  return Math.max(
    0,
    progress?.activeChapterCount ?? progress?.activeChapters?.length ?? 0
  )
}

type ChapterContext = ReturnType<typeof getProgressChapterContext>

function getSingleChapterTitle(
  task: QueueTaskSummary,
  progress: ProgressState | null,
  activeChapterCount: number
): string {
  if (task.chapters.total > 1 || activeChapterCount > 1) return ""
  return typeof progress?.chapterTitle === "string"
    ? progress.chapterTitle.trim()
    : ""
}

export function getProgressChapterDescription(
  task: QueueTaskSummary,
  progress: ProgressState | null,
  context: ChapterContext
): string {
  const label = getProgressChapterLabel(task, context)
  const title = getSingleChapterTitle(
    task,
    progress,
    context.activeChapterCount
  )
  return title.length > 0 ? `${label} - ${title}` : label
}

function getProgressChapterLabel(
  task: QueueTaskSummary,
  context: ChapterContext
): string {
  if (context.isPreparingNextChapter)
    return t("progressStage_preparingNextChapter")
  if (task.chapters.total > 1) {
    const count = Math.max(1, context.activeChapterCount)
    return t("sidepanel_chapterDownloading", [
      String(count),
      count === 1 ? t("common_chapter") : t("common_chapters"),
    ])
  }
  return t("sidepanel_chapterPosition", [
    String(Math.min(task.chapters.total, task.chapters.completed + 1)),
    String(task.chapters.total),
  ])
}

function getSavingCaption(outputMode: QueueTaskSummary["outputMode"]): string {
  if (outputMode === "downloads-api") return t("progressStage_sendingToChrome")
  if (outputMode === "fsa") return t("progressStage_savingToFolder")
  return t("progressStage_saving")
}

export function getProgressStageCaption(
  context: ChapterContext,
  outputMode: QueueTaskSummary["outputMode"],
  numbers: ReturnType<typeof getProgressNumbers>
): string {
  if (context.isPreparingNextChapter)
    return t("progressStage_preparingNextChapter")
  switch (context.stage) {
    case "accepted":
    case "dispatching":
      return t("progressStage_preparing")
    case "resolving":
      return t("progressStage_resolving")
    case "downloading":
      return t("progressStage_downloading", [
        String(numbers.processedImages),
        String(numbers.totalImages),
      ])
    case "transforming":
      return t("progressStage_transforming", [
        String(numbers.processedImages),
        String(numbers.totalImages),
      ])
    case "archiving":
      return t("progressStage_archiving")
    default:
      return getSavingCaption(outputMode)
  }
}
