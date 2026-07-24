import { z } from "zod"

import type { OffscreenJobStage } from "@/src/types/queue-state"

export const ACTIVE_TASK_PROGRESS_PORT_NAME = "tako-active-task-progress"

export interface ActiveChapterProgressSnapshot {
  chapterId: string
  chapterTitle?: string
  imagesProcessed: number
  totalImages: number
  stage: OffscreenJobStage
  phaseFraction: number
  updatedAt: number
}

export interface ActiveTaskProgressSnapshot {
  generation: string
  revision: number
  updatedAt: number
  taskId: string
  imagesProcessed: number
  totalImages: number
  activeChapterCount: number
  activeChapters: ActiveChapterProgressSnapshot[]
  chapterId?: string
  chapterTitle?: string
  stage: OffscreenJobStage
  phaseFraction: number
  overallFraction?: number
  outputCommitted: boolean
  status: "downloading" | "completed" | "failed" | "partial_success"
}

export interface ActiveTaskProgressPortMessage {
  type: "ACTIVE_TASK_PROGRESS"
  generation: string
  revision: number
  progress: ActiveTaskProgressSnapshot | null
}

const ActiveTaskProgressStatusSchema = z.enum([
  "downloading",
  "completed",
  "failed",
  "partial_success",
])

const OffscreenJobStageSchema = z.enum([
  "dispatching",
  "accepted",
  "resolving",
  "downloading",
  "transforming",
  "archiving",
  "saving",
])

const ActiveChapterSnapshotSchema = z.object({
  chapterId: z.string(),
  chapterTitle: z.string().optional(),
  imagesProcessed: z.number().optional(),
  totalImages: z.number().optional(),
  stage: OffscreenJobStageSchema.optional(),
  phaseFraction: z.number().optional(),
  updatedAt: z.number().optional(),
})

const ActiveTaskProgressStorageSchema = z.object({
  generation: z.string().min(1).optional(),
  revision: z.number().int().nonnegative().optional(),
  updatedAt: z.number().optional(),
  taskId: z.string(),
  imagesProcessed: z.number(),
  totalImages: z.number(),
  activeChapterCount: z.number().optional(),
  activeChapters: z.array(z.unknown()).optional(),
  chapterId: z.string().optional(),
  chapterTitle: z.string().optional(),
  stage: OffscreenJobStageSchema.optional(),
  phaseFraction: z.number().optional(),
  overallFraction: z.number().optional(),
  outputCommitted: z.boolean().optional(),
  status: ActiveTaskProgressStatusSchema,
})

function clampFraction(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function normalizeActiveTaskProgress(
  value: unknown
): ActiveTaskProgressSnapshot | null {
  const parsed = ActiveTaskProgressStorageSchema.safeParse(value)
  if (!parsed.success) return null

  const data = parsed.data
  const normalizedChapterTitle = data.chapterTitle?.trim() ?? ""
  const normalizedActiveChapters: ActiveChapterProgressSnapshot[] = []
  for (const item of data.activeChapters ?? []) {
    const chapterParsed = ActiveChapterSnapshotSchema.safeParse(item)
    if (!chapterParsed.success) continue
    const chapter = chapterParsed.data
    const imagesProcessed = Math.max(0, chapter.imagesProcessed ?? 0)
    const totalImages = Math.max(0, chapter.totalImages ?? 0)
    const imageFraction =
      totalImages > 0 ? clampFraction(imagesProcessed / totalImages) : 0
    const itemTitle = chapter.chapterTitle?.trim() ?? ""
    normalizedActiveChapters.push({
      chapterId: chapter.chapterId,
      chapterTitle: itemTitle.length > 0 ? itemTitle : undefined,
      imagesProcessed,
      totalImages,
      stage: chapter.stage ?? data.stage ?? "downloading",
      phaseFraction: clampFraction(chapter.phaseFraction ?? imageFraction),
      updatedAt: chapter.updatedAt ?? data.updatedAt ?? 0,
    })
  }

  const fallbackChapterId = data.chapterId
  const fallbackTotalImages = Math.max(0, data.totalImages)
  const fallbackImagesProcessed = Math.max(0, data.imagesProcessed)
  const fallbackSingleChapter: ActiveChapterProgressSnapshot[] =
    fallbackChapterId
      ? [
          {
            chapterId: fallbackChapterId,
            chapterTitle:
              normalizedChapterTitle.length > 0
                ? normalizedChapterTitle
                : undefined,
            imagesProcessed: fallbackImagesProcessed,
            totalImages: fallbackTotalImages,
            stage: data.stage ?? "downloading",
            phaseFraction: clampFraction(
              data.phaseFraction ??
                (fallbackTotalImages > 0
                  ? fallbackImagesProcessed / fallbackTotalImages
                  : 0)
            ),
            updatedAt: data.updatedAt ?? 0,
          },
        ]
      : []
  const activeChapters =
    normalizedActiveChapters.length > 0
      ? normalizedActiveChapters
      : fallbackSingleChapter
  const aggregateProgress =
    activeChapters.length > 0
      ? activeChapters.reduce(
          (accumulator, chapter) => ({
            imagesProcessed:
              accumulator.imagesProcessed + chapter.imagesProcessed,
            totalImages: accumulator.totalImages + chapter.totalImages,
          }),
          { imagesProcessed: 0, totalImages: 0 }
        )
      : {
          imagesProcessed: fallbackImagesProcessed,
          totalImages: fallbackTotalImages,
        }
  const activeChapterCount =
    activeChapters.length > 0
      ? activeChapters.length
      : Math.max(0, data.activeChapterCount ?? 0)
  const stage = data.stage ?? activeChapters[0]?.stage ?? "downloading"
  const phaseFraction = clampFraction(
    data.phaseFraction ?? activeChapters[0]?.phaseFraction ?? 0
  )

  return {
    generation: data.generation ?? "legacy",
    revision: data.revision ?? 0,
    updatedAt: data.updatedAt ?? 0,
    taskId: data.taskId,
    chapterId: fallbackChapterId,
    chapterTitle:
      normalizedChapterTitle.length > 0 ? normalizedChapterTitle : undefined,
    imagesProcessed: aggregateProgress.imagesProcessed,
    totalImages: aggregateProgress.totalImages,
    activeChapterCount,
    activeChapters,
    stage,
    phaseFraction,
    overallFraction:
      typeof data.overallFraction === "number"
        ? clampFraction(data.overallFraction)
        : undefined,
    outputCommitted: data.outputCommitted ?? false,
    status: data.status,
  }
}

export function normalizeActiveTaskProgressPortMessage(
  value: unknown
): ActiveTaskProgressPortMessage | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as Record<string, unknown>
  if (
    candidate.type !== "ACTIVE_TASK_PROGRESS" ||
    typeof candidate.generation !== "string" ||
    candidate.generation.length === 0 ||
    typeof candidate.revision !== "number" ||
    !Number.isInteger(candidate.revision) ||
    candidate.revision < 0
  ) {
    return null
  }
  if (candidate.progress === null) {
    return {
      type: "ACTIVE_TASK_PROGRESS",
      generation: candidate.generation,
      revision: candidate.revision,
      progress: null,
    }
  }
  const progress = normalizeActiveTaskProgress(candidate.progress)
  if (
    !progress ||
    progress.generation !== candidate.generation ||
    progress.revision !== candidate.revision
  ) {
    return null
  }
  return {
    type: "ACTIVE_TASK_PROGRESS",
    generation: candidate.generation,
    revision: candidate.revision,
    progress,
  }
}
