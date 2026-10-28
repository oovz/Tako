import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { Window } from "happy-dom"
import { decodeAimanhuaImages } from "@/src/site-integrations/lovemanga/reader"
import { resolveAimanhuaSeries } from "@/src/site-integrations/lovemanga/series"
const documentFor = (html: string) => {
  const document = new Window().document
  document.documentElement.innerHTML = html
  return document as unknown as Document
}

describe("Aimanhua reader contracts", () => {
  it("admits the current reader's upload3 media directory", async () => {
    const images = await decodeAimanhuaImages(
      readFileSync(
        "tests/fixtures/site-integrations/lovemanga/reader-upload3.html",
        "utf8"
      ),
      "https://www.aimanhua.org/chapter/416895/221966"
    )
    expect(images).toHaveLength(179)
    expect(
      images.every((url) =>
        new URL(url).pathname.startsWith("/static/upload3/book/")
      )
    ).toBe(true)
  })
  it("decodes the public reader envelope and preserves every page", async () => {
    const html = readFileSync(
      "tests/fixtures/site-integrations/lovemanga/reader.html",
      "utf8"
    )
    const images = await decodeAimanhuaImages(
      html,
      "https://www.aimanhua.org/chapter/416895/133632"
    )
    expect(images).toHaveLength(73)
    expect(images[0]).toBe(
      "https://img1.baipiaoguai.org/static/upload2/book/id/283452/30525842/42a02a53c3246551a99d539f2f0f451c.webp"
    )
  })
  it("fails explicitly for an empty reader, corrupt envelope and another host", async () => {
    await expect(
      decodeAimanhuaImages(
        '<div id="chapter-images"></div>',
        "https://www.aimanhua.org/chapter/416895/133632"
      )
    ).rejects.toThrow()
    await expect(
      decodeAimanhuaImages(
        "<script>params='AAAA'</script>",
        "https://www.aimanhua.org/chapter/416895/133632"
      )
    ).rejects.toThrow()
    const html = readFileSync(
      "tests/fixtures/site-integrations/lovemanga/reader.html",
      "utf8"
    )
    await expect(
      decodeAimanhuaImages(html, "https://example.com/chapter/416895/133632")
    ).rejects.toThrow()
  })
  it("resolves the captured complete catalog and preserves distinct chapter identities", () => {
    const html = readFileSync(
      "tests/fixtures/site-integrations/lovemanga/series.html",
      "utf8"
    )
    const resolved = resolveAimanhuaSeries(
      documentFor(`${html}<a href="/chapter/999/123">Advertisement</a>`),
      "https://www.aimanhua.org/comic/416895"
    )
    expect(resolved.seriesId).toBe("416895")
    expect(resolved.seriesMetadata).toMatchObject({
      title: "A.I. 医生",
      author: "ZAINO",
    })
    expect(resolved.chapterList).toHaveLength(190)
    const chapters = Array.isArray(resolved.chapterList)
      ? resolved.chapterList
      : []
    expect(chapters[0]).toMatchObject({
      id: "133632",
      title: "第1话 未来的A.I.",
    })
    expect(chapters.at(-1)).toMatchObject({ id: "221965", title: "第187话" })
    expect(
      chapters
        .filter((chapter) => chapter.title === "第153话")
        .map((chapter) => chapter.id)
    ).toEqual(["220762", "221860"])
    // VIP is the story's title here, rather than an entitlement flag.
    expect(chapters.find((chapter) => chapter.id === "133714")).toMatchObject({
      title: "第83话 VIP",
    })
    expect(
      chapters.find((chapter) => chapter.id === "133714")?.locked
    ).not.toBe(true)
  })
})
