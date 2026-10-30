// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest"
import { RateLimitService } from "@/src/runtime/rate-limit"
import {
  extractComicNettaiChapterListFromDocument,
  extractComicNettaiChapterListWithPagination,
} from "@/src/site-integrations/comictropics/series-dom"

const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const seriesUrl = "https://www.comicnettai.com/book/9"

function page(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html")
}

afterEach(() => rateLimitService.cleanupRateLimiters())

describe("Comic Nettai chapter titles", () => {
  it("uses the thumbnail label when a chapter has no visible title", () => {
    const result = extractComicNettaiChapterListFromDocument(
      page(`
      <a class="detail--product__item is-open" href="/publus/viewer.html?cid=viewer-2">
        <img class="detail--product__thum" data-src="https://cdn.comicnettai.com/9_hash/book_contents/2/icon.jpg" alt="  Episode 2  ">
      </a>`)
    )
    expect(result).toMatchObject({
      chapters: [
        {
          id: "2",
          title: "Episode 2",
          chapterLabel: "Episode 2",
          chapterNumber: 2,
        },
      ],
    })
  })

  it("uses the stable chapter identity as a title when both labels are absent", () => {
    const result = extractComicNettaiChapterListFromDocument(
      page(`
      <a class="detail--product__item is-open" href="/publus/viewer.html?cid=fallback"></a>`)
    )
    expect(result).toMatchObject({
      chapters: [
        {
          id: "fallback",
          title: "Chapter fallback",
          chapterLabel: "Chapter fallback",
        },
      ],
    })
  })
})

describe("Comic Nettai pagination cancellation", () => {
  it("preserves an existing abort cause and starts no additional page requests", async () => {
    const controller = new AbortController()
    const cause = new Error("tab closed")
    controller.abort(cause)
    const loadDocument = vi.fn(async () => page(""))
    await expect(
      extractComicNettaiChapterListWithPagination(
        page('<a href="?page=2">Next</a>'),
        seriesUrl,
        rateLimitService,
        loadDocument,
        controller.signal
      )
    ).rejects.toBe(cause)
    expect(loadDocument).not.toHaveBeenCalled()
  })

  it("discards a page that finishes after cancellation and starts no discovered requests", async () => {
    const controller = new AbortController()
    const loadDocument = vi.fn(async () => {
      controller.abort("tab closed")
      return page('<a href="?page=3">Next</a>')
    })
    await expect(
      extractComicNettaiChapterListWithPagination(
        page('<a href="?page=2">Next</a>'),
        seriesUrl,
        rateLimitService,
        loadDocument,
        controller.signal
      )
    ).rejects.toThrow("canceled")
    expect(loadDocument).toHaveBeenCalledOnce()
  })
})
