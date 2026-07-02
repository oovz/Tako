import { describe, expect, it, vi } from 'vitest'

import { downloadChapterImages } from '@/entrypoints/offscreen/chapter-image-downloads'
import type { ChapterProcessingRuntime } from '@/entrypoints/offscreen/chapter-processing'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/src/runtime/rate-limit', () => ({
  scheduleForIntegrationScope: vi.fn(async (_integrationId: string, _scope: string, task: () => Promise<unknown>) => task()),
}))

describe('downloadChapterImages', () => {
  it('uses the image concurrency from the task rate-limit snapshot', async () => {
    const urls = Array.from({ length: 5 }, (_, index) => `https://example.com/${index + 1}.jpg`)
    const downloadImage = vi.fn(() => new Promise<{ data: ArrayBuffer; filename: string; mimeType: string }>(() => undefined))
    const runtime: ChapterProcessingRuntime = {
      withImageRetries: async (fn) => fn(),
      resolveWritableDownloadRoot: vi.fn(),
      emitFsaFallbackProgress: vi.fn(),
      requestBrowserBlobDownload: vi.fn(),
      retryWithBrowserDownloads: vi.fn(),
      getMemoryStats: vi.fn(() => null),
    }

    void downloadChapterImages(runtime, {
      urls,
      integrationId: 'test-site',
      chapterId: 'chapter-1',
      rateLimitSettings: {
        image: { concurrency: 2, delayMs: 0 },
        chapter: { concurrency: 2, delayMs: 0 },
      },
      onProgress: vi.fn(async () => undefined),
      downloadImage,
      onDownloaded: vi.fn(),
      onDownloadFailed: vi.fn(),
    })

    await vi.waitFor(() => {
      expect(downloadImage).toHaveBeenCalledTimes(2)
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(downloadImage).toHaveBeenCalledTimes(2)
  })

  it('drops queued image jobs when the chapter abort signal fires', async () => {
    const controller = new AbortController()
    const urls = Array.from({ length: 20 }, (_, index) => `https://example.com/${index + 1}.jpg`)
    const onDownloadFailed = vi.fn()
    const onProgress = vi.fn(async () => undefined)
    const downloadImage = vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
      return new Promise<{ data: ArrayBuffer; filename: string; mimeType: string }>((_resolve, reject) => {
        const rejectAsAborted = () => reject(new Error('aborted'))
        if (opts?.signal?.aborted) {
          rejectAsAborted()
          return
        }
        opts?.signal?.addEventListener('abort', rejectAsAborted, { once: true })
      })
    })

    const runtime: ChapterProcessingRuntime = {
      withImageRetries: async (fn) => fn(),
      resolveWritableDownloadRoot: vi.fn(),
      emitFsaFallbackProgress: vi.fn(),
      requestBrowserBlobDownload: vi.fn(),
      retryWithBrowserDownloads: vi.fn(),
      getMemoryStats: vi.fn(() => null),
    }

    const resultPromise = downloadChapterImages(runtime, {
      urls,
      integrationId: 'test-site',
      chapterId: 'chapter-1',
      abortSignal: controller.signal,
      onProgress,
      downloadImage,
      onDownloaded: vi.fn(),
      onDownloadFailed,
    })

    await vi.waitFor(() => {
      expect(downloadImage).toHaveBeenCalledTimes(16)
    })

    controller.abort('User cancelled')
    const result = await resultPromise

    expect(downloadImage).toHaveBeenCalledTimes(16)
    expect(onDownloadFailed).toHaveBeenCalledTimes(16)
    expect(result).toMatchObject({
      total: 20,
      processed: 16,
      failed: 16,
      succeeded: 0,
    })
  })

  it('emits attempt and byte progress without timer-driven in-flight updates', async () => {
    vi.useFakeTimers()
    try {
      const onProgress = vi.fn(async () => undefined)
      let resolveImage!: (value: { data: ArrayBuffer; filename: string; mimeType: string }) => void
      let reportBytes: ((bytesReceived: number) => void | Promise<void>) | undefined
      const downloadImage = vi.fn((_url: string, opts?: { onBytesReceived?: (bytesReceived: number) => void | Promise<void> }) => new Promise<{ data: ArrayBuffer; filename: string; mimeType: string }>((resolve) => {
        reportBytes = opts?.onBytesReceived
        resolveImage = resolve
      }))
      const runtime: ChapterProcessingRuntime = {
        withImageRetries: async (fn, hooks) => {
          await hooks?.onAttemptStart?.(1)
          return fn()
        },
        resolveWritableDownloadRoot: vi.fn(),
        emitFsaFallbackProgress: vi.fn(),
        requestBrowserBlobDownload: vi.fn(),
        retryWithBrowserDownloads: vi.fn(),
        getMemoryStats: vi.fn(() => null),
      }

      const resultPromise = downloadChapterImages(runtime, {
        urls: ['https://example.com/slow.jpg'],
        integrationId: 'test-site',
        chapterId: 'chapter-1',
        onProgress,
        downloadImage,
        onDownloaded: vi.fn(),
        onDownloadFailed: vi.fn(),
      })

      await vi.waitFor(() => {
        expect(downloadImage).toHaveBeenCalledTimes(1)
      })
      expect(onProgress).toHaveBeenCalledTimes(1)
      expect(onProgress).toHaveBeenLastCalledWith(10, 'downloading', { current: 0, total: 1 })

      await vi.advanceTimersByTimeAsync(15_000)
      expect(onProgress).toHaveBeenCalledTimes(1)

      await reportBytes?.(1024)
      expect(onProgress).toHaveBeenCalledTimes(2)
      expect(onProgress).toHaveBeenLastCalledWith(10, 'downloading', { current: 0, total: 1 })

      resolveImage({
        data: new ArrayBuffer(1),
        filename: 'slow.jpg',
        mimeType: 'image/jpeg',
      })

      await resultPromise
      expect(onProgress).toHaveBeenLastCalledWith(100, undefined, { current: 1, total: 1 })
    } finally {
      vi.useRealTimers()
    }
  })
})
