// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { offscreenSiteAdapter } from "@/src/site-integrations/readmanga/offscreen-runtime"

const html = readFileSync(
  "tests/fixtures/site-integrations/readmanga/series.html",
  "utf8"
)

describe("captured 看漫画 catalog", () => {
  it("resolves metadata and every volume, single chapter, and extra through the public adapter", async () => {
    const result =
      await offscreenSiteAdapter.offscreen.series!.resolveSeriesData({
        requestId: "captured-series",
        seriesUrl: "https://www.manhuagui.com/comic/19430/",
        html,
        document: new DOMParser().parseFromString(html, "text/html"),
        rateLimitService: {} as never,
      })
    expect(result.seriesMetadata).toMatchObject({
      title: "鬼灭之刃",
      author: "吾峠呼世晴",
      coverUrl: "https://cf.mhgui.com/cpic/h/19430.jpg",
      description: "充满了鬼才的，血雨剑戟冒险谭，正式开幕。",
      year: 2016,
      genres: ["冒险", "热血"],
      status: "已完结",
    })
    const list = result.chapterList
    if (!list || Array.isArray(list))
      throw new Error("grouped chapter list missing")
    expect(list.volumes?.map((volume) => volume.title)).toEqual([
      "单行本",
      "单话",
      "番外篇",
    ])
    expect(list.chapters).toHaveLength(235)
    expect(
      list.chapters.filter((chapter) => chapter.volumeLabel === "单行本")
    ).toHaveLength(23)
    expect(
      list.chapters.filter((chapter) => chapter.volumeLabel === "单话")
    ).toHaveLength(206)
    expect(
      list.chapters.filter((chapter) => chapter.volumeLabel === "番外篇")
    ).toHaveLength(6)
    expect(list.chapters[0]).toMatchObject({
      id: "585094",
      title: "第01卷",
      chapterNumber: 1,
    })
    expect(
      list.chapters.find((chapter) => chapter.id === "219425")
    ).toMatchObject({ title: "第01回", volumeLabel: "单话" })
    expect(
      list.chapters.find((chapter) => chapter.id === "494877")
    ).toMatchObject({ title: "20卷附录", volumeLabel: "番外篇" })
    expect(result.metadataError).toBeUndefined()
    expect(result.chapterListError).toBeUndefined()
  })
})
