import { afterEach, describe, expect, it, vi } from "vitest"
import { offscreenSiteAdaptersById } from "@/src/runtime/generated/site-integration-offscreen-registry"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import {
  processNoneFormatChapter,
  type ChapterProcessingRuntime,
  type ProcessChapterStreamingOptions,
} from "@/entrypoints/offscreen/chapter-processing"
import { prefetchCoverImage } from "@/entrypoints/offscreen/download-runtime-helpers"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { SHONEN_JUMP_PLUS_SCRAMBLED_PNG } from "@/tests/e2e/fixtures/mock-data/site-integrations/shonenjumpplus/scrambled-image-fixture"

const services: RateLimitService[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  services.splice(0).forEach((service) => service.cleanupRateLimiters())
})

describe.each(["manganato"] as const)("%s scheduled chapter output", (id) => {
  it.each([1, 2])(
    "hands every page and cover to browser output with image concurrency %i",
    async (concurrency) => {
      const rateLimitSettings = {
        image: { concurrency, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 0 },
      }
      const rateLimitService = new RateLimitService({
        resolveEffectivePolicy: async () => rateLimitSettings.image,
      })
      services.push(rateLimitService)
      const controller = new AbortController()
      const deadline = setTimeout(
        () =>
          controller.abort(new Error("Chapter processing deadline exceeded")),
        2000
      )
      const ledger = new OffscreenLiveResourceLedger()
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          init?.signal?.throwIfAborted()
          return new Response(new Uint8Array(SHONEN_JUMP_PLUS_SCRAMBLED_PNG), {
            headers: { "content-type": "image/png" },
          })
        })
      )
      const output: string[] = []
      const runtime: ChapterProcessingRuntime = {
        rateLimitService,
        liveResourceLedger: ledger,
        withImageRetries: (operation) => operation(),
        beginFsaWrite: async () => {},
        resolveWritableDownloadRoot: async () => {
          throw new Error("Unexpected folder access")
        },
        requestBrowserBlobDownload: async ({ filename }) => {
          output.push(filename)
          return { success: true, disposition: "tracked", phase: "waiting" }
        },
        getMemoryStats: () => null,
      }
      const cover = await prefetchCoverImage({
        integrationId: id,
        coverUrl: "https://img-r1.2xstorage.com/thumb/series.png",
        rateLimitService,
        rateLimitSettings,
        liveResourceLedger: ledger,
        withImageRetries: (operation) => operation(),
        signal: controller.signal,
      })
      expect(cover).toBeDefined()
      const opts: ProcessChapterStreamingOptions & { format: "none" } = {
        taskId: "task",
        jobId: "job",
        attempt: 1,
        chapter: {
          id: "chapter-1",
          title: "Chapter 1",
          url: `https://www.${id === "manganato" ? "manganato.gg" : "mangakakalove.com"}/manga/series/chapter-1`,
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
        coverImage: cover,
        settingsSnapshot: {
          ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, id),
          rateLimitSettings,
        },
      }
      try {
        const result = await processNoneFormatChapter(runtime, {
          urls: [0, 1, 2].map(
            (page) => `https://img-r1.2xstorage.com/series/1/${page}.png`
          ),
          integrationId: id,
          downloadImage:
            offscreenSiteAdaptersById[id].offscreen.chapter.downloadImage,
          normalizeSettings: {
            normalizeImageFilenames: true,
            imagePaddingDigits: 3,
          },
          opts,
        })
        expect(result).toMatchObject({
          status: "completed",
          outputsRequested: 4,
          outputsFailedBeforeHandoff: 0,
        })
        expect(output).toEqual([
          "chapter/000-cover.png",
          "chapter/001.png",
          "chapter/002.png",
          "chapter/003.png",
        ])
      } finally {
        clearTimeout(deadline)
        controller.abort()
        cover?.liveResourceLease.release()
      }
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )
})
