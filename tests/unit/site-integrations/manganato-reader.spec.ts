// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import {
  parseManganatoChapterImages,
  parseManganatoChapterPage,
} from "@/src/site-integrations/manganato/reader/protocol"

describe("Manganato reader protocol", () => {
  it("uses the reader's declared image order and ignores page advertisements", () => {
    const html = `<img src="https://ads.example/banner.jpg"><script>var cdns = ["https://img-r1.2xstorage.com/"];var chapterImages = ["series/1/0.webp", "series/1/1.webp"];</script>`
    expect(parseManganatoChapterImages(html)).toEqual([
      "https://img-r1.2xstorage.com/series/1/0.webp",
      "https://img-r1.2xstorage.com/series/1/1.webp",
    ])
  })

  it("rejects missing reader data and untrusted image destinations", () => {
    expect(() =>
      parseManganatoChapterImages("<h1>Access denied</h1>")
    ).toThrow()
    expect(() =>
      parseManganatoChapterImages(
        '<script>var cdns=["https://attacker.example/"];var chapterImages=["1.jpg"];</script>'
      )
    ).toThrow()
  })

  it("keeps paginated chapter order and validates the complete-list contract", () => {
    expect(
      parseManganatoChapterPage({
        success: true,
        data: {
          chapters: [
            {
              chapter_name: "Chapter 1",
              chapter_slug: "chapter-1",
              chapter_num: 1,
            },
          ],
          pagination: { total: 1, limit: 50, offset: 0, has_more: false },
        },
      })
    ).toMatchObject({
      data: {
        chapters: [{ chapter_slug: "chapter-1" }],
        pagination: { total: 1 },
      },
    })
    expect(() =>
      parseManganatoChapterPage({ success: false, data: { chapters: [] } })
    ).toThrow()
  })
})
