import type { DownloadTaskState } from "@/src/domain/queue/state"
import { isTerminalChapterStatus } from "@/src/domain/queue/task-lifecycle"
import type { ActiveTaskProgressSnapshot } from "@/src/runtime/active-task-progress"
import {
  calculatePhaseWeightedChapterFraction,
  calculateTimeWeightedTaskFraction,
  type ProgressPhaseCostProfile,
} from "@/src/runtime/progress-calculator"
import { getEffectiveTaskDestination } from "@/src/domain/queue/task-destination"
import {
  trimmedProgressTitle,
  type ActiveChapterSnapshot,
  type AcceptedOffscreenProgress,
} from "./offscreen-progress-handler-normalization"

type TaskChapter = DownloadTaskState["chapters"][number]
type ProgressSnapshot = Omit<
  ActiveTaskProgressSnapshot,
  "generation" | "revision" | "updatedAt"
>

export function normalizeActiveChapters(input: {
  activeChapters: ActiveChapterSnapshot[]
  taskChapters: Array<{ id: string; status: string }>
}): ActiveChapterSnapshot[] {
  const knownChapterIds = new Set(
    input.taskChapters.map((chapter) => chapter.id)
  )
  const downloadingChapterIds = new Set(
    input.taskChapters
      .filter((chapter) => chapter.status === "downloading")
      .map((chapter) => chapter.id)
  )

  const normalizedActiveChapterMap = new Map<string, ActiveChapterSnapshot>()
  for (const chapterSnapshot of input.activeChapters) {
    if (!knownChapterIds.has(chapterSnapshot.chapterId)) {
      continue
    }
    if (
      downloadingChapterIds.size > 0 &&
      !downloadingChapterIds.has(chapterSnapshot.chapterId)
    ) {
      continue
    }

    const previousSnapshot = normalizedActiveChapterMap.get(
      chapterSnapshot.chapterId
    )
    if (
      !previousSnapshot ||
      chapterSnapshot.updatedAt >= previousSnapshot.updatedAt
    ) {
      normalizedActiveChapterMap.set(chapterSnapshot.chapterId, chapterSnapshot)
    }
  }

  return [...normalizedActiveChapterMap.values()].sort((left, right) =>
    left.chapterId.localeCompare(right.chapterId)
  )
}

function readOutputAccounting(progress: AcceptedOffscreenProgress) {
  const requested = Math.max(0, progress.payload.outputsRequested ?? 0)
  const failedBeforeHandoff = Math.max(
    0,
    progress.payload.outputsFailedBeforeHandoff ?? 0
  )
  return {
    expected: Math.max(0, requested - failedBeforeHandoff),
    committed: Math.max(0, progress.payload.outputsCommitted ?? 0),
  }
}

export function resolveDestinationProgress(
  progress: AcceptedOffscreenProgress,
  task: DownloadTaskState
) {
  const output = readOutputAccounting(progress)
  const terminal = progress.status !== "downloading"
  const destination = getEffectiveTaskDestination(task).kind
  const committed =
    terminal && output.expected > 0 && output.committed >= output.expected
  const awaitingNativeCommit =
    terminal &&
    destination === "downloads-api" &&
    output.expected > 0 &&
    !committed
  return { terminal, destination, committed, awaitingNativeCommit }
}

export function shouldPersistChapterProgress(
  progress: AcceptedOffscreenProgress,
  chapter: TaskChapter
) {
  return (
    progress.status !== "downloading" ||
    (typeof progress.totalImages === "number" &&
      progress.totalImages !== chapter.totalImages) ||
    (typeof progress.imagesFailed === "number" &&
      progress.imagesFailed !== chapter.imagesFailed) ||
    chapter.status !== "downloading"
  )
}

function imageProgressFraction(processed: number, total: number) {
  return total > 0 ? Math.max(0, Math.min(1, processed / total)) : 0
}

function chapterPhaseFraction(
  progress: AcceptedOffscreenProgress,
  imageFraction: number,
  committed: boolean
) {
  if (progress.status !== "downloading") return committed ? 1 : 0.99
  return (
    progress.phaseFraction ??
    (progress.stage === "downloading" ? imageFraction : 0)
  )
}

