// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import fixture from "@/tests/fixtures/site-integrations/boylove/contract.json"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { offscreenSiteAdapter } from "@/src/site-integrations/boylove/offscreen-runtime"

const origin = "https://boylove.cc"
const seriesUrl = `${origin}/home/book/index/id/34260`
// Small derived vectors keep malformed-input tests focused on one failure.
const { seriesHtml, readerHtml } = fixture.data
const capturedSeriesHtml = readFileSync(
  resolve("tests/fixtures/site-integrations/boylove/series.html"),
  "utf8"
)
const capturedReaderHtml = readFileSync(
  resolve("tests/fixtures/site-integrations/boylove/reader.html"),
  "utf8"
)
const secondarySeriesHtml = readFileSync(
  resolve("tests/fixtures/site-integrations/boylove/series-shagua-tiandi.html"),
  "utf8"
)
const secondaryReaderHtml = readFileSync(
  resolve("tests/fixtures/site-integrations/boylove/reader-shagua-tiandi.html"),
  "utf8"
)

function parseDocument(html: string) {
  return new DOMParser().parseFromString(html, "text/html")
}

const rateLimitService = {
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
  scheduleForIntegrationScope: async <T>(
    _id: string,
    _scope: string,
    task: () => Promise<T>
  ) => task(),
  cleanupRateLimiters: () => {},
} as never

describe("BoyLove captured pages", () => {
  it("resolves the complete captured catalog and original work metadata", async () => {
    const result =
      await offscreenSiteAdapter.offscreen.series!.resolveSeriesData({
        requestId: "captured-series",
        seriesUrl: `${origin}/home/book/index/id/32391`,
        html: capturedSeriesHtml,
        document: parseDocument(capturedSeriesHtml),
        rateLimitService,
      })
    expect(result.seriesMetadata).toMatchObject({
      title: "猎人只想安静生活【台版】",
      author: "103ligongMAGMA",
      coverUrl:
        "https://img.boylove.cc/bookimages/bakamh_62ae93c8c68c/cover.jpg",
    })
    const chapters = Array.isArray(result.chapterList)
      ? result.chapterList
      : result.chapterList?.chapters
    expect(chapters).toHaveLength(68)
    expect(chapters?.[0]).toMatchObject({ id: "2671926", title: "第1话" })
    expect(chapters?.at(-1)).toMatchObject({ id: "2741402", title: "第67话" })
  })

  it("retains all 35 numbered pages and their captured reconstruction dimensions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => readerResponse(capturedReaderHtml))
    )
    const plan =
      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        { id: "2671926", url: `${origin}/home/book/capter/id/2671926` },
        chapterInput
      )
    expect(plan.imageUrls).toHaveLength(35)
    expect(new URL(plan.imageUrls[0])).toMatchObject({
      pathname:
        "/bookimages/bakamh_62ae93c8c68c/J2xFNk6AmytkQY8BhJvA00bIxaXRxKdsYrW.webp",
      hash: "#boylove=13,650,2600",
    })
    expect(new URL(plan.imageUrls.at(-1)!)).toMatchObject({
      pathname:
        "/bookimages/bakamh_62ae93c8c68c/PJmbFKlZXOmM5SWIViXIIE3SkjggsKbbYD2.webp",
      hash: "#boylove=13,650,2324.765625",
    })
  })

  it("continues to resolve the secondary nine-chapter catalog and 88-page reader", async () => {
    const result =
      await offscreenSiteAdapter.offscreen.series!.resolveSeriesData({
        requestId: "secondary-series",
        seriesUrl,
        html: secondarySeriesHtml,
        document: parseDocument(secondarySeriesHtml),
        rateLimitService,
      })
    const chapters = Array.isArray(result.chapterList)
      ? result.chapterList
      : result.chapterList?.chapters
    expect(chapters).toHaveLength(9)
    expect(chapters?.[0]).toMatchObject({ id: "2699104", title: "第1话" })
    expect(result.seriesMetadata).toMatchObject({
      description: "바보 천지 平台：ridibooks",
      communityRating: 4.98,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => readerResponse(secondaryReaderHtml))
    )
    const plan =
      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        { id: "2699104", url: chapterUrl },
        chapterInput
      )
    expect(plan.imageUrls).toHaveLength(88)
    expect(new URL(plan.imageUrls.at(-1)!)).toMatchObject({
      pathname: "/bookimages/20260923/cy2ZupwezL6N4HsF9rf4Maz5CQ49ofU24X4.webp",
      hash: "#boylove=13,650,728.93553223388",
    })
  })
})

