import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { Window } from "happy-dom"
import {
  mangaHereImage,
  parseMangaHerePackedImages,
} from "@/src/site-integrations/mangahere/reader"
import { resolveMangaHereSeries } from "@/src/site-integrations/mangahere/series"

const documentFor = (html: string) => {
  const document = new Window().document
  document.documentElement.innerHTML = html
  return document as unknown as Document
}
const origin = "https://newm.mangahere.cc"

describe("MangaHere reader contracts", () => {
  it("decodes the captured first Hunter X Hunter chapter in declared order", () => {
    const html = readFileSync(
      "tests/fixtures/site-integrations/mangahere/hunter-reader.html",
      "utf8"
    )
    const images = parseMangaHerePackedImages(html)
    expect(images).toHaveLength(33)
    expect(images[0]).toBe(
      "https://zjcdn.mangahere.org/store/manga/44/01-001.0/compressed/HxH_01_01.jpg"
    )
    expect(images.at(-1)).toBe(
      "https://zjcdn.mangahere.org/store/manga/44/01-001.0/compressed/HxH_cover.jpg"
    )
  })
  it.each([
    { suffix: "/", label: "a trailing slash" },
    { suffix: "", label: "no trailing slash" },
  ])(
    "preserves the captured catalog and volume identities with $label",
    ({ suffix }) => {
      const result = resolveMangaHereSeries(
        documentFor(
          readFileSync(
            "tests/fixtures/site-integrations/mangahere/series-page.html",
            "utf8"
          )
        ),
        `${origin}/manga/hunter_x_hunter${suffix}`
      )
      expect(result.seriesMetadata).toMatchObject({
        title: "Hunter X Hunter",
        author: "TOGASHI Yoshihiro",
        language: "en",
      })
      if (!Array.isArray(result.chapterList))
        throw new Error("Expected a chapter array")
      expect(result.chapterList).toHaveLength(425)
      expect(result.chapterList[0]).toMatchObject({
        id: "hunter_x_hunter/v30/c420",
        url: `${origin}/manga/hunter_x_hunter/v30/c420/1.html`,
        title: "Vol.30 Ch.420",
        chapterNumber: 420,
        volumeNumber: 30,
      })
      expect(result.chapterList.at(-1)).toMatchObject({
        id: "hunter_x_hunter/v01/c001",
        chapterNumber: 1,
        volumeNumber: 1,
      })
    }
  )
  it("decodes the additional packed image list without including advertisements", () => {
    const html = readFileSync(
      "tests/fixtures/site-integrations/mangahere/packed-reader.html",
      "utf8"
    )
    const images = parseMangaHerePackedImages(html)
    expect(images).toHaveLength(14)
    expect(images[0]).toBe(
      "https://zjcdn.mangahere.org/store/manga/45104/148.0/compressed/u001.jpg"
    )
    expect(images.at(-1)).toBe(
      "https://zjcdn.mangahere.org/store/manga/45104/148.0/compressed/u014.jpg"
    )
  })
  it("rejects a partial packed list and executable payloads", () => {
    const html = readFileSync(
      "tests/fixtures/site-integrations/mangahere/packed-reader.html",
      "utf8"
    )
    expect(() =>
      parseMangaHerePackedImages(html.replace("imagecount=14", "imagecount=15"))
    ).toThrow("incomplete")
    expect(() =>
      parseMangaHerePackedImages(
        "<script>newImgs = fetch('https://example.com')</script>"
      )
    ).toThrow()
  })
  it("bounds dictionary expansion before allocating an oversized decoded reader", () => {
    const packed = `}('${Array(110).fill("1").join(" ")}',2,2,'|${"x".repeat(100_000)}'.split('|'),0,{}))`
    expect(() => parseMangaHerePackedImages(packed)).toThrow("size limit")
  })
  it("rejects error-image paths and unrelated image hosts", () => {
    expect(() =>
      mangaHereImage("https://zjcdn.mangahere.org/nopicture.jpg")
    ).toThrow("unsupported")
    expect(() =>
      mangaHereImage("https://attacker.example/store/manga/44/page.jpg")
    ).toThrow("unsupported")
  })
})
