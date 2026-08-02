import { describe, expect, it, vi } from "vitest"

import {
  ChapterResourceLimitError,
  downloadChapterImages,
} from "@/entrypoints/offscreen/chapter-image-downloads"
import type { ChapterProcessingRuntime } from "@/entrypoints/offscreen/chapter-processing"
import {
  MAX_CHAPTER_IMAGE_BYTES,
  MAX_CHAPTER_IMAGES,
} from "@/src/constants/timeouts"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/src/runtime/rate-limit", () => ({
  scheduleForIntegrationScope: vi.fn(
    async (
      _integrationId: string,
      _scope: string,
      task: () => Promise<unknown>
    ) => task()
  ),
}))

const RATE_LIMIT_SETTINGS = {
  image: { concurrency: 10, delayMs: 0 },
  chapter: { concurrency: 1, delayMs: 0 },
}

describe("downloadChapterImages", () => {
  it("rejects a chapter whose declared image count exceeds the job budget", async () => {
    const downloadImage = vi.fn()
    const runtime = {
      withImageRetries: vi.fn(),
    } as unknown as ChapterProcessingRuntime

    await expect(
      downloadChapterImages(runtime, {
        urls: Array.from(
          { length: MAX_CHAPTER_IMAGES + 1 },
          (_, index) => `https://example.com/${index}.jpg`
        ),
        integrationId: "test-site",
        chapterId: "chapter-1",
        rateLimitSettings: RATE_LIMIT_SETTINGS,
        onProgress: vi.fn(),
        downloadImage,
        onDownloaded: vi.fn(),
        onDownloadFailed: vi.fn(),
      })
    ).rejects.toBeInstanceOf(ChapterResourceLimitError)
    expect(downloadImage).not.toHaveBeenCalled()
  })

  it("rejects when aggregate chapter image bytes cross the job budget", async () => {
    const runtime: ChapterProcessingRuntime = {
      withImageRetries: async (fn) => fn(),
      resolveWritableDownloadRoot: vi.fn(),
      requestBrowserBlobDownload: vi.fn(),
      getMemoryStats: vi.fn(() => null),
    }

    await expect(
      downloadChapterImages(runtime, {
        urls: ["https://example.com/1.jpg"],
        integrationId: "test-site",
        chapterId: "chapter-1",
        rateLimitSettings: RATE_LIMIT_SETTINGS,
        initialAggregateBytes: MAX_CHAPTER_IMAGE_BYTES,
        onProgress: vi.fn(async () => undefined),
        downloadImage: vi.fn(async () => ({
          data: new ArrayBuffer(1),
          filename: "1.jpg",
          mimeType: "image/jpeg",
        })),
        onDownloaded: vi.fn(),
        onDownloadFailed: vi.fn(),
      })
    ).rejects.toBeInstanceOf(ChapterResourceLimitError)
  })

  it("rejects in-flight image bytes before concurrent buffers cross the chapter budget", async () => {
    const controller = new AbortController()
    const onDownloadFailed = vi.fn()
    const runtime: ChapterProcessingRuntime = {
      withImageRetries: async (fn) => fn(),
      resolveWritableDownloadRoot: vi.fn(),
      requestBrowserBlobDownload: vi.fn(),
      getMemoryStats: vi.fn(() => null),
    }
    const downloadImage = vi.fn(
      async (
        _url: string,
        opts?: {
          signal?: AbortSignal
          onBytesReceived?: (bytesReceived: number) => void | Promise<void>
        }
      ) => {
        await opts?.onBytesReceived?.(32)
        await new Promise<never>((_, reject) => {
          const onAbort = () => reject(new Error("aborted"))
          if (opts?.signal?.aborted) {
            onAbort()
            return
          }
          opts?.signal?.addEventListener("abort", onAbort, { once: true })
        })
        throw new Error("unreachable")
      }
    )

    const resultPromise = downloadChapterImages(runtime, {
      urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      integrationId: "test-site",
      chapterId: "chapter-1",
      rateLimitSettings: RATE_LIMIT_SETTINGS,
      initialAggregateBytes: MAX_CHAPTER_IMAGE_BYTES - 16,
      abortSignal: controller.signal,
      onProgress: vi.fn(async () => undefined),
      downloadImage,
      onDownloaded: vi.fn(),
      onDownloadFailed,
    })
    const settledResultPromise = resultPromise.catch(() => undefined)

    let rejectedByBudget = false
    await vi
      .waitFor(
        () =>
          expect(onDownloadFailed).toHaveBeenCalledWith(
            expect.objectContaining({
              error: expect.any(ChapterResourceLimitError),
            })
          ),
        { timeout: 100 }
      )
      .then(
        () => {
          rejectedByBudget = true
        },
        () => undefined
      )

    controller.abort()
    await settledResultPromise
    expect(rejectedByBudget).toBe(true)
  })

  it("uses the image concurrency from the task rate-limit snapshot", async () => {
    const urls = Array.from(
      { length: 5 },
      (_, index) => `https://example.com/${index + 1}.jpg`
    )
    const downloadImage = vi.fn(
      () =>
        new Promise<{ data: ArrayBuffer; filename: string; mimeType: string }>(
          () => undefined
        )
    )
    const runtime: ChapterProcessingRuntime = {
      withImageRetries: async (fn) => fn(),
      resolveWritableDownloadRoot: vi.fn(),
      requestBrowserBlobDownload: vi.fn(),
      getMemoryStats: vi.fn(() => null),
    }

    void downloadChapterImages(runtime, {
      urls,
      integrationId: "test-site",
      chapterId: "chapter-1",
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

  it("drops queued image jobs when the chapter abort signal fires", async () => {
    const controller = new AbortController()
    const urls = Array.from(
      { length: 20 },
      (_, index) => `https://example.com/${index + 1}.jpg`
    )
    const onDownloadFailed = vi.fn()
    const onProgress = vi.fn(async () => undefined)
    const downloadImage = vi.fn(
      (_url: string, opts?: { signal?: AbortSignal }) => {
        return new Promise<{
          data: ArrayBuffer
          filename: string
          mimeType: string
        }>((_resolve, reject) => {
          const rejectAsAborted = () => reject(new Error("aborted"))
          if (opts?.signal?.aborted) {
            rejectAsAborted()
            return
          }
          opts?.signal?.addEventListener("abort", rejectAsAborted, {
            once: true,
          })
        })
      }
    )

    const runtime: ChapterProcessingRuntime = {
      withImageRetries: async (fn) => fn(),
      resolveWritableDownloadRoot: vi.fn(),
      requestBrowserBlobDownload: vi.fn(),
      getMemoryStats: vi.fn(() => null),
    }

    const resultPromise = downloadChapterImages(runtime, {
      urls,
      integrationId: "test-site",
      chapterId: "chapter-1",
      rateLimitSettings: RATE_LIMIT_SETTINGS,
      abortSignal: controller.signal,
      onProgress,
      downloadImage,
      onDownloaded: vi.fn(),
      onDownloadFailed,
    })

    await vi.waitFor(() => {
      expect(downloadImage).toHaveBeenCalledTimes(10)
    })

    controller.abort("User cancelled")
    const result = await resultPromise

    expect(downloadImage).toHaveBeenCalledTimes(10)
    expect(onDownloadFailed).toHaveBeenCalledTimes(10)
    expect(result).toMatchObject({
      total: 20,
      processed: 10,
      failed: 10,
      succeeded: 0,
    })
  })

  it("emits attempt and byte progress without timer-driven in-flight updates", async () => {
    vi.useFakeTimers()
    try {
      const onProgress = vi.fn(async () => undefined)
      let resolveImage!: (value: {
        data: ArrayBuffer
        filename: string
        mimeType: string
      }) => void
      let reportBytes:
        ((bytesReceived: number) => void | Promise<void>) | undefined
      const downloadImage = vi.fn(
        (
          _url: string,
          opts?: {
            onBytesReceived?: (bytesReceived: number) => void | Promise<void>
          }
        ) =>
          new Promise<{
            data: ArrayBuffer
            filename: string
            mimeType: string
          }>((resolve) => {
            reportBytes = opts?.onBytesReceived
            resolveImage = resolve
          })
      )
      const runtime: ChapterProcessingRuntime = {
        withImageRetries: async (fn, hooks) => {
          await hooks?.onAttemptStart?.(1)
          return fn()
        },
        resolveWritableDownloadRoot: vi.fn(),
        requestBrowserBlobDownload: vi.fn(),
        getMemoryStats: vi.fn(() => null),
      }

      const resultPromise = downloadChapterImages(runtime, {
        urls: ["https://example.com/slow.jpg"],
        integrationId: "test-site",
        chapterId: "chapter-1",
        rateLimitSettings: RATE_LIMIT_SETTINGS,
        onProgress,
        downloadImage,
        onDownloaded: vi.fn(),
        onDownloadFailed: vi.fn(),
      })

      await vi.waitFor(() => {
        expect(downloadImage).toHaveBeenCalledTimes(1)
      })
      expect(onProgress).toHaveBeenCalledTimes(1)
      expect(onProgress).toHaveBeenLastCalledWith(10, "downloading", {
        current: 0,
        total: 1,
      })

      await vi.advanceTimersByTimeAsync(15_000)
      expect(onProgress).toHaveBeenCalledTimes(1)

      await reportBytes?.(1024)
      expect(onProgress).toHaveBeenCalledTimes(2)
      expect(onProgress).toHaveBeenLastCalledWith(10, "downloading", {
        current: 0,
        total: 1,
      })

      resolveImage({
        data: new ArrayBuffer(1),
        filename: "slow.jpg",
        mimeType: "image/jpeg",
      })

      await resultPromise
      expect(onProgress).toHaveBeenLastCalledWith(100, undefined, {
        current: 1,
        total: 1,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
