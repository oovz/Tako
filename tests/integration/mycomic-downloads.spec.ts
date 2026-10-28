import { readFileSync } from "node:fs"
import { Window } from "happy-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { offscreenSiteAdaptersById } from "@/src/runtime/generated/site-integration-offscreen-registry"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import {
  processNoneFormatChapter,
  type ChapterProcessingRuntime,
  type ProcessChapterStreamingOptions,
} from "@/entrypoints/offscreen/chapter-processing"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { SHONEN_JUMP_PLUS_SCRAMBLED_PNG } from "@/tests/e2e/fixtures/mock-data/site-integrations/shonenjumpplus/scrambled-image-fixture"
import contract from "@/tests/fixtures/site-integrations/mycomic/contract.json"

const readerHtml = readFileSync(
  "tests/fixtures/site-integrations/mycomic/reader.html",
  "utf8"
)
const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const window = new Window()
afterEach(() => {
  vi.unstubAllGlobals()
  rateLimitService.cleanupRateLimiters()
})

describe("MyComic registered download workflow", () => {
  it("produces ordered complete reader files and releases their resources", async () => {
    vi.stubGlobal("DOMParser", window.DOMParser)
    const fetch = vi.fn(async (url: string) =>
      url.includes("mycomic.com/")
        ? new Response(readerHtml, {
            headers: { "content-type": "text/html; charset=utf-8" },
          })
        : new Response(new Uint8Array(SHONEN_JUMP_PLUS_SCRAMBLED_PNG), {
            headers: { "content-type": "image/png" },
          })
    )
    vi.stubGlobal("fetch", fetch)
    const integration = offscreenSiteAdaptersById.mycomic.offscreen
    const rateLimitSettings = {
      image: { concurrency: 1, delayMs: 0 },
      chapter: { concurrency: 1, delayMs: 0 },
    }
    const chapter = {
      id: "492177",
      url: contract.data.readerUrl,
      title: "第01話",
      resolvedPath: "chapter",
      comicInfo: {},
    }
    const plan = await integration.chapter.resolveChapterPlan(chapter, {
      runtime: { rateLimitService, rateLimitSettings },
    })
    expect(plan.imageUrls).toHaveLength(39)
    expect(plan.imageUrls[0]).toBe(contract.data.firstImage)
    const ledger = new OffscreenLiveResourceLedger()
    const saved: string[] = []
    const runtime: ChapterProcessingRuntime = {
      liveResourceLedger: ledger,
      rateLimitService,
      withImageRetries: (operation) => operation(),
      beginFsaWrite: async () => {},
      resolveWritableDownloadRoot: async () => {
        throw new Error("Unexpected folder access")
      },
      requestBrowserBlobDownload: async ({ filename }) => {
        saved.push(filename)
        return { success: true, disposition: "tracked", phase: "waiting" }
      },
      getMemoryStats: () => null,
    }
    const opts: ProcessChapterStreamingOptions = {
      taskId: "mycomic-task",
      jobId: "mycomic-job",
      attempt: 1,
      chapter,
      seriesTitle: "葬送者芙莉莲",
      format: "none",
      downloadMode: "browser",
      includeComicInfo: false,
      comicInfoVersion: "2.0",
      abortSignal: new AbortController().signal,
      onProgress: async () => {},
      onArchiveProgress: async () => {},
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mycomic"),
        rateLimitSettings,
      },
    }
    const result = await processNoneFormatChapter(runtime, {
      urls: plan.imageUrls,
      integrationId: "mycomic",
      downloadImage: integration.chapter.downloadImage,
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
      opts: { ...opts, format: "none" },
    })
    expect(result).toMatchObject({ outputsRequested: 39 })
    expect(saved).toHaveLength(39)
    expect(saved[0]).toContain("001")
    expect(saved[38]).toContain("039")
    expect(ledger.getUsedBytes()).toBe(0)
  })
  it("surfaces blocked reader responses and rejects an incomplete required page sequence", async () => {
    vi.stubGlobal("DOMParser", window.DOMParser)
    const integration = offscreenSiteAdaptersById.mycomic.offscreen
    const input = {
      runtime: {
        rateLimitService,
        rateLimitSettings: {
          image: { concurrency: 1, delayMs: 0 },
          chapter: { concurrency: 1, delayMs: 0 },
        },
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Blocked", { status: 403 }))
    )
    await expect(
      integration.chapter.resolveChapterPlan(
        { id: "492177", url: contract.data.readerUrl },
        input
      )
    ).rejects.toMatchObject({ status: 403 })
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(readerHtml.replace(/<img x-ref="page-1"[^>]*>/, ""), {
            headers: { "content-type": "text/html; charset=utf-8" },
          })
      )
    )
    await expect(
      integration.chapter.resolveChapterPlan(
        { id: "492177", url: contract.data.readerUrl },
        input
      )
    ).rejects.toThrow("missing a required page")
  })
})
