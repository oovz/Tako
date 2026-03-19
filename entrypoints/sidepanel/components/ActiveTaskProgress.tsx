import { useMemo } from 'react'

import { Progress } from '@/components/ui/progress'
import { cn } from '@/src/shared/utils'
import type { ActiveTaskProgress as ActiveTaskProgressState } from '@/entrypoints/sidepanel/hooks/useActiveTaskProgress'
import type { QueueTaskSummary } from '@/src/types/queue-state'

interface ActiveTaskProgressProps {
  task: QueueTaskSummary
  progress: ActiveTaskProgressState | null
  inline?: boolean
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export function ActiveTaskProgress({ task, progress, inline = false }: ActiveTaskProgressProps) {
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

      const chapterRatio = Math.max(0, Math.min(1, chapter.imagesProcessed / chapter.totalImages))
      return sum + chapterRatio
    }, 0)
  }, [progress?.activeChapters, progress?.imagesProcessed, progress?.totalImages])

  const blendedProgress = useMemo(() => {
    if (totalChapters <= 0) {
      return clampPercent(activeChapterProgressUnits * 100)
    }

    const blended = ((completedChapters + activeChapterProgressUnits) / totalChapters) * 100
    return clampPercent(blended)
  }, [activeChapterProgressUnits, completedChapters, totalChapters])

  const progressDisplayValue = task.status === 'downloading' && completedChapters < totalChapters
    ? Math.min(99, blendedProgress)
    : blendedProgress

  const chapterPosition = Math.min(totalChapters, completedChapters + 1)
  const activeChapterCount = Math.max(0, progress?.activeChapterCount ?? progress?.activeChapters?.length ?? 0)
  const effectiveDownloadingChapterCount = Math.max(1, activeChapterCount)
  const chapterLabel = totalChapters > 1
    ? `${effectiveDownloadingChapterCount} ${effectiveDownloadingChapterCount === 1 ? 'chapter' : 'chapters'} downloading`
    : `Chapter ${chapterPosition}/${totalChapters}`
  const singleChapterTitle = totalChapters <= 1 && activeChapterCount <= 1
    ? typeof progress?.chapterTitle === 'string'
      ? progress.chapterTitle.trim()
      : ''
    : ''
  const chapterTitleSuffix = singleChapterTitle.length > 0 ? ` - ${singleChapterTitle}` : ''
  const processedImages = Math.max(0, progress?.imagesProcessed ?? 0)
  const totalImages = Math.max(0, progress?.totalImages ?? 0)
  const progressPercentLabel = `${Math.round(progressDisplayValue)}%`

  return (
    <div
      className={cn(
        'border border-border/60 bg-muted/25',
        inline ? 'px-2 py-1.5 mt-1' : 'px-3 py-2.5 border-t-0 border-l-2 border-l-primary/40 bg-muted/35 shadow-inner',
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Progress</span>
        <span className="text-[11px] font-semibold tabular-nums text-foreground">{progressPercentLabel}</span>
      </div>

      <Progress
        value={progressDisplayValue}
        className={cn('bg-border/70 [&>div]:bg-primary/85 [&>div]:rounded-none rounded-none', inline ? 'h-1' : 'h-1.5')}
      />

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="min-w-0 truncate font-medium" title={`${chapterLabel}${chapterTitleSuffix}`}>{chapterLabel}{chapterTitleSuffix}</span>
        <span
          className="inline-flex shrink-0 items-center bg-muted px-1.5 py-0.5 tabular-nums transition-all duration-300 ease-out"
        >
          {processedImages}/{totalImages} images
        </span>
      </div>
    </div>
  )
}

