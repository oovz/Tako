// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import manganatoFixture from "@/tests/fixtures/site-integrations/manganato/s-class-contract.json"
import mangakakalotFixture from "@/tests/fixtures/site-integrations/mangakakalot/s-class-contract.json"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { offscreenSiteAdapter as manganato } from "@/src/site-integrations/manganato/offscreen-runtime"
import { offscreenSiteAdapter as mangakakalot } from "@/src/site-integrations/mangakakalot/offscreen-runtime"

const policy = { concurrency: 1, delayMs: 0 }
const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => policy,
})
const runtime = {
  rateLimitService,
  rateLimitSettings: { image: policy, chapter: policy },
}
const seriesHtml = `<meta property="og:image" content="https://img-r1.2xstorage.com/thumb/sample.webp"><ul class="manga-info-text"><li><h1>Sample Series</h1></li><li>Author(s) : Sample Author</li><li>Status : Ongoing</li></ul><div id="chapter-list-container" data-comic-slug="sample"></div>`
const chapter = (n: number) => ({
  chapter_name: `Chapter ${n}`,
  chapter_slug: `chapter-${n}`,
  chapter_num: n,
})
function page(
  chapters: ReturnType<typeof chapter>[],
  total = chapters.length,
  offset = 0,
  hasMore = false
) {
  return {
    success: true,
    data: {
      chapters,
      pagination: { total, offset, limit: 50, has_more: hasMore },
    },
  }
}
const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rateLimitService.cleanupRateLimiters()
})

