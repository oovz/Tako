import logger from "@/src/runtime/logger"
import type {
  RateLimitPolicySnapshot,
  RateLimitService,
} from "@/src/runtime/rate-limit"
import { PromiseQueue } from "./image-processor"
import type {
  ChapterDownloadImageFn,
  ChapterDownloadImageResult,
  ChapterProcessingRuntime,
} from "./chapter-processing-types"
import {
  MAX_CHAPTER_IMAGE_BYTES,
  MAX_CHAPTER_IMAGES,
  MAX_IMAGE_BYTES,
} from "@/src/constants/timeouts"
import { NonRetryableDownloadError } from "@/src/shared/download-contract"
import { OffscreenLiveResourceLimitError } from "@/src/runtime/offscreen-live-resource-ledger"
import type { JsonObject } from "@/src/types/site-integrations"

export class ChapterResourceLimitError extends NonRetryableDownloadError {
  constructor(message: string) {
    super(message)
    this.name = "ChapterResourceLimitError"
  }
}

type DownloadChapterImageSuccess = {
  url: string
  index: number
  result: ChapterDownloadImageResult
}

type DownloadChapterImageFailure = {
  url: string
  index: number
  error: unknown
  failedCount: number
  total: number
}

type DownloadChapterImagesOptions = {
  urls: string[]
  integrationId: string
  chapterId: string
  integrationContext?: JsonObject
  rateLimitSettings: RateLimitPolicySnapshot
  rateLimitService: RateLimitService
  abortSignal?: AbortSignal
  onProgress: (
    pct: number,
    label?: string,
    imageProgress?: { current: number; total: number }
  ) => Promise<void>
  onImageDownloaded?: () => void
  downloadImage: ChapterDownloadImageFn
  onDownloaded: (image: DownloadChapterImageSuccess) => void | Promise<void>
  onDownloadFailed: (failure: DownloadChapterImageFailure) => void
  mapImageIndex?: (index: number) => number
  collectFailureReasons?: boolean
  isFatalError?: (error: unknown) => boolean
  initialAggregateBytes?: number
}

type DownloadChapterImagesResult = {
  total: number
  processed: number
  succeeded: number
  failed: number
  failedUrls: string[]
  failedReasons: string[]
}