describe("BoyLove derived series vectors", () => {
  it("resolves the embedded chapter catalog in site order and excludes unrelated links", async () => {
    const result =
      await offscreenSiteAdapter.offscreen.series!.resolveSeriesData({
        requestId: "series",
        seriesUrl,
        html: seriesHtml,
        document: parseDocument(
          `${seriesHtml}<a href="/home/book/capter/id/999">Advertisement</a>`
        ),
        rateLimitService,
      })
    expect(result.seriesMetadata).toMatchObject({
      title: "傻瓜天地",
      author: "하리보",
      language: "zh",
      coverUrl: "https://img.boylove.cc/bookimages/img/cover.webp",
    })
    expect(result.chapterList).toMatchObject({
      chapters: [
        {
          id: "2699104",
          title: "第1话",
          url: `${origin}/home/book/capter/id/2699104`,
        },
        {
          id: "2699597",
          title: "第2话",
          url: `${origin}/home/book/capter/id/2699597`,
        },
      ],
    })
  })
})

const chapterUrl = `${origin}/home/book/capter/id/2699104`

function readerResponse(html: string) {
  const response = new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
  Object.defineProperty(response, "url", { value: chapterUrl })
  return response
}

const chapterInput = {
  runtime: {
    rateLimitService,
    rateLimitSettings: {
      image: { concurrency: 1, delayMs: 0 },
      chapter: { concurrency: 1, delayMs: 0 },
    },
  },
}

afterEach(() => vi.unstubAllGlobals())

describe("BoyLove chapter reader", () => {
  it("produces the complete ordered reader pages with reconstruction data and excludes advertisements", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => readerResponse(readerHtml))
    )
    const plan =
      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        { id: "2699104", url: chapterUrl },
        chapterInput
      )
    expect(plan.imageUrls).toHaveLength(2)
    expect(plan.imageUrls.map((value) => new URL(value).pathname)).toEqual([
      "/bookimages/page1.webp",
      "/bookimages/credits.webp",
    ])
    expect(new URL(plan.imageUrls[0]).hash).toBe("#boylove=13,650,1300")
  })
})

describe("BoyLove trailing reader advertisement", () => {
  it("excludes the unnumbered reader-image link after the required chapter pages", async () => {
    const html = readerHtml.replace(
      "</section>",
      '<div class="reader-cartoon-image"><a href="https://fuhouse.city/example"><img src="https://img.boylove.cc/static/images/mh_btn_link_img.png?v=20230213" data-original=""></a><div class="preview"></div></div></section>'
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => readerResponse(html))
    )
    const plan =
      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        { id: "2699104", url: chapterUrl },
        chapterInput
      )
    expect(plan.imageUrls.map((value) => new URL(value).pathname)).toEqual([
      "/bookimages/page1.webp",
      "/bookimages/credits.webp",
    ])
  })
})

describe("BoyLove protocol failures", () => {
  it.each([
    ["unavailable reader", "<p>This chapter is unavailable</p>"],
    ["missing page", readerHtml.replace('data-page="2"', 'data-page="3"')],
    [
      "missing reconstruction data",
      readerHtml.replace("randomClass = 13", "randomClass = 0"),
    ],
    [
      "loading placeholder",
      readerHtml.replaceAll(
        "https://img.boylove.cc/bookimages/page1.webp?w=650_1300",
        "https://img.boylove.cc/static/images/load.png"
      ),
    ],
    [
      "untrusted CDN",
      readerHtml.replaceAll(
        "https://img.boylove.cc/bookimages/page1.webp?w=650_1300",
        "https://untrusted.example/bookimages/page1.webp"
      ),
    ],
  ])(
    "rejects %s instead of emitting incomplete chapter output",
    async (_name, html) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => readerResponse(html))
      )
      await expect(
        offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          { id: "2699104", url: chapterUrl },
          chapterInput
        )
      ).rejects.toThrow()
    }
  )

  it("reports a missing catalog", async () => {
    await expect(
      offscreenSiteAdapter.offscreen.series!.resolveSeriesData({
        requestId: "series",
        seriesUrl,
        html: "",
        document: parseDocument(
          '<div class="stui-content__detail"><h1>Series</h1></div>'
        ),
        rateLimitService,
      })
    ).rejects.toThrow("catalog")
  })

  it("releases image ownership when a CDN response does not match the reader dimensions", async () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    const view = new DataView(bytes.buffer)
    view.setUint32(16, 2)
    view.setUint32(20, 2)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response = new Response(bytes, {
          headers: { "content-type": "image/png" },
        })
        Object.defineProperty(response, "url", {
          value: "https://img.boylove.cc/bookimages/page1.png",
        })
        return response
      })
    )
    const ledger = new OffscreenLiveResourceLedger()
    await expect(
      offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://img.boylove.cc/bookimages/page1.png#boylove=13,650,1300",
        { runtime: chapterInput.runtime, liveResourceLedger: ledger }
      )
    ).rejects.toThrow("dimensions")
    expect(ledger.getUsedBytes()).toBe(0)
  })
})