export function updateActiveChapterMap(
  chapters: Map<string, ActiveChapterSnapshot>,
  progress: AcceptedOffscreenProgress,
  chapter: TaskChapter,
  committed: boolean
) {
  if (
    isTerminalChapterStatus(chapter.status) &&
    progress.status === "downloading"
  ) {
    chapters.delete(progress.chapterId)
    return
  }
  const previous = chapters.get(progress.chapterId)
  chapters.set(
    progress.chapterId,
    createActiveChapterSnapshot(progress, chapter, previous, committed)
  )
}

function createActiveChapterSnapshot(
  progress: AcceptedOffscreenProgress,
  chapter: TaskChapter,
  previous: ActiveChapterSnapshot | undefined,
  committed: boolean
): ActiveChapterSnapshot {
  const { imagesProcessed, totalImages, imageFraction } =
    resolveChapterImageProgress(progress, previous)
  return {
    chapterId: progress.chapterId,
    chapterTitle:
      trimmedProgressTitle(progress.chapterTitle) ??
      trimmedProgressTitle(chapter.title) ??
      previous?.chapterTitle,
    imagesProcessed,
    totalImages,
    stage: progress.status !== "downloading" ? "saving" : progress.stage,
    phaseFraction: chapterPhaseFraction(progress, imageFraction, committed),
    updatedAt: Date.now(),
  }
}

function resolveChapterImageProgress(
  progress: AcceptedOffscreenProgress,
  previous: ActiveChapterSnapshot | undefined
) {
  const imagesProcessed = Math.max(
    0,
    progress.imagesProcessed ?? previous?.imagesProcessed ?? 0
  )
  const totalImages = Math.max(
    0,
    progress.totalImages ?? previous?.totalImages ?? 0
  )
  return {
    imagesProcessed,
    totalImages,
    imageFraction: imageProgressFraction(imagesProcessed, totalImages),
  }
}

function settledChapterCount(chapters: DownloadTaskState["chapters"]): number {
  return chapters.filter(
    (chapter) =>
      chapter.status === "completed" ||
      chapter.status === "partial_success" ||
      chapter.status === "failed"
  ).length
}

function overallProgressFraction(
  progress: AcceptedOffscreenProgress,
  task: DownloadTaskState | undefined,
  activeChapters: ActiveChapterSnapshot[],
  previous: ActiveTaskProgressSnapshot | null,
  costs: ProgressPhaseCostProfile,
  committed: boolean
) {
  const activeChapterFractions = activeChapters.map((chapter) =>
    calculatePhaseWeightedChapterFraction({
      costs,
      stage: chapter.stage,
      phaseFraction: chapter.phaseFraction,
    })
  )
  return calculateTimeWeightedTaskFraction({
    totalChapters: task?.chapters.length ?? 1,
    settledChapters: settledChapterCount(task?.chapters ?? []),
    activeChapterFractions,
    previousDisplayedFraction:
      previous?.taskId === progress.taskId ? previous.overallFraction : 0,
    destinationCommitted: committed,
  })
}

export function createTaskProgressProjection(
  progress: AcceptedOffscreenProgress,
  task: DownloadTaskState | undefined,
  activeChapters: ActiveChapterSnapshot[],
  previous: ActiveTaskProgressSnapshot | null,
  costs: ProgressPhaseCostProfile,
  committed: boolean
): ProgressSnapshot | null {
  const current = activeChapters.reduce(
    (latest, chapter) =>
      !latest || chapter.updatedAt >= latest.updatedAt ? chapter : latest,
    undefined as ActiveChapterSnapshot | undefined
  )
  if (!current) return null
  return {
    taskId: progress.taskId,
    chapterId: current.chapterId,
    chapterTitle: current.chapterTitle,
    activeChapterCount: activeChapters.length,
    activeChapters,
    imagesProcessed: activeChapters.reduce(
      (sum, chapter) => sum + chapter.imagesProcessed,
      0
    ),
    totalImages: activeChapters.reduce(
      (sum, chapter) => sum + chapter.totalImages,
      0
    ),
    stage: current.stage,
    phaseFraction: current.phaseFraction,
    overallFraction: overallProgressFraction(
      progress,
      task,
      activeChapters,
      previous,
      costs,
      committed
    ),
    outputCommitted: committed,
    status: "downloading",
  }
}
