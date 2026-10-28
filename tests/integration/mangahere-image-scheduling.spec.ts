import { afterEach, describe, expect, it, vi } from "vitest"
import {
  processNoneFormatChapter,
  type ChapterProcessingRuntime,
} from "@/entrypoints/offscreen/chapter-processing"
import { prefetchCoverImage } from "@/entrypoints/offscreen/download-runtime-helpers"
import { offscreenSiteAdapter as mangaHere } from "@/src/site-integrations/mangahere/offscreen-runtime"

import { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
vi.mock("@/entrypoints/offscreen/archive-worker-factory", () => ({
  default: () => {
    throw new Error("Archive worker is not used for loose files")
  },
}))
const services: RateLimitService[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const service of services.splice(0)) service.cleanupRateLimiters()
})
const cases = [
  {
    id: "mangahere",
    adapter: mangaHere,
    url: "https://zjcdn.mangahere.org/store/manga/1/page.jpg",
  },
]
describe.each(cases)("$id image scheduling", ({ id, adapter, url }) => {
  it("saves loose images with the captured policy when current defaults cannot be read", async () => {
    const rateLimitService = new RateLimitService({
      resolveEffectivePolicy: () =>
        Promise.reject(new Error("Current global policy is unavailable")),
    })
    services.push(rateLimitService)
    const ledger = new OffscreenLiveResourceLedger()
    const controller = new AbortController()
    const outputs: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) => {
        const response = new Response(
          new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
          { headers: { "content-type": "image/jpeg" } }
        )
        Object.defineProperty(response, "url", { value })
        return response
      })
    )
    const settings = {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, id),
      rateLimitSettings: {
        image: { concurrency: 1, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 0 },
      },
    }
    const runtime: ChapterProcessingRuntime = {
      rateLimitService,
      liveResourceLedger: ledger,
      withImageRetries: (fn) => fn(),
      beginFsaWrite: async () => {},
      resolveWritableDownloadRoot: async () => {
        throw new Error("Browser destination")
      },
      requestBrowserBlobDownload: async (input) => {
        outputs.push(input.filename)
        input.resourceLease.release()
        return { success: true, disposition: "tracked", phase: "waiting" }
      },
      getMemoryStats: () => null,
    }
    const processing = processNoneFormatChapter(runtime, {
      integrationId: id,
      urls: [url, url.replace("page.jpg", "page-two.jpg")],
      downloadImage: adapter.offscreen.chapter.downloadImage,
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
      opts: {
        taskId: "task",
        jobId: "job",
        attempt: 1,
        chapter: {
          id: "chapter",
          title: "Chapter",
          url: "https://example.com/chapter",
          resolvedPath: "chapter",
          comicInfo: {},
        },
        seriesTitle: "Series",
        format: "none",
        downloadMode: "browser",
        includeComicInfo: false,
        comicInfoVersion: "2.0",
        abortSignal: controller.signal,
        onProgress: async () => {},
        onArchiveProgress: async () => {},
        settingsSnapshot: settings,
      },
    })
    void processing.catch(() => {})
    try {
      const result = await processing
      expect(outputs).toHaveLength(2)
      expect(result).toMatchObject({
        status: "completed",
        outputsRequested: 2,
        outputsFailedBeforeHandoff: 0,
      })
    } finally {
      controller.abort()
    }
  })
  it("fetches a cover while prefetch owns the only image slot", async () => {
    const rateLimitService = new RateLimitService({
      resolveEffectivePolicy: () =>
        Promise.reject(new Error("Current global policy is unavailable")),
    })
    services.push(rateLimitService)
    const ledger = new OffscreenLiveResourceLedger()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) => {
        const response = new Response(
          new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
          { headers: { "content-type": "image/jpeg" } }
        )
        Object.defineProperty(response, "url", { value })
        return response
      })
    )
    const cover = await prefetchCoverImage({
      coverUrl: url,
      integrationId: id,
      rateLimitService,
      rateLimitSettings: {
        image: { concurrency: 1, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 0 },
      },
      withImageRetries: (fn) => fn(),
      liveResourceLedger: ledger,
    })
    expect(cover?.data.byteLength).toBe(4)
    cover?.liveResourceLease.release()
  })
})
