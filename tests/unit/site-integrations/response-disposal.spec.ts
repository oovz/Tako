import { afterEach, describe, expect, it, vi } from "vitest"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { resolveComicNettaiChapterImageUrls } from "@/src/site-integrations/comictropics/chapter-api"
import { loadComicNettaiPaginationDocument } from "@/src/site-integrations/comictropics/series-dom"
import { backgroundSiteAdapter as comicNettai } from "@/src/site-integrations/comictropics/background-runtime"
import { resolveManhuaguiChapterImageUrls } from "@/src/site-integrations/readmanga/chapter-api"
import { fetchReaderConfig } from "@/src/site-integrations/readmanga/reader-config"
import { backgroundSiteAdapter as manhuagui } from "@/src/site-integrations/readmanga/background-runtime"
import { backgroundSiteAdapter as jumpBackground } from "@/src/site-integrations/shonenjumpplus/background-runtime"
import { offscreenSiteAdapter as jumpOffscreen } from "@/src/site-integrations/shonenjumpplus/offscreen-runtime"
import {
  fetchPaginationInfo,
  fetchProducts,
} from "@/src/site-integrations/shonenjumpplus/series-api"
import { resolvePixivChapterImageUrls } from "@/src/site-integrations/pixiv-comic/chapter-api"
import {
  fetchPixivChapterList,
  fetchPixivSeriesMetadata,
} from "@/src/site-integrations/pixiv-comic/series-api"
import {
  fetchMangaMetadata,
  fetchMangaStatistics,
  fetchChapterFeed,
  fetchAtHomeServer,
} from "@/src/site-integrations/mangadex/api"
import { downloadMangadexChapterImage } from "@/src/site-integrations/mangadex/chapter-api"

const rateLimitService = {
  scheduleForIntegrationScope: async <T>(
    _id: string,
    _scope: string,
    operation: () => Promise<T>
  ) => operation(),
} as RateLimitService
const runtime = {
  rateLimitService,
  rateLimitSettings: {
    chapter: { concurrency: 1, delayMs: 0 },
    image: { concurrency: 1, delayMs: 0 },
  },
}
const seriesInput = (seriesUrl: string) => ({
  seriesUrl,
  rateLimitService,
  siteIntegrationSettingsReader: {
    getAll: async () => ({}),
    getForSite: async () => ({}),
  },
})
const nettaiChapter = {
  id: "1",
  url: "https://www.comicnettai.com/publus/viewer.html?cid=1",
}
const jumpChapter = { id: "123", url: "https://shonenjumpplus.com/episode/123" }
const pixivChapter = {
  id: "123",
  url: "https://comic.pixiv.net/viewer/stories/123",
}
const pixivContext = { rateLimitService }
const pixivHomepage = () =>
  new Response(
    '<script src="/_next/static/build-id/_buildManifest.js"></script>',
    { headers: { "content-type": "text/html; charset=utf-8" } }
  )
const pixivSalt = () =>
  Response.json({
    pageProps: { salt: "salt", story: { reading_episode: { pages: [] } } },
  })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

type RejectedRequest = {
  name: string
  run: () => Promise<unknown>
  before?: (() => Response)[]
}
const rejectedRequests: RejectedRequest[] = [
  {
    name: "Comic Nettai viewer",
    run: () =>
      resolveComicNettaiChapterImageUrls(nettaiChapter, rateLimitService),
  },
  {
    name: "Comic Nettai configuration",
    before: [
      () =>
        Response.json({
          status: 200,
          url: "https://cdn.comicnettai.com/book/",
        }),
    ],
    run: () =>
      resolveComicNettaiChapterImageUrls(nettaiChapter, rateLimitService),
  },
  {
    name: "Comic Nettai series",
    run: () =>
      comicNettai.background.series!.resolveSeriesData(
        seriesInput("https://www.comicnettai.com/book/9")
      ),
  },
  {
    name: "Comic Nettai pagination",
    run: () =>
      loadComicNettaiPaginationDocument(
        "https://www.comicnettai.com/book/9?page=2",
        rateLimitService
      ),
  },
  {
    name: "Manhuagui chapter",
    run: () =>
      resolveManhuaguiChapterImageUrls(
        { id: "100", url: "https://www.manhuagui.com/comic/9/100.html" },
        rateLimitService
      ),
  },
  {
    name: "Manhuagui series",
    run: () =>
      manhuagui.background.series!.resolveSeriesData(
        seriesInput("https://www.manhuagui.com/comic/9/")
      ),
  },
  {
    name: "Manhuagui configuration",
    run: () =>
      fetchReaderConfig(
        '<script src="https://cf.mhgui.com/scripts/config_16.js"></script>',
        rateLimitService
      ),
  },
  {
    name: "Shonen Jump+ series",
    run: () =>
      jumpBackground.background.series!.resolveSeriesData(
        seriesInput(jumpChapter.url)
      ),
  },
  {
    name: "Shonen Jump+ chapter",
    run: () =>
      jumpOffscreen.offscreen.chapter.resolveChapterPlan(jumpChapter, {
        runtime,
      }),
  },
  {
    name: "Shonen Jump+ pagination",
    run: () => fetchPaginationInfo("1", "123", rateLimitService),
  },
  {
    name: "Shonen Jump+ products",
    run: () => fetchProducts("1", 0, 10, rateLimitService),
  },
  {
    name: "Pixiv Comic work",
    run: () => fetchPixivSeriesMetadata("9", rateLimitService),
  },
  {
    name: "Pixiv Comic episodes",
    run: () => fetchPixivChapterList("9", rateLimitService),
  },
  {
    name: "Pixiv Comic homepage",
    run: () => resolvePixivChapterImageUrls(pixivChapter, pixivContext),
  },
  {
    name: "Pixiv Comic salt",
    before: [pixivHomepage],
    run: () => resolvePixivChapterImageUrls(pixivChapter, pixivContext),
  },
  {
    name: "Pixiv Comic pages",
    before: [pixivHomepage, pixivSalt],
    run: () => resolvePixivChapterImageUrls(pixivChapter, pixivContext),
  },
  {
    name: "MangaDex metadata",
    run: () => fetchMangaMetadata("9", rateLimitService, "interactive"),
  },
  {
    name: "MangaDex statistics",
    run: () => fetchMangaStatistics("9", rateLimitService, "interactive"),
  },
  {
    name: "MangaDex feed",
    run: () =>
      fetchChapterFeed("9", rateLimitService, {}, 0, 10, "interactive"),
  },
  {
    name: "MangaDex at-home server",
    run: () => fetchAtHomeServer("123", rateLimitService),
  },
]

