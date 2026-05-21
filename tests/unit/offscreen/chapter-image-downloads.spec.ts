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
})
