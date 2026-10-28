import { readFileSync } from "node:fs"
import { Window } from "happy-dom"
import { describe, expect, it } from "vitest"
import contract from "@/tests/fixtures/site-integrations/mycomic/contract.json"
import { offscreenSiteAdapter } from "@/src/site-integrations/mycomic/offscreen-runtime"
import { parseMyComicChapterImages } from "@/src/site-integrations/mycomic/reader"
import { RateLimitService } from "@/src/runtime/rate-limit"

const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const fixture = {
  ...contract.data,
  seriesHtml: readFileSync(
    "tests/fixtures/site-integrations/mycomic/series.html",
    "utf8"
  ),
  readerHtml: readFileSync(
    "tests/fixtures/site-integrations/mycomic/reader.html",
    "utf8"
  ),
}
function documentFor(html: string): Document {
  const window = new Window()
  window.document.body.innerHTML = html
  return window.document as unknown as Document
}

describe("MyComic content contracts", () => {
  it("resolves all captured chapter groups without executing page scripts", async () => {
    const html = `${fixture.seriesHtml}<a href="/cn/chapters/999">Advertisement</a>`
    const result =
      await offscreenSiteAdapter.offscreen.series!.resolveSeriesData({
        requestId: "captured-series",
        seriesUrl: fixture.seriesUrl,
        html,
        document: documentFor(html),
        rateLimitService,
      })
    expect(result.seriesMetadata?.title).toBe("葬送者芙莉莲")
    const chapters =
      result.chapterList && !Array.isArray(result.chapterList)
        ? result.chapterList.chapters
        : []
    expect(chapters).toHaveLength(151)
    expect(chapters[0]).toMatchObject({
      id: "492177",
      title: "第01话",
      volumeLabel: "单话",
      url: "https://mycomic.com/cn/chapters/492177",
    })
    expect(chapters.find((chapter) => chapter.id === "743080")).toMatchObject({
      title: "第11卷",
      volumeLabel: "单行本",
    })
    expect(chapters.at(-1)).toMatchObject({
      id: "544384",
      title: "1-3卷附赠",
      volumeLabel: "番外篇",
    })
    expect(chapters.some((chapter) => chapter.id === "999")).toBe(false)
  })

  it("parses all captured reader pages and retains the notice", () => {
    const urls = parseMyComicChapterImages(
      documentFor(fixture.readerHtml),
      "492177"
    )
    expect(urls).toHaveLength(39)
    expect(urls[0]).toBe(fixture.firstImage)
  })

  it("excludes unrelated advertisements from the captured page sequence", () => {
    const document = documentFor(
      `<img class="ad" src="https://ads.example/ad.jpg">${fixture.readerHtml}`
    )
    expect(parseMyComicChapterImages(document, "492177")).toHaveLength(39)
  })

  it.each([
    [
      "missing first page",
      fixture.readerHtml.replace(/<img x-ref="page-1"[^>]*>/, ""),
    ],
    [
      "wrong chapter",
      fixture.readerHtml.replaceAll("/chapters/492177/", "/chapters/999/"),
    ],
    [
      "unsupported image",
      fixture.readerHtml.replace(
        fixture.firstImage,
        "https://biccam.com/img/unavailable.jpg"
      ),
    ],
    ["empty reader", "<h1>Chapter unavailable</h1>"],
  ])("rejects %s", (_reason, html) => {
    expect(() =>
      parseMyComicChapterImages(documentFor(html), "492177")
    ).toThrow()
  })
})