describe("discarded site integration responses", () => {
  it.each(rejectedRequests)(
    "releases a rejected $name response and preserves its error",
    async ({ run, before = [] }) => {
      const cancel = vi.fn(() => Promise.reject(new Error("cleanup failed")))
      const fetchMock = vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            status: 400,
            statusText: "Bad Request",
          })
      )
      for (const response of before) fetchMock.mockResolvedValueOnce(response())
      vi.stubGlobal("fetch", fetchMock)
      await expect(run()).rejects.toMatchObject({ status: 400 })
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
      expect(fetchMock).toHaveBeenCalledTimes(before.length + 1)
    }
  )
})

describe("MangaDex response ownership", () => {
  it("releases a response rejected by the API JSON parser", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error("cleanup failed")))
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            headers: { "content-type": "application/problem+json" },
          })
      )
    )
    await expect(
      fetchMangaStatistics("9", rateLimitService, "interactive")
    ).rejects.toThrow("MangaDex API returned non-JSON response")
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it.each([429, 503])(
    "releases HTTP %s before the retry wait and consumes the successful retry",
    async (status) => {
      vi.useFakeTimers()
      const cancel = vi.fn(() => new Promise<void>(() => {}))
      const successCancel = vi.fn()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(new ReadableStream({ cancel }), { status })
        )
        .mockResolvedValueOnce(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    '{"statistics":{"9":{"rating":{"average":8}}}}'
                  )
                )
                controller.close()
              },
              cancel: successCancel,
            }),
            { headers: { "content-type": "application/json" } }
          )
        )
      vi.stubGlobal("fetch", fetchMock)
      const result = fetchMangaStatistics("9", rateLimitService)
      await vi.advanceTimersByTimeAsync(0)
      expect(cancel).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(4999)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await expect(result).resolves.toEqual({
        statistics: { "9": { rating: { average: 8 } } },
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(successCancel).not.toHaveBeenCalled()
    }
  )

  it("preserves cancellation during the retry wait after releasing the response", async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => Promise.reject(new Error("cleanup failed")))
    const fetchMock = vi.fn(
      async () => new Response(new ReadableStream({ cancel }), { status: 429 })
    )
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    const result = fetchMangaStatistics(
      "9",
      rateLimitService,
      "resilient",
      controller.signal
    )
    const rejected = expect(result).rejects.toThrow(/abort/i)
    await vi.advanceTimersByTimeAsync(0)
    expect(cancel).toHaveBeenCalledOnce()
    controller.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([200, 400])(
    "releases an ignored HTTP %s report after a successful image",
    async (status) => {
      const cancel = vi.fn(() => new Promise<void>(() => {}))
      const imageCancel = vi.fn()
      const bytes = new Uint8Array(24)
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      bytes.set([0x49, 0x48, 0x44, 0x52], 12)
      const view = new DataView(bytes.buffer)
      view.setUint32(16, 1)
      view.setUint32(20, 1)
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(bytes)
                controller.close()
              },
              cancel: imageCancel,
            }),
            { headers: { "content-type": "image/png" } }
          )
        )
        .mockResolvedValueOnce(
          new Response(new ReadableStream({ cancel }), {
            status,
            headers: { "content-type": "application/json" },
          })
        )
      vi.stubGlobal("fetch", fetchMock)
      const ledger = new OffscreenLiveResourceLedger()
      const image = await downloadMangadexChapterImage(
        "https://node.mangadex.network/data/hash/page.png",
        {
          runtime,
          liveResourceLedger: ledger,
        }
      )
      expect(new Uint8Array(image.data)).toEqual(bytes)
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
      expect(imageCancel).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1][0]).toBe(
        "https://api.mangadex.network/report"
      )
      image.liveResourceLease.release()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )

  it("consumes a normal Shonen Jump+ response", async () => {
    const cancel = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('[{"readable_product_id":"123"}]')
                )
                controller.close()
              },
              cancel,
            }),
            { headers: { "content-type": "application/json" } }
          )
      )
    )
    await expect(fetchProducts("1", 0, 10, rateLimitService)).resolves.toEqual([
      { readable_product_id: "123" },
    ])
    expect(cancel).not.toHaveBeenCalled()
  })
})
