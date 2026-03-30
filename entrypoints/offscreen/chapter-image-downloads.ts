import logger from '@/src/runtime/logger'
import { scheduleForIntegrationScope } from '@/src/runtime/rate-limit'
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

export async function downloadChapterImages(
  runtime: ChapterProcessingRuntime,
  input: DownloadChapterImagesOptions,
): Promise<DownloadChapterImagesResult> {
  const {
    urls,
    integrationId,
    chapterId,
    integrationContext,
    abortSignal,
    onProgress,
    onImageDownloaded,
    downloadImage,
    onDownloaded,
    onDownloadFailed,
    mapImageIndex,
    collectFailureReasons = false,
  } = input
  const downloadQueue = new PromiseQueue(16)
  let processed = 0
  let succeeded = 0
  let failed = 0
  const total = urls.length
  const failedUrls: string[] = []
  const failedReasons: string[] = []
  const imageDownloadContext = {
    ...(integrationContext ?? {}),
    chapterId,
  }

  const tasks: Promise<void>[] = []
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    const imageIndex = mapImageIndex ? mapImageIndex(i) : i
    tasks.push(downloadQueue.add(async () => {
      try {
        if (abortSignal?.aborted) throw new Error('job-cancelled')
        const result = await runtime.withImageRetries<ChapterDownloadImageResult>(
          () => scheduleForIntegrationScope(integrationId, 'image', () => downloadImage(url, {
            signal: abortSignal,
            context: imageDownloadContext,
          })),
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
