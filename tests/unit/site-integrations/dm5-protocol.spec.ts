// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { offscreenSiteAdapter as dm5 } from "@/src/site-integrations/animemangahouse/offscreen-runtime"
import { offscreenSiteAdapter as mangabz } from "@/src/site-integrations/mangabz/offscreen-runtime"

import dm5Fixture from "@/tests/fixtures/site-integrations/animemangahouse/contract.json"
import mangabzFixture from "@/tests/fixtures/site-integrations/mangabz/contract.json"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { buildOptionalComicInfoXml } from "@/entrypoints/offscreen/chapter-processing-helpers"

afterEach(() => vi.unstubAllGlobals())

import { matchUrl } from "@/src/site-integrations/url-matcher"

const documents = [
  {
    adapter: dm5,
    url: "https://www.dm5.com/manhua-series/",
    html: `<script>var DM5_COMIC_MID=33991;var DM5_COMIC_SORT=1;</script>
      <div class="banner_detail_form"><div class="info"><p class="title">山海逆战<span>8.2分</span></p><p class="subtitle"><a>邱福龙</a></p><p class="content">Introduction</p></div></div>
      <div id="chapterlistload"><a href="/m521974/"><p class="title">第1回 開始<span>（13P）</span></p><span class="icon-coin"></span></a><a href="/m521975/"><p class="title">第2回</p><span class="icon-coin"></span><span class="detail-lock"></span></a><a href="/m521974/">duplicate</a></div>
      <a href="/m9999/">Advertisement</a>`,
    ids: ["521974", "521975"],
    title: "山海逆战",
    author: "邱福龙",
  },
  {
    adapter: mangabz,
    url: "https://www.mangabz.com/139bz/",
    html: `<script>var MANGABZ_COMIC_MID=139;var MANGABZ_COMIC_SORT=2;</script>
      <p class="detail-info-title">海賊王</p><p class="detail-info-tip"><a>尾田榮一郎</a></p>
      <div id="chapterlistload"><a href="/m200/" class="detail-list-form-item">第2話 Two<span>（2P）</span></a><a href="/m100/" class="detail-list-form-item">第1話 One<span>（2P）</span></a></div>`,
    ids: ["100", "200"],
    title: "海賊王",
    author: "尾田榮一郎",
  },
]

describe("signed-reader series resolution", () => {
  it.each(documents)(
    "resolves $url in reading order and excludes unrelated links",
    async ({ adapter, url, html, ids, title, author }) => {
      const document = new DOMParser().parseFromString(html, "text/html")
      const resolve = adapter.offscreen.series?.resolveSeriesData
      expect(resolve).toBeTypeOf("function")
      const result = await resolve!({
        requestId: "series",
        seriesUrl: url,
        html,
        document,
        rateLimitService: {} as never,
      })
      expect(result.seriesMetadata?.title).toBe(title)
      expect(result.seriesMetadata?.author).toBe(author)
      const chapters = result.chapterList
      expect(Array.isArray(chapters)).toBe(true)
      if (!Array.isArray(chapters)) throw new Error("chapter list missing")
      expect(chapters.map((chapter) => chapter.id)).toEqual(ids)
      if (url.includes("dm5.com")) {
        expect(chapters[0]?.locked).toBe(false)
        expect(chapters[1]?.locked).toBe(true)
      }
    }
  )
})

