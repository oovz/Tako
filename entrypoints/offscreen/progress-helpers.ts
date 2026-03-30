import type {
  OffscreenDownloadChapterMessage,
  OffscreenDownloadProgressMessage,
} from '@/src/types/offscreen-messages'
import type { ProcessChapterStreamingOptions } from './chapter-processing'

export function createDownloadingProgressPayload(input: {
  taskId: string
  chapterId: string
  chapterTitle: string
  imagesProcessed: number
  totalImages: number
  imagesFailed?: number
  fsaFallbackTriggered?: boolean
}): OffscreenDownloadProgressMessage['payload'] {
  const { taskId, chapterId, chapterTitle, imagesProcessed, totalImages, imagesFailed = 0, fsaFallbackTriggered } = input
  return {
    taskId,
    chapterId,
    chapterTitle,
    status: 'downloading',
    imagesProcessed,
    imagesFailed,
    totalImages,
    fsaFallbackTriggered,
  }
}

export async function sendInitialDownloadHeartbeat(input: {
  request: OffscreenDownloadChapterMessage['payload']
  sendMessageWithRetry: <T extends import('@/src/types/extension-messages').ExtensionMessage, R>(msg: T, attempts?: number, baseDelayMs?: number) => Promise<R>
}): Promise<void> {
  const { request, sendMessageWithRetry } = input
  await sendMessageWithRetry(
    {
      type: 'OFFSCREEN_DOWNLOAD_PROGRESS',
      payload: createDownloadingProgressPayload({
        taskId: request.taskId,
        chapterId: request.chapter.id,
        chapterTitle: request.chapter.title,
        imagesProcessed: 0,
        totalImages: 0,
      }),
    } as OffscreenDownloadProgressMessage,
    3,
    250,
  )
}

export function createStreamingProgressHandlers(input: {
  taskId: string
  chapterId: string
  chapterTitle: string
  latestImageProgress: { current: number; total: number }
  emitProgressMessage: (payload: OffscreenDownloadProgressMessage['payload']) => Promise<void>
}): Pick<ProcessChapterStreamingOptions, 'onProgress' | 'onArchiveProgress'> {
  const { taskId, chapterId, chapterTitle, latestImageProgress, emitProgressMessage } = input

  const emitProgressUpdate = async (): Promise<void> => {
    await emitProgressMessage(createDownloadingProgressPayload({
      taskId,
      chapterId,
      chapterTitle,
      imagesProcessed: latestImageProgress.current,
      totalImages: latestImageProgress.total,
    }))
  }

  const onProgress: ProcessChapterStreamingOptions['onProgress'] = async (_pct, _label, imageProgress) => {
    if (imageProgress) {
      latestImageProgress.current = imageProgress.current
      latestImageProgress.total = imageProgress.total
    }
    await emitProgressUpdate()
  }

  const onArchiveProgress: ProcessChapterStreamingOptions['onArchiveProgress'] = async () => {
    await emitProgressUpdate()
  }

  return {
    onProgress,
    onArchiveProgress,
  }
}
