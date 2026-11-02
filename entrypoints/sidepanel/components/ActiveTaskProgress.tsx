import { Progress } from "@/components/ui/progress"
import { cn } from "@/src/shared/utils"
import type { ActiveTaskProgress as ActiveTaskProgressState } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { t } from "@/src/runtime/i18n"
import {
  getProgressChapterContext,
  getProgressChapterDescription,
  getProgressNumbers,
  getProgressStageCaption,
} from "./ActiveTaskProgress-model"

interface ActiveTaskProgressProps {
  task: QueueTaskSummary
  progress: ActiveTaskProgressState | null
  inline?: boolean
}

interface ProgressDetailsProps {
  numbers: ReturnType<typeof getProgressNumbers>
  context: ReturnType<typeof getProgressChapterContext>
  stageLabel: string
  chapterDescription: string
  progressPercentLabel: string
}

function ProgressDetails({
  numbers,
  context,
  stageLabel,
  chapterDescription,
  progressPercentLabel,
}: ProgressDetailsProps) {
  const { processedImages, totalImages, imageProgressValue } = numbers
  const showImageProgress =
    totalImages > 0 &&
    (context.stage === "downloading" || context.stage === "transforming")
  const showImageCounter = context.activeChapterCount > 0 && totalImages > 0
  return (
    <>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span
          className="min-w-0 truncate font-medium"
          title={`${stageLabel} · ${chapterDescription}`}
        >
          {stageLabel} · {chapterDescription}
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
      {/* Announce progress politely while keeping both visual tracks mounted. */}
      <span className="sr-only" role="status" aria-live="polite">
        {progressPercentLabel}. {stageLabel}. {chapterDescription}.
        {showImageCounter
          ? ` ${processedImages}/${totalImages} ${t("common_images")}.`
          : ""}
      </span>
    </>
  )
}

export function ActiveTaskProgress({
  task,
  progress,
  inline = false,
}: ActiveTaskProgressProps) {
  const numbers = getProgressNumbers(task, progress)
  const context = getProgressChapterContext(task, progress)
  const chapterDescription = getProgressChapterDescription(
    task,
    progress,
    context
  )
  const stageLabel = getProgressStageCaption(context, task.outputMode, numbers)
  const progressPercentLabel = `${Math.round(numbers.progressValue)}%`

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
        value={numbers.progressValue}
        className={cn(
          "bg-border/70 [&>div]:bg-primary [&>div]:rounded-none rounded-none",
          inline ? "h-1" : "h-2"
        )}
        aria-label={`${t("common_progress")} ${progressPercentLabel}`}
      />
      <ProgressDetails
        numbers={numbers}
        context={context}
        stageLabel={stageLabel}
        chapterDescription={chapterDescription}
        progressPercentLabel={progressPercentLabel}
      />
    </div>
  )
}
