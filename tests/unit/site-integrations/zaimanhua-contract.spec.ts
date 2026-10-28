import { describe, expect, it } from "vitest"
import contract from "@/tests/fixtures/site-integrations/mangaagain/contract.json"
import {
  parseZaimanhuaSeries,
  parseZaimanhuaChapter,
  parseZaimanhuaUrl,
} from "@/src/site-integrations/mangaagain/api"

const fixture = contract.data

describe("Manga Again reader", () => {
  it("retains complete catalogs and their shared identity across both API variants", () => {
    const first = parseZaimanhuaSeries(
      fixture.series,
      new URL("https://www.zaimanhua.com/info/doufo.html")
    )
    const second = parseZaimanhuaSeries(
      fixture.seriesComic2,
      new URL("https://manhua.zaimanhua.com/info/doufo.html")
    )
    expect(first.seriesId).toBe("83175")
    expect(first.seriesMetadata).toMatchObject({
      title: "斗佛",
      author: "画梦人",
      genres: ["格斗", "神鬼"],
    })
    expect(second.seriesMetadata).toEqual(first.seriesMetadata)
    expect(first.chapterList).toHaveLength(46)
    expect(first.chapterList[0]).toMatchObject({ id: "175505", title: "第1话" })
    expect(first.chapterList.at(-1)).toMatchObject({
      id: "195373",
      title: "重置版第13回",
    })
    expect(second.chapterList.map((chapter) => chapter.id)).toEqual(
      first.chapterList.map((chapter) => chapter.id)
    )
    expect(second.seriesId).toBe(first.seriesId)
  })

  it("preserves all seven issued page URLs and rejects another chapter's data", () => {
    const urls = parseZaimanhuaChapter(fixture.chapter, "83175", "195373")
    expect(urls).toHaveLength(7)
    expect(urls.map((value) => new URL(value).pathname)).toEqual(
      Array.from(
        { length: 7 },
        (_, index) =>
          `/img/chapterpic%2F43031%2F161768%2FIMG_20261017_00${String(index + 7).padStart(2, "0")}.jpg`
      )
    )
    expect(() =>
      parseZaimanhuaChapter(fixture.chapter, "65391", "195373")
    ).toThrow()
  })

  it("surfaces access failures and empty required pages", () => {
    expect(() =>
      parseZaimanhuaSeries(
        { errno: 401, errmsg: "login required" },
        new URL("https://www.zaimanhua.com/info/doufo.html")
      )
    ).toThrow("unavailable")
    const emptyChapter = structuredClone(fixture.chapter)
    emptyChapter.data.chapterInfo.page_url = []
    expect(() =>
      parseZaimanhuaChapter(emptyChapter, "83175", "195373")
    ).toThrow()
  })

  it("recognizes only the concrete series and reader routes", () => {
    expect(
      parseZaimanhuaUrl("https://manhua.zaimanhua.com/view/doufo/83175/195373")
    ).toMatchObject({
      slug: "doufo",
      variant: "comic2",
      seriesId: "83175",
      chapterId: "195373",
    })
    expect(() =>
      parseZaimanhuaUrl("https://evil.example/info/doufo.html")
    ).toThrow()
  })
})