describe.each([
  ["manganato", "manganato.gg", manganato],
  ["mangakakalot", "mangakakalove.com", mangakakalot],
] as const)("%s integration", (_id, domain, adapter) => {
  const seriesUrl = `https://www.${domain}/manga/sample`
  const resolveSeries = () =>
    adapter.offscreen.series!.resolveSeriesData({
      requestId: "series",
      seriesUrl,
      html: seriesHtml,
      document: new DOMParser().parseFromString(seriesHtml, "text/html"),
      rateLimitService,
    })
  it("resolves every chapter page and keeps reader routes on its own site", async () => {
    fetchMock.mockImplementation(async (input) => {
      const offset = new URL(String(input)).searchParams.get("offset")
      return Response.json(
        offset === "0"
          ? page([chapter(2)], 2, 0, true)
          : page([chapter(1)], 2, 1, false)
      )
    })
    const result = await resolveSeries()
    expect(result.seriesMetadata).toMatchObject({
      title: "Sample Series",
      author: "Sample Author",
      language: "en",
    })
    expect(result.chapterList).toEqual([
      expect.objectContaining({
        id: "chapter-1",
        url: `${seriesUrl}/chapter-1`,
      }),
      expect.objectContaining({
        id: "chapter-2",
        url: `${seriesUrl}/chapter-2`,
      }),
    ])
    expect(
      fetchMock.mock.calls.map(([url]) =>
        new URL(String(url)).searchParams.get("offset")
      )
    ).toEqual(["0", "1"])
  })
  it("preserves metadata and reports failed or truncated catalogs", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ success: false }))
    expect(await resolveSeries()).toMatchObject({
      seriesMetadata: { title: "Sample Series" },
      chapterListError: expect.any(String),
    })
    fetchMock.mockResolvedValueOnce(
      Response.json(page([chapter(1)], 2, 0, false))
    )
    expect(await resolveSeries()).toMatchObject({
      chapterListError: expect.stringContaining("incomplete"),
    })
  })
  it("resolves only declared chapter pages and rejects access-error documents", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        '<script>var cdns=["https://img-r1.2xstorage.com/"];var chapterImages=["sample/1/0.webp","sample/1/1.webp"];</script><img src="https://ads.example/banner.jpg">',
        { headers: { "content-type": "text/html; charset=utf-8" } }
      )
    )
    expect(
      await adapter.offscreen.chapter.resolveChapterPlan(
        { id: "chapter-1", url: `${seriesUrl}/chapter-1` },
        { runtime }
      )
    ).toEqual({
      imageUrls: [
        "https://img-r1.2xstorage.com/sample/1/0.webp",
        "https://img-r1.2xstorage.com/sample/1/1.webp",
      ],
    })
    fetchMock.mockResolvedValueOnce(
      new Response("<h1>Chapter unavailable</h1>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    )
    await expect(
      adapter.offscreen.chapter.resolveChapterPlan(
        { id: "chapter-1", url: `${seriesUrl}/chapter-1` },
        { runtime }
      )
    ).rejects.toThrow("unavailable")
    await expect(
      adapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "chapter-1",
          url: "https://attacker.example/manga/sample/chapter-1",
        },
        { runtime }
      )
    ).rejects.toThrow("route")
  })
  it("uses bounded owned image transport and fails HTTP-success HTML responses", async () => {
    const imageBytes = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64"
      )
    )
    fetchMock.mockResolvedValueOnce(
      new Response(imageBytes, { headers: { "content-type": "image/png" } })
    )
    const ledger = new OffscreenLiveResourceLedger()
    const image = await adapter.offscreen.chapter.downloadImage(
      "https://img-r1.2xstorage.com/sample/1/0.png",
      { runtime, liveResourceLedger: ledger }
    )
    expect(image.data.byteLength).toBe(imageBytes.byteLength)
    expect(image.liveResourceLease.bytes).toBeGreaterThan(0)
    image.liveResourceLease.release()
    fetchMock.mockResolvedValueOnce(
      new Response("Unavailable", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    )
    await expect(
      adapter.offscreen.chapter.downloadImage(
        "https://img-r1.2xstorage.com/sample/1/0.png",
        { runtime, liveResourceLedger: ledger }
      )
    ).rejects.toThrow()
  })
  it("rejects a selected chapter whose identity differs from its reader URL", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(manganatoFixture.data.readerHtml, {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    )
    await expect(
      adapter.offscreen.chapter.resolveChapterPlan(
        { id: "chapter-2", url: `${seriesUrl}/chapter-1` },
        { runtime }
      )
    ).rejects.toThrow(/identity/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe.each([
  ["manganato.gg", manganato, manganatoFixture],
  ["mangakakalove.com", mangakakalot, mangakakalotFixture],
] as const)("recorded %s contract", (domain, adapter, fixture) => {
  it("resolves the full observed catalog and ordered reader plan", async () => {
    const { data } = fixture
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.startsWith("/api/"))
        return Response.json(
          data.chapterPages[url.searchParams.get("offset") === "50" ? 1 : 0]
        )
      return new Response(data.readerHtml, {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    })
    const seriesUrl = `https://www.${domain}/manga/${data.seriesSlug}`
    const result = await adapter.offscreen.series!.resolveSeriesData({
      requestId: "recorded",
      seriesUrl,
      html: data.seriesHtml,
      document: new DOMParser().parseFromString(data.seriesHtml, "text/html"),
      rateLimitService,
    })
    expect(result.seriesMetadata?.title).toBe(
      "S-Class Hunter Heals with Monsters"
    )
    expect(result.chapterList).toHaveLength(72)
    const plan = await adapter.offscreen.chapter.resolveChapterPlan(
      { id: data.readerChapter, url: `${seriesUrl}/${data.readerChapter}` },
      { runtime }
    )
    expect(plan.imageUrls).toHaveLength(148)
    expect(plan.imageUrls[0]).toBe(
      "https://img-r1.2xstorage.com/s-class-hunter-heals-with-monsters/57/0.webp"
    )
    expect(plan.imageUrls.at(-1)).toBe(
      "https://img-r1.2xstorage.com/s-class-hunter-heals-with-monsters/57/147.webp"
    )
  })
})

describe.each([
  ["manganato", "manganato.gg", manganato],
  ["mangakakalot", "mangakakalove.com", mangakakalot],
] as const)("captured Hunter X Hunter on %s", (id, domain, adapter) => {
  it("resolves the complete catalog and first reader using the selected site", async () => {
    const fixturePath = `tests/fixtures/site-integrations/${id}`
    const seriesHtml = readFileSync(`${fixturePath}/series-page.html`, "utf8")
    const readerHtml = readFileSync(`${fixturePath}/reader.html`, "utf8")
    const pages = JSON.parse(
      readFileSync(`${fixturePath}/captured-chapters.json`, "utf8")
    ) as {
      data: {
        chapters: {
          chapter_name: string
          chapter_slug: string
          chapter_num: number
        }[]
      }
    }[]
    const chapters = pages.flatMap((page) => page.data.chapters)
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.startsWith("/api/")) {
        const offset = Number(url.searchParams.get("offset"))
        const limit = Number(url.searchParams.get("limit"))
        return Response.json({
          success: true,
          data: {
            chapters: chapters.slice(offset, offset + limit),
            pagination: {
              total: chapters.length,
              limit,
              offset,
              has_more: offset + limit < chapters.length,
            },
          },
        })
      }
      return new Response(readerHtml, {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    })
    const seriesUrl = `https://www.${domain}/manga/hunter-x-hunter`
    const result = await adapter.offscreen.series!.resolveSeriesData({
      requestId: "captured-hunter",
      seriesUrl,
      html: seriesHtml,
      document: new DOMParser().parseFromString(seriesHtml, "text/html"),
      rateLimitService,
    })
    expect(result.seriesMetadata).toMatchObject({
      title: "Hunter X Hunter",
      author: "TOGASHI Yoshihiro",
      language: "en",
    })
    if (!Array.isArray(result.chapterList))
      throw new Error("Expected a chapter array")
    expect(result.chapterList).toHaveLength(546)
    expect(result.chapterList?.[0]).toMatchObject({
      id: "chapter-0",
      url: `${seriesUrl}/chapter-0`,
    })
    expect(result.chapterList?.at(-1)).toMatchObject({
      id: "chapter-420",
      title: "Chapter 420: Encounter",
    })
    const plan = await adapter.offscreen.chapter.resolveChapterPlan(
      { id: "chapter-0", url: `${seriesUrl}/chapter-0` },
      { runtime }
    )
    expect(plan.imageUrls).toHaveLength(30)
    expect(plan.imageUrls[0]).toBe(
      "https://img-r1.2xstorage.com/hunter-x-hunter/0/0.webp"
    )
    expect(plan.imageUrls.at(-1)).toBe(
      "https://img-r1.2xstorage.com/hunter-x-hunter/0/29.webp"
    )
    expect(
      fetchMock.mock.calls.every(
        ([value]) => new URL(String(value)).hostname === `www.${domain}`
      )
    ).toBe(true)
  })
})
