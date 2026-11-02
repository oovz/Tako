import { describe, expect, it, vi } from "vitest"

import {
  createStreamingProgressHandlers,
  type UnsequencedProgressPayload,
} from "@/entrypoints/offscreen/progress-helpers"
import { downloadChapterImages } from "@/entrypoints/offscreen/chapter-image-downloads"
import type { ChapterProcessingRuntime } from "@/entrypoints/offscreen/chapter-processing-types"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { RateLimitService } from "@/src/runtime/rate-limit"

describe("streaming offscreen progress", () => {
  it("reports cover retrieval during chapter resolution", async () => {
    const emitted: unknown[] = []
    const handlers = createStreamingProgressHandlers({
      taskId: "task-1",
      chapterId: "chapter-1",
      chapterTitle: "Chapter 1",
      latestImageProgress: { current: 0, total: 0 },
      emitProgressMessage: async (payload) => {
        emitted.push(payload)
      },
    })

    await handlers.onArchiveProgress(0, "cover")

    expect(emitted).toEqual([
      expect.objectContaining({ stage: "resolving", phaseFraction: 0.5 }),
    ])
  })

  it("reports archiving only when archive finalization begins", async () => {
    const emitted: unknown[] = []
    const handlers = createStreamingProgressHandlers({
      taskId: "task-1",
      chapterId: "chapter-1",
      chapterTitle: "Chapter 1",
      latestImageProgress: { current: 5, total: 5 },
      emitProgressMessage: async (payload) => {
        emitted.push(payload)
      },
    })

    await handlers.onProgress(100, "downloading", { current: 5, total: 5 })
    await handlers.onArchiveProgress(90, "finalizing")

    expect(emitted).toEqual([
      expect.objectContaining({ stage: "downloading" }),
      expect.objectContaining({ stage: "archiving" }),
    ])
  })
})

describe("download completion progress", () => {
  it.each([2, 1])(
    "publishes the completed-image fraction for a %i-page chapter",
    async (total) => {
      const emitted: UnsequencedProgressPayload[] = []
      const rateLimitService = new RateLimitService({
        resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
      })
      const runtime: ChapterProcessingRuntime = {
        liveResourceLedger: new OffscreenLiveResourceLedger(),
        rateLimitService,
        withImageRetries: async (fn) => fn(),
        beginFsaWrite: vi.fn(),
        resolveWritableDownloadRoot: vi.fn(),
        requestBrowserBlobDownload: vi.fn(),
        getMemoryStats: () => null,
      }
      const handlers = createStreamingProgressHandlers({
        taskId: "task-1",
        chapterId: "chapter-1",
        chapterTitle: "Chapter 1",
        latestImageProgress: { current: 0, total: 0 },
        emitProgressMessage: async (payload) => {
          emitted.push(payload)
        },
      })
      try {
        const result = await downloadChapterImages(runtime, {
          urls: Array.from(
            { length: total },
            (_, index) => `https://example.com/${index + 1}.jpg`
          ),
          integrationId: "mangadex",
          chapterId: "chapter-1",
          rateLimitSettings: {
            image: { concurrency: 1, delayMs: 0 },
            chapter: { concurrency: 1, delayMs: 0 },
          },
          rateLimitService,
          onProgress: handlers.onProgress,
          downloadImage: async () => ({
            filename: "page.jpg",
            data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
            mimeType: "image/jpeg",
            liveResourceLease: runtime.liveResourceLedger.reserve(4, "image"),
          }),
          onDownloaded: async () => {},
          onDownloadFailed: vi.fn(),
        })
        expect(result).toMatchObject({ succeeded: total, failed: 0 })
        expect(emitted).toHaveLength(total)
        const first = emitted[0]
        expect(first).toMatchObject({
          stage: "downloading",
          phaseFraction: 1 / total,
          imagesProcessed: 1,
          totalImages: total,
        })
        expect(runtime.liveResourceLedger.getUsedBytes()).toBe(0)
      } finally {
        rateLimitService.cleanupRateLimiters()
      }
    }
  )
})