describe("captured signed-reader catalogs", () => {
  it.each([
    {
      adapter: dm5,
      provider: "animemangahouse",
      url: "https://www.dm5.com/manhua-shanhainizhan1/",
      title: "山海逆战",
      author: "邱福龙, 瑛麒动漫",
      count: 1022,
      firstIds: ["521974", "521971", "521976"],
      lastId: "1419280",
    },
    {
      adapter: mangabz,
      provider: "mangabz",
      url: "https://www.mangabz.com/139bz/",
      title: "海賊王",
      author: "尾田榮一郎",
      count: 978,
      firstIds: ["29397", "29398", "13866"],
      lastId: "418076",
    },
  ])(
    "resolves $provider metadata and the complete rendered catalog",
    async (site) => {
      const html = readFileSync(
        `tests/fixtures/site-integrations/${site.provider}/series.html`,
        "utf8"
      )
      const result = await site.adapter.offscreen.series!.resolveSeriesData({
        requestId: "captured-series",
        seriesUrl: site.url,
        html,
        document: new DOMParser().parseFromString(html, "text/html"),
        rateLimitService: {} as never,
      })
      expect(result.seriesMetadata).toMatchObject({
        title: site.title,
        author: site.author,
        genres:
          site.provider === "animemangahouse" ? ["热血", "神鬼"] : ["熱血"],
      })
      expect(result.seriesMetadata?.description).not.toMatch(
        /展开|折叠|展開|折疊/
      )
      const chapters = result.chapterList
      if (!Array.isArray(chapters)) throw new Error("chapter list missing")
      const xml = buildOptionalComicInfoXml({
        includeComicInfo: true,
        chapter: chapters[0],
        seriesTitle: site.title,
        seriesMetadata: result.seriesMetadata,
        pageCount: 13,
        comicInfoVersion: "2.0",
        hasCoverImage: false,
      })
      expect(xml).not.toBeNull()
      const comicInfo = new DOMParser().parseFromString(xml!, "text/xml")
      expect(comicInfo.querySelector("Writer")?.textContent).toBe(site.author)
      expect(comicInfo.querySelector("Genre")?.textContent).toBe(
        site.provider === "animemangahouse" ? "热血, 神鬼" : "熱血"
      )
      const summary = comicInfo.querySelector("Summary")?.textContent
      expect(summary).not.toMatch(/展开|折叠|展開|折疊/)
      if (site.provider === "animemangahouse") {
        expect(summary).toContain("集团。。少年勾徹")
        expect(summary).toMatch(/改变了少年和整个世界的命运…$/)
      } else {
        expect(summary).toContain("ONEE PIECE")
        expect(summary).toMatch(/以成為海賊王為目標的冒險旅程$/)
      }
      expect(chapters).toHaveLength(site.count)
      expect(chapters.slice(0, 3).map((chapter) => chapter.id)).toEqual(
        site.firstIds
      )
      expect(chapters.at(-1)?.id).toBe(site.lastId)
      if (site.provider === "animemangahouse") {
        expect(chapters[0]).toMatchObject({
          title: "第1回 第壹回（上）",
          locked: false,
        })
        expect(
          chapters.find((chapter) => chapter.id === "522024")
        ).toMatchObject({ title: "第44回 鳳凰重生（上）", locked: true })
      } else {
        expect(chapters[0]?.title).toBe("俘虜X海賊")
        expect(chapters.slice(-7).map((chapter) => chapter.id)).toEqual([
          "527598",
          "418982",
          "413768",
          "418981",
          "415977",
          "417055",
          "418076",
        ])
        expect(chapters.find((chapter) => chapter.id === "490313")?.title).toBe(
          "第1182話 嘩嘩"
        )
      }
    }
  )
})

