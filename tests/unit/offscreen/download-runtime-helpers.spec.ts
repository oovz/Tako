import { describe, expect, it, vi } from "vitest"

import {
  prefetchCoverImage,
  requestBrowserBlobDownload,
} from "@/entrypoints/offscreen/download-runtime-helpers"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import type { RateLimitService } from "@/src/runtime/rate-limit"

const { scheduleForIntegrationScope, sendDownloadApiRequest } = vi.hoisted(
  () => ({
    scheduleForIntegrationScope: vi.fn(
      async (
        _integrationId: string,
        _scope: string,
        task: () => Promise<unknown>
      ) => task()
    ),
    sendDownloadApiRequest: vi.fn(),
  })
)
const { offscreenSiteAdaptersById } = vi.hoisted(() => ({
  offscreenSiteAdaptersById: {} as Record<string, unknown>,
}))

vi.mock("@/src/runtime/generated/site-integration-offscreen-registry", () => ({
  offscreenSiteAdaptersById,
}))

vi.mock("@/src/runtime/rate-limit", () => ({
  scheduleForIntegrationScope,
}))

vi.mock("@/entrypoints/offscreen/helpers", () => ({
  sendDownloadApiRequest,
}))

const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope,
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService

function makeIntegration(input: {
  cover?: (url: string, options: Record<string, unknown>) => Promise<unknown>
  chapter: (url: string, options: Record<string, unknown>) => Promise<unknown>
}) {
  return {
    id: "test-site",
    offscreen: {
      name: "Test offscreen",
      cover: input.cover ? { downloadImage: input.cover } : undefined,
      chapter: {
        resolveChapterPlan: async () => ({
          imageUrls: ["https://example.test/chapter.jpg"],
        }),
        downloadImage: input.chapter,
      },
    },
  } as never
}

describe("prefetchCoverImage", () => {
  it("prefers the dedicated cover hook and admits it once", async () => {
    const dedicated = vi.fn(async (_url, options) => {
      await options.onBytesReceived?.(12)
      return {
        data: new ArrayBuffer(1),
        filename: "cover.gif",
        mimeType: "image/gif",
      }
    })
    const chapter = vi.fn(async () => ({
      data: new ArrayBuffer(2),
      filename: "chapter.jpg",
      mimeType: "image/jpeg",
    }))
    offscreenSiteAdaptersById["test-site"] = makeIntegration({
      cover: dedicated,
      chapter,
    })
    const onActivity = vi.fn(async () => undefined)
    const withImageRetries = vi.fn(async (fn, hooks) => {
      await hooks?.onAttemptStart?.(1)
      return await fn()
    })

    await expect(
      prefetchCoverImage({
        coverUrl: "https://images.example/cover.gif",
        integrationId: "test-site",
        rateLimitService,
        rateLimitSettings: {
          image: { concurrency: 1, delayMs: 0 },
          chapter: { concurrency: 1, delayMs: 0 },
        },
        signal: new AbortController().signal,
        onActivity,
        withImageRetries,
        liveResourceLedger: new OffscreenLiveResourceLedger(),
      })
    ).resolves.toMatchObject({ mimeType: "image/gif" })

    expect(dedicated).toHaveBeenCalledOnce()
    expect(chapter).not.toHaveBeenCalled()
    expect(scheduleForIntegrationScope).toHaveBeenCalledOnce()
    expect(dedicated.mock.calls[0]?.[1]).toMatchObject({
      skipRateLimit: true,
    })
    expect(onActivity).toHaveBeenCalledTimes(2)
  })

  it("falls back to the chapter hook and forwards cancellation", async () => {
    const controller = new AbortController()
    const reason = new Error("cancelled")
    controller.abort(reason)
    const chapter = vi.fn(async (_url, options) => {
      expect(options.signal).toBe(controller.signal)
      throw reason
    })
    offscreenSiteAdaptersById["test-site"] = makeIntegration({ chapter })

    await expect(
      prefetchCoverImage({
        coverUrl: "https://images.example/cover.jpg",
        integrationId: "test-site",
        rateLimitService,
        rateLimitSettings: {
          image: { concurrency: 1, delayMs: 0 },
          chapter: { concurrency: 1, delayMs: 0 },
        },
        signal: controller.signal,
        withImageRetries: async (fn) => fn(),
        liveResourceLedger: new OffscreenLiveResourceLedger(),
      })
    ).resolves.toBeUndefined()
    expect(chapter).toHaveBeenCalledOnce()
  })
})

describe("requestBrowserBlobDownload", () => {
  it("does not replay an exact-identity handoff after transport failure", async () => {
    const controller = new AbortController()
    sendDownloadApiRequest.mockRejectedValueOnce(
      new Error("worker unavailable")
    )

    await expect(
      requestBrowserBlobDownload({
        jobId: "job-1",
        attempt: 1,
        outputId: "output-1",
        taskId: "task-1",
        chapterId: "chapter-1",
        fingerprint: "a".repeat(64),
        documentInstanceId: "document-1",
        fileUrl: "blob:output-1",
        filename: "Chapter 1.cbz",
        outputIndex: 0,
        outputCount: 1,
        outputKind: "archive",
        signal: controller.signal,
      })
    ).rejects.toThrow("worker unavailable")

    expect(sendDownloadApiRequest).toHaveBeenCalledOnce()
    expect(sendDownloadApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outputId: "output-1",
        fingerprint: "a".repeat(64),
        documentInstanceId: "document-1",
      }),
      controller.signal
    )
  })
})
