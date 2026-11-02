// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import { offscreenSiteAdapter } from "@/src/site-integrations/readmanga/offscreen-runtime"
import type { RateLimitService } from "@/src/runtime/rate-limit"

const chapterHtml =
  '<div class="chapter"><h4>单话</h4><div class="chapter-list"><a href="/comic/1/2.html">第1话</a></div></div>'
const metadataHtml =
  '<div class="book-cont"><div class="book-title"><h1>Series title</h1></div></div>'

function resolveSeries(
  html: string,
  language?: string,
  document = new DOMParser().parseFromString(html, "text/html")
) {
  return offscreenSiteAdapter.offscreen.series!.resolveSeriesData({
    requestId: "offscreen-series",
    seriesUrl: "https://www.manhuagui.com/comic/1/",
    html,
    document,
    language,
    rateLimitService: {} as RateLimitService,
  })
}

describe("Manhuagui offscreen series resolution", () => {
  it("retains the chapter catalog when the fetched document lacks metadata", async () => {
    const result = await resolveSeries(chapterHtml)
    expect(result.seriesMetadata).toBeUndefined()
    expect(result.metadataError).toBeTypeOf("string")
    expect(result.chapterList).toMatchObject({
      chapters: [
        {
          id: "2",
          title: "第1话",
          url: "https://www.manhuagui.com/comic/1/2.html",
        },
      ],
    })
    expect(result.chapterListError).toBeUndefined()
    expect(result.chapterListNotice).toBeUndefined()
  })

  it("uses the requested language for metadata while retaining the parsed catalog", async () => {
    const result = await resolveSeries(metadataHtml + chapterHtml, "en")
    expect(result.seriesMetadata).toMatchObject({
      title: "Series title",
      language: "en",
    })
    expect(result.chapterList).toMatchObject({ chapters: [{ id: "2" }] })
    expect(result.metadataError).toBeUndefined()
    expect(result.chapterListError).toBeUndefined()
  })

  it("retains parsed metadata when reading the chapter DOM fails", async () => {
    const html = metadataHtml + chapterHtml
    const document = new DOMParser().parseFromString(html, "text/html")
    const querySelectorAll = document.querySelectorAll.bind(document)
    const failure = new Error("chapter DOM unavailable")
    vi.spyOn(document, "querySelectorAll").mockImplementation(
      <E extends Element = Element>(selector: string): NodeListOf<E> => {
        if (selector === ".chapter") throw failure
        return querySelectorAll<E>(selector)
      }
    )
    const result = await resolveSeries(html, undefined, document)
    expect(result.seriesMetadata).toMatchObject({
      title: "Series title",
      language: "zh",
    })
    expect(result.metadataError).toBeUndefined()
    expect(result.chapterList).toBeUndefined()
    expect(result.chapterListError).toBe(failure.message)
    expect(result.chapterListNotice).toBeUndefined()
  })

  it("retains metadata and reports site consent when chapter contents are gated", async () => {
    const result = await resolveSeries(
      metadataHtml + '<div id="checkAdult"></div>' + chapterHtml
    )
    expect(result.seriesMetadata).toMatchObject({
      title: "Series title",
      language: "zh",
    })
    expect(result.chapterList).toEqual({ chapters: [], volumes: [] })
    expect(result.chapterListNotice).toBe("adult-consent-required")
    expect(result.metadataError).toBeUndefined()
    expect(result.chapterListError).toBeUndefined()
  })
})
