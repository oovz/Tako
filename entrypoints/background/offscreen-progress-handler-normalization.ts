import { isRecord } from "@/src/shared/type-guards"
import {
  OffscreenJobStageSchema,
  type OffscreenJobStage,
} from "@/src/runtime/offscreen-job-contracts"
import { normalizeDownloadErrorCategory } from "@/src/shared/download-contract"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"

type ProgressPayload =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_PROGRESS">["payload"]

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

export function trimmedProgressTitle(value: unknown): string | undefined {
  const title = readString(value)?.trim()
  return title ? title : undefined
}

function normalizeStatus(
  value: unknown
): ProgressPayload["status"] | undefined {
  return value === "downloading" ||
    value === "completed" ||
    value === "failed" ||
    value === "partial_success"
    ? value
    : undefined
}

function normalizeStage(value: unknown): OffscreenJobStage | undefined {
  const parsed = OffscreenJobStageSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function readProgressIdentity(payload: ProgressPayload) {
  const jobId = readString(payload.jobId)
  const attempt = readNumber(payload.attempt)
  const sequence = readNumber(payload.sequence)
  const taskId = readString(payload.taskId)
  const chapterId = readString(payload.chapterId)
  const status = normalizeStatus(payload.status)
  const stage = normalizeStage(payload.stage)
  if (
    !jobId ||
    attempt === undefined ||
    sequence === undefined ||
    !stage ||
    !taskId ||
    !chapterId ||
    !status
  )
    return undefined
  return { jobId, attempt, sequence, taskId, chapterId, status, stage }
}

function readPayloadPhaseFraction(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined
}

export function readOffscreenProgress(payload: ProgressPayload) {
  const identity = readProgressIdentity(payload)
  if (!identity) return undefined
  return {
    ...identity,
    payload,
    imagesProcessed: readNumber(payload.imagesProcessed),
    totalImages: readNumber(payload.totalImages),
    imagesFailed: readNumber(payload.imagesFailed),
    chapterTitle: readString(payload.chapterTitle),
    phaseFraction: readPayloadPhaseFraction(payload.phaseFraction),
    errorMessage: readString(payload.error),
    errorCategory: normalizeDownloadErrorCategory(payload.errorCategory),
  }
}

export type AcceptedOffscreenProgress = NonNullable<
  ReturnType<typeof readOffscreenProgress>
>

export interface ActiveChapterSnapshot {
  chapterId: string
  chapterTitle?: string
  imagesProcessed: number
  totalImages: number
  stage: OffscreenJobStage
  phaseFraction: number
  updatedAt: number
}

function nonNegativeStoredCount(value: unknown): number {
  return typeof value === "number" ? Math.max(0, value) : 0
}

function storedPhaseFraction(value: unknown): number {
  return typeof value === "number" ? Math.max(0, Math.min(1, value)) : 0
}

function readStoredChapter(value: unknown): ActiveChapterSnapshot | undefined {
  if (!isRecord(value)) return undefined
  const chapterId = readString(value.chapterId)
  if (!chapterId) return undefined
  return {
    chapterId,
    chapterTitle: trimmedProgressTitle(value.chapterTitle),
    imagesProcessed: nonNegativeStoredCount(value.imagesProcessed),
    totalImages: nonNegativeStoredCount(value.totalImages),
    stage: normalizeStage(value.stage) ?? "downloading",
    phaseFraction: storedPhaseFraction(value.phaseFraction),
    updatedAt: readNumber(value.updatedAt) ?? 0,
  }
}

export function readActiveChapterMap(
  stored: unknown,
  taskId: string
): Map<string, ActiveChapterSnapshot> {
  const chapters = new Map<string, ActiveChapterSnapshot>()
  if (
    !isRecord(stored) ||
    stored.taskId !== taskId ||
    !Array.isArray(stored.activeChapters)
  )
    return chapters
  for (const value of stored.activeChapters) {
    const chapter = readStoredChapter(value)
    if (chapter) chapters.set(chapter.chapterId, chapter)
  }
  return chapters
}