const runtime = {
  rateLimitService: {
    scheduleForIntegrationScope: async (
      _id: string,
      _scope: string,
      task: () => Promise<unknown>
    ) => task(),
  } as unknown as RateLimitService,
  rateLimitSettings: {
    image: { concurrency: 1, delayMs: 0 },
    chapter: { concurrency: 1, delayMs: 0 },
  },
}
function response(url: string, body: string, type: string): Response {
  const result = new Response(body, {
    headers: { "content-type": type + "; charset=utf-8" },
  })
  Object.defineProperty(result, "url", { value: url })
  return result
}
const readers = [
  {
    adapter: dm5,
    id: "animemangahouse",
    prefix: "DM5",
    origin: "https://www.dm5.com",
    chapterId: "521974",
    mid: "33991",
    endpoint: "chapterfun.ashx",
    body: dm5Fixture.data.signedResponse,
    expected: [
      "https://manhua1032zjcdn26.cdndm5.com/34/33991/521974/2_4711.jpg?cid=521974&key=synthetic-signature",
      "https://manhua1032zjcdn26.cdndm5.com/34/33991/521974/3_3844.jpg?cid=521974&key=synthetic-signature",
    ],
  },
  {
    adapter: mangabz,
    id: "mangabz",
    prefix: "MANGABZ",
    origin: "https://www.mangabz.com",
    chapterId: "29397",
    mid: "139",
    endpoint: "chapterimage.ashx",
    body: mangabzFixture.data.signedResponse,
    expected: [
      "https://image.mangabz.com/1/139/29397/1_5790.jpg?cid=29397&key=synthetic-signature&uk=",
      "https://image.mangabz.com/1/139/29397/2_7019.jpg?cid=29397&key=synthetic-signature&uk=",
    ],
  },
]
describe.each(readers)("$id signed chapter plan", (fixture) => {
  const chapter = {
    id: fixture.chapterId,
    url: `${fixture.origin}/m${fixture.chapterId}/`,
  }
  const html = `<script>var ${fixture.prefix}_CID=${fixture.chapterId};var ${fixture.prefix}_MID=${fixture.mid};var ${fixture.prefix}_IMAGE_COUNT=2;var ${fixture.prefix}_VIEWSIGN="synthetic-view-sign";var ${fixture.prefix}_VIEWSIGN_DT="2026-10-25 00:00:00";</script>`
  beforeEach(() => vi.restoreAllMocks())
  it("resolves the signed pages in order without executing site JavaScript", async () => {
    const requests: URL[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) => {
        const url = new URL(value)
        requests.push(url)
        return response(
          value,
          url.pathname.endsWith(fixture.endpoint)
            ? fixture.body + ';throw new Error("site code must never execute");'
            : html,
          url.pathname.endsWith(fixture.endpoint)
            ? "application/javascript"
            : "text/html"
        )
      })
    )
    const plan = await fixture.adapter.offscreen.chapter.resolveChapterPlan(
      chapter,
      { runtime }
    )
    expect(plan.imageUrls).toEqual(fixture.expected)
    const signed = requests.find((url) =>
      url.pathname.endsWith(fixture.endpoint)
    )!
    expect(signed.searchParams.get("_cid")).toBe(fixture.chapterId)
    expect(signed.searchParams.get("_mid")).toBe(fixture.mid)
    expect(signed.searchParams.get("page")).toBe("1")
    expect(signed.searchParams.get("_sign")).toBe("synthetic-view-sign")
  })
  it("rejects the explicit error-image channel even when the response succeeds", async () => {
    const errorBody = fixture.body.replace(
      /\}\('(?=[a-z0-9])/i,
      "}('var d_c=[];"
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) =>
        response(
          value,
          value.includes(fixture.endpoint) ? errorBody : html,
          value.includes(fixture.endpoint)
            ? "application/javascript"
            : "text/html"
        )
      )
    )
    await expect(
      fixture.adapter.offscreen.chapter.resolveChapterPlan(chapter, { runtime })
    ).rejects.toThrow(/unavailable|error.image/i)
  })
  it("rejects a reader identity that does not match the selected chapter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) =>
        response(
          value,
          html.replace(
            `${fixture.prefix}_CID=${fixture.chapterId}`,
            `${fixture.prefix}_CID=999`
          ),
          "text/html"
        )
      )
    )
    await expect(
      fixture.adapter.offscreen.chapter.resolveChapterPlan(chapter, { runtime })
    ).rejects.toThrow(/identity/i)
  })
  it.each([0, 2001])(
    "rejects unavailable or oversized page count %s before image requests",
    async (count) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (value: string) =>
          response(
            value,
            html.replace(
              `${fixture.prefix}_IMAGE_COUNT=2`,
              `${fixture.prefix}_IMAGE_COUNT=${count}`
            ),
            "text/html"
          )
        )
      )
      await expect(
        fixture.adapter.offscreen.chapter.resolveChapterPlan(chapter, {
          runtime,
        })
      ).rejects.toThrow(/page count/i)
    }
  )
  it("rejects a signed response that points outside the declared image hosts", async () => {
    const untrusted = fixture.body
      .replace("|cdndm5|", "|outside|")
      .replace("|mangabz|", "|outside|")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) =>
        response(
          value,
          value.includes(fixture.endpoint) ? untrusted : html,
          value.includes(fixture.endpoint)
            ? "application/javascript"
            : "text/html"
        )
      )
    )
    await expect(
      fixture.adapter.offscreen.chapter.resolveChapterPlan(chapter, { runtime })
    ).rejects.toThrow(/origin/i)
  })
  it("surfaces an empty successful viewer response as failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) =>
        response(
          value,
          value.includes(fixture.endpoint) ? "" : html,
          value.includes(fixture.endpoint)
            ? "application/javascript"
            : "text/html"
        )
      )
    )
    await expect(
      fixture.adapter.offscreen.chapter.resolveChapterPlan(chapter, { runtime })
    ).rejects.toThrow(/format/i)
  })
})

describe("signed-reader public series recognition", () => {
  it.each([
    ["https://www.dm5.com/manhua-shanhainizhan1/", "animemangahouse"],
    ["https://www.mangabz.com/139bz/", "mangabz"],
  ])(
    "recognizes %s through the production URL matcher",
    (url, integrationId) => {
      expect(matchUrl(url)).toEqual({ integrationId, role: "series" })
    }
  )
})