export async function downloadChapterImages(
  runtime: ChapterProcessingRuntime,
  input: DownloadChapterImagesOptions
): Promise<DownloadChapterImagesResult> {
  const {
    urls,
    integrationId,
    chapterId,
    integrationContext,
    rateLimitSettings,
    rateLimitService,
    abortSignal,
    onProgress,
    onImageDownloaded,
    downloadImage,
    onDownloaded,
    onDownloadFailed,
    mapImageIndex,
    collectFailureReasons = false,
    isFatalError,
    initialAggregateBytes = 0,
  } = input
  if (urls.length > MAX_CHAPTER_IMAGES) {
    throw new ChapterResourceLimitError(
      `Chapter image count exceeds ${MAX_CHAPTER_IMAGES} image limit (got ${urls.length})`
    )
  }
  if (initialAggregateBytes > MAX_CHAPTER_IMAGE_BYTES) {
    throw new ChapterResourceLimitError(
      `Chapter image bytes exceed ${MAX_CHAPTER_IMAGE_BYTES} byte limit (got ${initialAggregateBytes})`
    )
  }
  const imageConcurrency = rateLimitSettings.image.concurrency
  const downloadQueue = new PromiseQueue(imageConcurrency)
  let processed = 0
  let succeeded = 0
  let failed = 0
  const total = urls.length
  const failedUrls: string[] = []
  const failedReasons: string[] = []
  let committedBytes = initialAggregateBytes
  let reservedBytes = 0
  let resourceLimitMessage: string | null = null
  const chapterController = new AbortController()
  const imageRuntime = { rateLimitSettings, chapterId, rateLimitService }
  const cancelPendingDownloads = (
    reason: unknown = new Error("job-cancelled")
  ) => {
    if (!chapterController.signal.aborted) {
      chapterController.abort(reason)
    }
    downloadQueue.cancelPending(reason)
  }

  const onAbort = () => cancelPendingDownloads()

  const emitInFlightProgress = async (): Promise<void> => {
    try {
      await onProgress(10, "downloading", { current: processed, total })
    } catch (error) {
      logger.debug("image in-flight progress update failed (non-fatal)", error)
    }
  }

  const createImageByteState = () => ({
    receivedBytes: 0,
    reservedBytes: 0,
  })
  const releaseImageBytes = (
    state: ReturnType<typeof createImageByteState>
  ) => {
    reservedBytes -= state.reservedBytes
    state.receivedBytes = 0
    state.reservedBytes = 0
  }
  const reserveImageBytes = (
    state: ReturnType<typeof createImageByteState>,
    bytes: number
  ): void => {
    if (bytes <= 0) return
    const nextTotal = committedBytes + reservedBytes + bytes
    if (nextTotal > MAX_CHAPTER_IMAGE_BYTES) {
      resourceLimitMessage =
        resourceLimitMessage ??
        `Chapter image bytes exceed ${MAX_CHAPTER_IMAGE_BYTES} byte limit (got ${nextTotal})`
      throw new ChapterResourceLimitError(resourceLimitMessage)
    }
    reservedBytes += bytes
    state.reservedBytes += bytes
  }
  const commitImageBytes = (
    state: ReturnType<typeof createImageByteState>
  ): void => {
    committedBytes += state.reservedBytes
    reservedBytes -= state.reservedBytes
    state.reservedBytes = 0
    state.receivedBytes = 0
  }

  const tasks: Promise<void>[] = []
  abortSignal?.addEventListener("abort", onAbort, {
    once: true,
  })
  if (abortSignal?.aborted) onAbort()
  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]
      const imageIndex = mapImageIndex ? mapImageIndex(i) : i
      tasks.push(
        downloadQueue.add(async () => {
          const imageByteState = createImageByteState()
          let downloadedResult: ChapterDownloadImageResult | undefined
          const reportImageBytes = async (bytesReceived: number) => {
            const normalizedBytes = Math.max(0, Math.trunc(bytesReceived))
            const delta = normalizedBytes - imageByteState.receivedBytes
            reserveImageBytes(imageByteState, delta)
            imageByteState.receivedBytes = normalizedBytes
            await emitInFlightProgress()
          }
          try {
            if (chapterController.signal.aborted) {
              throw new Error("job-cancelled")
            }
            downloadedResult =
              await runtime.withImageRetries<ChapterDownloadImageResult>(
                () =>
                  rateLimitService.scheduleForIntegrationScope(
                    integrationId,
                    "image",
                    () => {
                      if (chapterController.signal.aborted) {
                        throw new Error("job-cancelled")
                      }
                      return downloadImage(url, {
                        signal: chapterController.signal,
                        dispatchContext: integrationContext,
                        runtime: imageRuntime,
                        onBytesReceived: reportImageBytes,
                        liveResourceLedger: runtime.liveResourceLedger,
                      })
                    },
                    rateLimitSettings.image
                  ),
                {
                  onAttemptStart: async (attempt) => {
                    if (chapterController.signal.aborted) {
                      throw new Error("job-cancelled")
                    }
                    if (attempt > 1) releaseImageBytes(imageByteState)
                    await emitInFlightProgress()
                  },
                }
              )
            if (resourceLimitMessage) {
              throw new ChapterResourceLimitError(resourceLimitMessage)
            }
            const resultBytes = downloadedResult.data.byteLength
            if (resultBytes > MAX_IMAGE_BYTES) {
              throw new ChapterResourceLimitError(
                `Transformed image size exceeds ${MAX_IMAGE_BYTES} byte limit (got ${resultBytes})`
              )
            }
            if (resultBytes > imageByteState.reservedBytes) {
              reserveImageBytes(
                imageByteState,
                resultBytes - imageByteState.reservedBytes
              )
            } else if (resultBytes < imageByteState.reservedBytes) {
              const released = imageByteState.reservedBytes - resultBytes
              reservedBytes -= released
              imageByteState.reservedBytes = resultBytes
            }
            await onDownloaded({
              url,
              index: imageIndex,
              result: downloadedResult,
            })
            commitImageBytes(imageByteState)
            succeeded++
            onImageDownloaded?.()
          } catch (error) {
            releaseImageBytes(imageByteState)
            if (
              error instanceof ChapterResourceLimitError ||
              error instanceof OffscreenLiveResourceLimitError
            ) {
              resourceLimitMessage ??= error.message
              cancelPendingDownloads(error)
            } else if (isFatalError?.(error)) {
              cancelPendingDownloads(error)
            }
            failed++
            failedUrls.push(url)
            if (collectFailureReasons && failedReasons.length < 3) {
              const reason =
                error instanceof Error ? error.message : String(error)
              failedReasons.push(`${url} => ${reason}`)
            }
            onDownloadFailed({
              url,
              index: imageIndex,
              error,
              failedCount: failed,
              total,
            })
          } finally {
            downloadedResult?.liveResourceLease?.release()
            processed++
            const pct = Math.max(10, Math.round((processed / total) * 100))
            await onProgress(pct, undefined, { current: processed, total })
          }
        })
      )
    }
    await Promise.allSettled(tasks)
  } finally {
    abortSignal?.removeEventListener("abort", onAbort)
  }

  if (resourceLimitMessage) {
    throw new ChapterResourceLimitError(resourceLimitMessage)
  }

  logger.debug("chapter image download batch complete", {
    total,
    processed,
    succeeded,
    failed,
  })

  return {
    total,
    processed,
    succeeded,
    failed,
    failedUrls,
    failedReasons,
  }
}
