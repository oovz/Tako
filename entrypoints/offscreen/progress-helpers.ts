import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import type { ProcessChapterStreamingOptions } from "./chapter-processing"
import type { ChapterOutcome } from "./chapter-processing-types"

type OffscreenDownloadProgressMessage =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_PROGRESS">

export type UnsequencedProgressPayload = Omit<
  OffscreenDownloadProgressMessage["payload"],
  "jobId" | "attempt" | "fingerprint" | "documentInstanceId" | "sequence"
>

export function createProgressPayload(input: {
  taskId: string
  chapterId: string
  chapterTitle: string
  status: UnsequencedProgressPayload["status"]
  stage?: UnsequencedProgressPayload["stage"]
  phaseFraction?: number
  imagesProcessed: number
  totalImages: number
  imagesFailed?: number
}): UnsequencedProgressPayload {
  const {
    taskId,
    chapterId,
    chapterTitle,
    status,
    stage = "downloading",
    phaseFraction,
    imagesProcessed,
    totalImages,
    imagesFailed = 0,
  } = input
  return {
    taskId,
    chapterId,
    chapterTitle,
    status,
    stage,
    phaseFraction,
    imagesProcessed,
    imagesFailed,
    totalImages,
    outputsRequested: 0,
    outputsFailedBeforeHandoff: 0,
    outputsCommitted: 0,
  }
}

export function createDownloadingProgressPayload(input: {
  taskId: string
  chapterId: string
  chapterTitle: string
  stage?: UnsequencedProgressPayload["stage"]
  phaseFraction?: number
  imagesProcessed: number
  totalImages: number
  imagesFailed?: number
}): UnsequencedProgressPayload {
  return createProgressPayload({ ...input, status: "downloading" })
}

export function createTerminalProgressPayload(input: {
  taskId: string
  chapterId: string
  chapterTitle: string
  outcome: ChapterOutcome
  totalImages: number
  imagesProcessed: number
}): UnsequencedProgressPayload {
  const {
    taskId,
    chapterId,
    chapterTitle,
    outcome,
    totalImages,
    imagesProcessed,
  } = input
  return {
    taskId,
    chapterId,
    chapterTitle,
    status: outcome.status,
    stage: "saving",
    phaseFraction:
      outcome.outputsRequested > 0 &&
      outcome.outputsCommitted >= outcome.outputsRequested
        ? 1
        : 0.99,
    imagesProcessed,
    imagesFailed: outcome.imagesFailed ?? 0,
    totalImages,
    error: outcome.errorMessage,
    errorCategory: outcome.errorCategory,
    outputsRequested: outcome.outputsRequested,
    outputsFailedBeforeHandoff: outcome.outputsFailedBeforeHandoff,
    outputsCommitted: outcome.outputsCommitted,
  }
}

type ProgressPhase = Pick<UnsequencedProgressPayload, "stage" | "phaseFraction">
const resolvingProgress = new Map([
  ["fetching", 0.25],
  ["parsing", 0.75],
  ["ready", 1],
])

function getImageProgressPhase(
  pct: number,
  label: string | undefined
): ProgressPhase {
  const fraction = resolvingProgress.get(label ?? "")
  return fraction === undefined
    ? {
        stage: "downloading",
        phaseFraction: Math.max(0, Math.min(1, pct / 100)),
      }
    : { stage: "resolving", phaseFraction: fraction }
}

function getArchiveProgressPhase(
  pct: number,
  label: string | undefined
): ProgressPhase {
  const normalizedLabel = label?.toLowerCase() ?? ""
  if (normalizedLabel.includes("cover"))
    return { stage: "resolving", phaseFraction: 0.5 }
  const saving = ["saving", "handoff", "saved", "download"].some((word) =>
    normalizedLabel.includes(word)
  )
  return saving
    ? {
        stage: "saving",
        phaseFraction: Math.max(0, Math.min(1, (pct - 90) / 10)),
      }
    : { stage: "archiving", phaseFraction: Math.max(0, Math.min(1, pct / 95)) }
}

export function createStreamingProgressHandlers(input: {
  taskId: string
  chapterId: string
  chapterTitle: string
  latestImageProgress: { current: number; total: number }
  emitProgressMessage: (payload: UnsequencedProgressPayload) => Promise<void>
}): Pick<ProcessChapterStreamingOptions, "onProgress" | "onArchiveProgress"> {
  const {
    taskId,
    chapterId,
    chapterTitle,
    latestImageProgress,
    emitProgressMessage,
  } = input

  const onProgress: ProcessChapterStreamingOptions["onProgress"] = async (
    pct,
    label,
    imageProgress
  ) => {
    if (imageProgress) {
      latestImageProgress.current = imageProgress.current
      latestImageProgress.total = imageProgress.total
    }
    const { stage, phaseFraction } = getImageProgressPhase(pct, label)
    if (latestImageProgress.total === 0 && stage !== "resolving") return
    await emitProgressMessage(
      createDownloadingProgressPayload({
        taskId,
        chapterId,
        chapterTitle,
        stage,
        phaseFraction,
        imagesProcessed: latestImageProgress.current,
        totalImages: latestImageProgress.total,
      })
    )
  }

  const onArchiveProgress: ProcessChapterStreamingOptions["onArchiveProgress"] =
    async (pct, label) => {
      const { stage, phaseFraction } = getArchiveProgressPhase(pct, label)
      await emitProgressMessage(
        createDownloadingProgressPayload({
          taskId,
          chapterId,
          chapterTitle,
          stage,
          phaseFraction,
          imagesProcessed: latestImageProgress.current,
          totalImages: latestImageProgress.total,
        })
      )
    }

  return { onProgress, onArchiveProgress }
}
