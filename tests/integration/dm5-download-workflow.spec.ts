// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  processNoneFormatChapter,
  type ChapterProcessingRuntime,
} from "@/entrypoints/offscreen/chapter-processing"
import { OffscreenSeriesResolver } from "@/entrypoints/offscreen/series-resolver"
import type { RuntimeMessage } from "@/src/runtime/runtime-message-contracts"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { backgroundSiteAdapter as dm5Background } from "@/src/site-integrations/animemangahouse/background-runtime"
import { backgroundSiteAdapter as mangabzBackground } from "@/src/site-integrations/mangabz/background-runtime"
import { configureSeriesDataOffscreenLifecycle } from "@/src/runtime/resolve-series-data-offscreen"
import { offscreenSiteAdapter as dm5 } from "@/src/site-integrations/animemangahouse/offscreen-runtime"
import { offscreenSiteAdapter as mangabz } from "@/src/site-integrations/mangabz/offscreen-runtime"
import dm5Fixture from "@/tests/fixtures/site-integrations/animemangahouse/contract.json"
import mangabzFixture from "@/tests/fixtures/site-integrations/mangabz/contract.json"
import { SHONEN_JUMP_PLUS_SCRAMBLED_PNG } from "@/tests/e2e/fixtures/mock-data/site-integrations/shonenjumpplus/scrambled-image-fixture"

const services: RateLimitService[] = []
afterEach(() => {
  services.splice(0).forEach((service) => service.cleanupRateLimiters())
  vi.unstubAllGlobals()
})

describe.each([
  {
    id: "animemangahouse",
    adapter: dm5,
    prefix: "DM5",
    origin: "https://www.dm5.com",
    cid: "521974",
    mid: "33991",
    endpoint: "chapterfun.ashx",
    signed: dm5Fixture.data.signedResponse,
  },
  {
    id: "mangabz",
    adapter: mangabz,
    prefix: "MANGABZ",
    origin: "https://www.mangabz.com",
    cid: "29397",
    mid: "139",
    endpoint: "chapterimage.ashx",
    signed: mangabzFixture.data.signedResponse,
  },
])("$id chapter production", (site) => {
  it("preserves series identity across the background and offscreen message boundary", async () => {
    const rateLimitService = new RateLimitService({
      resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
    })
    services.push(rateLimitService)
    const seriesUrl =
      site.origin +
      (site.id === "animemangahouse" ? "/manhua-shanhainizhan1/" : "/139bz/")
    const html = readFileSync(
      `tests/fixtures/site-integrations/${site.id}/series.html`,
      "utf8"
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) => {
        const response = new Response(html, {
          headers: { "content-type": "text/html" },
        })
        Object.defineProperty(response, "url", { value })
        return response
      })
    )
    configureSeriesDataOffscreenLifecycle((operation) =>
      operation({ reserveTransientWork: () => ({ release: () => {} }) })
    )
    const resolver = new OffscreenSeriesResolver(() => rateLimitService)
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: (message: RuntimeMessage) => {
          if (message.type === "GET_SITE_INTEGRATION_ENABLEMENT")
            return Promise.resolve({ success: true, enablement: {} })
          if (message.type === "OFFSCREEN_PARSE_SERIES_HTML")
            return resolver.parseSeriesHtml(message.payload)
          throw new Error(`Unexpected runtime message ${message.type}`)
        },
      },
    })
    const adapter =
      site.id === "animemangahouse" ? dm5Background : mangabzBackground
    const result = await adapter.background.series!.resolveSeriesData({
      seriesUrl,
      rateLimitService,
      siteIntegrationSettingsReader: {
        getAll: async () => ({}),
        getForSite: async () => ({}),
      },
    })
    expect(result.seriesId).toBe(site.mid)
    expect(result.seriesMetadata?.title).toBe(
      site.id === "animemangahouse" ? "山海逆战" : "海賊王"
    )
    expect(result.chapterList).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: site.cid })])
    )
  })
  it("passes the signed pages through the real serial image pipeline and retains native completion ownership", async () => {
    const rateLimitService = new RateLimitService({
      resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
    })
    services.push(rateLimitService)
    const liveResourceLedger = new OffscreenLiveResourceLedger()
    const handoffs: Array<{ filename: string; size: number }> = []
    const runtime: ChapterProcessingRuntime = {
      rateLimitService,
      liveResourceLedger,
      beginFsaWrite: async () => {},
      resolveWritableDownloadRoot: async () => {
        throw new Error("Unexpected folder output")
      },
      withImageRetries: (fn) => fn(),
      requestBrowserBlobDownload: async ({ filename, blob }) => {
        handoffs.push({ filename, size: blob.size })
        return { success: true, disposition: "tracked", phase: "waiting" }
      },
      getMemoryStats: () => null,
    }
    const settings = {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, site.id),
      rateLimitSettings: {
        image: { concurrency: 1, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 0 },
      },
    }
    const chapter = {
      id: site.cid,
      url: `${site.origin}/m${site.cid}/`,
      title: "Chapter",
      resolvedPath: "chapter",
      comicInfo: {},
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) => {
        const url = new URL(value)
        const signed = url.pathname.endsWith(site.endpoint)
        const reader = url.origin === site.origin && !signed
        const body = reader
          ? `<meta charset="utf-8"><script>var ${site.prefix}_CID=${site.cid};var ${site.prefix}_MID=${site.mid};var ${site.prefix}_IMAGE_COUNT=2;var ${site.prefix}_VIEWSIGN="test";var ${site.prefix}_VIEWSIGN_DT="2026-10-25 00:00:00";</script>`
          : signed
            ? site.signed
            : new Uint8Array(SHONEN_JUMP_PLUS_SCRAMBLED_PNG)
        const response = new Response(body, {
          headers: {
            "content-type": reader
              ? "text/html"
              : signed
                ? "application/javascript"
                : "image/png",
          },
        })
        Object.defineProperty(response, "url", { value })
        return response
      })
    )
    const plan = await site.adapter.offscreen.chapter.resolveChapterPlan(
      chapter,
      {
        runtime: {
          rateLimitService,
          rateLimitSettings: settings.rateLimitSettings,
        },
      }
    )
    const outcome = await processNoneFormatChapter(runtime, {
      opts: {
        taskId: "task",
        jobId: "job",
        attempt: 1,
        chapter,
        seriesTitle: "Series",
        format: "none",
        includeComicInfo: false,
        downloadMode: "browser",
        comicInfoVersion: "2.0",
        onProgress: async () => {},
        onArchiveProgress: async () => {},
        abortSignal: new AbortController().signal,
        settingsSnapshot: settings,
      },
      urls: plan.imageUrls,
      integrationId: site.id,
      downloadImage: site.adapter.offscreen.chapter.downloadImage,
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })
    expect(outcome).toMatchObject({
      status: "completed",
      outputsRequested: 2,
      outputsCommitted: 0,
      outputsFailedBeforeHandoff: 0,
    })
    expect(handoffs).toEqual([
      {
        filename: "chapter/001.png",
        size: SHONEN_JUMP_PLUS_SCRAMBLED_PNG.length,
      },
      {
        filename: "chapter/002.png",
        size: SHONEN_JUMP_PLUS_SCRAMBLED_PNG.length,
      },
    ])
    expect(liveResourceLedger.getUsedBytes()).toBe(0)
  })
})
