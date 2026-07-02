import logger from '@/src/runtime/logger'
import { scheduleForIntegrationScope } from '@/src/runtime/rate-limit'
import type { RateLimitPolicySnapshot } from '@/src/runtime/rate-limit'
import { PromiseQueue } from './image-processor'
import type {
  ChapterDownloadImageFn,
  ChapterDownloadImageResult,
  ChapterProcessingRuntime,
} from './chapter-processing-types'

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
  integrationContext?: Record<string, unknown>
  rateLimitSettings?: RateLimitPolicySnapshot
  abortSignal?: AbortSignal
  onProgress: (pct: number, label?: string, imageProgress?: { current: number; total: number }) => Promise<void>
  onImageDownloaded?: () => void
  downloadImage: ChapterDownloadImageFn
  onDownloaded: (image: DownloadChapterImageSuccess) => void
  onDownloadFailed: (failure: DownloadChapterImageFailure) => void
  mapImageIndex?: (index: number) => number
  collectFailureReasons?: boolean
}

type DownloadChapterImagesResult = {
  total: number
  processed: number
  succeeded: number
  failed: number
  failedUrls: string[]
  failedReasons: string[]
}

function normalizeQueueConcurrency(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return 16
  }

  return Math.min(16, Math.max(1, Math.trunc(numeric)))
}

export async function downloadChapterImages(
  runtime: ChapterProcessingRuntime,
  input: DownloadChapterImagesOptions,
): Promise<DownloadChapterImagesResult> {
  const {
    urls,
    integrationId,
    chapterId,
    integrationContext,
    rateLimitSettings,
    abortSignal,
    onProgress,
    onImageDownloaded,
    downloadImage,
    onDownloaded,
    onDownloadFailed,
    mapImageIndex,
    collectFailureReasons = false,
  } = input
  const imageConcurrency = normalizeQueueConcurrency(rateLimitSettings?.image.concurrency)
  const downloadQueue = new PromiseQueue(imageConcurrency)
  let processed = 0
  let succeeded = 0
  let failed = 0
  const total = urls.length
  const failedUrls: string[] = []
  const failedReasons: string[] = []
  const imageDownloadContext = {
    ...(integrationContext ?? {}),
    ...(rateLimitSettings ? { rateLimitSettings } : {}),
    chapterId,
  }
  const cancelPendingDownloads = () => {
    downloadQueue.cancelPending(new Error('job-cancelled'))
  }

  const emitInFlightProgress = async (): Promise<void> => {
    try {
      await onProgress(10, 'downloading', { current: processed, total })
    } catch (error) {
      logger.debug('image in-flight progress update failed (non-fatal)', error)
    }
  }

  const tasks: Promise<void>[] = []
  abortSignal?.addEventListener('abort', cancelPendingDownloads, { once: true })
  try {
    for (let i = 0; i < urls.length; i++) {
      if (abortSignal?.aborted) {
        break
      }

      const url = urls[i]
      const imageIndex = mapImageIndex ? mapImageIndex(i) : i
      tasks.push(downloadQueue.add(async () => {
        try {
          if (abortSignal?.aborted) throw new Error('job-cancelled')
          const result = await runtime.withImageRetries<ChapterDownloadImageResult>(
            () => scheduleForIntegrationScope(integrationId, 'image', () => downloadImage(url, {
              signal: abortSignal,
              context: imageDownloadContext,
              onBytesReceived: emitInFlightProgress,
            }), rateLimitSettings?.image),
            { onAttemptStart: emitInFlightProgress },
          )
          onDownloaded({ url, index: imageIndex, result })
          succeeded++
          onImageDownloaded?.()
        } catch (error) {
          failed++
          failedUrls.push(url)
          if (collectFailureReasons && failedReasons.length < 3) {
            const reason = error instanceof Error ? error.message : String(error)
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
          processed++
          const pct = Math.max(10, Math.round((processed / total) * 100))
          await onProgress(pct, undefined, { current: processed, total })
        }
      }))
    }
    await Promise.allSettled(tasks)
  } finally {
    abortSignal?.removeEventListener('abort', cancelPendingDownloads)
  }

  logger.debug('chapter image download batch complete', { total, processed, succeeded, failed })

  return {
    total,
    processed,
    succeeded,
    failed,
    failedUrls,
    failedReasons,
  }
}
