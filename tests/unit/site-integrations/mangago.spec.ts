import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Window } from "happy-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  parseMangagoReader,
  parseMangagoProtocol,
  decodeMangagoImageList,
} from "@/src/site-integrations/mangago/reader"
import {
  parseMangagoImageTransport,
  reconstructMangagoImage,
} from "@/src/site-integrations/mangago/grid-image"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { SHONEN_JUMP_PLUS_SCRAMBLED_PNG } from "@/tests/e2e/fixtures/mock-data/site-integrations/shonenjumpplus/scrambled-image-fixture"
import { parseMangagoUrl } from "@/src/site-integrations/mangago/shared"
import { parseMangagoSeries } from "@/src/site-integrations/mangago/series-dom"
import { buildOptionalComicInfoXml } from "@/entrypoints/offscreen/chapter-processing-helpers"
import contract from "@/tests/fixtures/site-integrations/mangago/contract.json"
const fixture = contract.data
const seriesHtml = readFileSync(
  resolve("tests/fixtures/site-integrations/mangago/series.html"),
  "utf8"
)
const readerHtml = readFileSync(
  resolve("tests/fixtures/site-integrations/mangago/reader.html"),
  "utf8"
)
const secondarySeriesHtml = readFileSync(
  resolve("tests/fixtures/site-integrations/mangago/series-kenshi.html"),
  "utf8"
)
const secondaryReaderHtml = readFileSync(
  resolve("tests/fixtures/site-integrations/mangago/reader-kenshi.html"),
  "utf8"
)
function documentFor(html: string): Document {
  const window = new Window()
  window.document.body.innerHTML = html
  return window.document as unknown as Document
}

describe("Mangago content contracts", () => {
  it("resolves the complete captured catalog with legacy and nested chapter routes", () => {
    const result = parseMangagoSeries(
      documentFor(seriesHtml),
      fixture.seriesUrl
    )
    expect(result.seriesId).toBe(fixture.seriesId)
    expect(result.seriesMetadata).toMatchObject({
      title: "Hunter X Hunter",
      author: "TOGASHI Yoshihiro",
      year: 1998,
      genres: ["Action", "Adventure", "Fantasy", "Shounen"],
      coverUrl:
        "https://i8.mangapicgallery.com/r/coverlink/rROHYUm8aBWtWyHvm2ureZ5RyXTk8VioExvQIzsBW4Yz71sgDwkjUa7pSGyap1FXkX5kDg6vUgCchdAWYT7sQfuWiC-W266WD8R.jpg?4",
    })
    const chapters =
      result.chapterList && !Array.isArray(result.chapterList)
        ? result.chapterList.chapters
        : []
    expect(chapters).toHaveLength(423)
    const xml = buildOptionalComicInfoXml({
      includeComicInfo: true,
      chapter: chapters[0],
      seriesTitle: "Hunter X Hunter",
      seriesMetadata: result.seriesMetadata,
      pageCount: 19,
      comicInfoVersion: "2.0",
      hasCoverImage: false,
    })
    expect(xml).not.toBeNull()
    const window = new Window()
    const comicInfo = new window.DOMParser().parseFromString(xml!, "text/xml")
    expect(comicInfo.querySelector("Writer")?.textContent).toBe(
      "TOGASHI Yoshihiro"
    )
    expect(comicInfo.querySelector("Genre")?.textContent).toBe(
      "Action, Adventure, Fantasy, Shounen"
    )
    expect(comicInfo.querySelector("Year")?.textContent).toBe("1998")
    expect(comicInfo.querySelector("Summary")?.textContent).toMatch(
      /right to call themselves Hunters\.$/
    )
    expect(chapters[0]).toMatchObject({
      id: "an:hunter-x-hunter-chapter-0.html",
    })
    expect(chapters.at(-1)).toMatchObject({ id: "an:nml_chapter-420" })
    expect(chapters.map((chapter) => chapter.id)).toContain("an:vTBD/c380")
    expect(chapters.map((chapter) => chapter.id)).toContain(
      "an:v32/c348/1.html"
    )
    expect(chapters.map((chapter) => chapter.id)).toContain(
      "an:hunter-x-hunter/364.1"
    )
  })
  it("keeps chapter identities stable across the observed bare and www hosts", () => {
    expect(
      parseMangagoUrl(fixture.readerUrl.replace("www.mangago.me", "mangago.me"))
        .chapterId
    ).toBe(parseMangagoUrl(fixture.readerUrl).chapterId)
  })
  it("retains fractional chapter routes from the secondary catalog", () => {
    expect(
      parseMangagoUrl(
        `${fixture.secondary.seriesUrl}nbt/mk_v-4-chapter-40.5/pg-1/`
      ).chapterId
    ).toBe("nbt:mk_v-4-chapter-40.5")
  })
  it("accepts observed legacy HTML chapter links while rejecting incomplete reader routes", () => {
    expect(
      parseMangagoUrl(`${fixture.seriesUrl}an/hunter-x-hunter-chapter-0.html`)
        .chapterId
    ).toBe("an:hunter-x-hunter-chapter-0.html")
    expect(() =>
      parseMangagoUrl(`${fixture.seriesUrl}an/nml_chapter-420`)
    ).toThrow()
  })
  it("preserves nested chapter identity across reader pages", () => {
    expect(
      parseMangagoUrl(`${fixture.seriesUrl}an/vTBD/c380/pg-1/`).chapterId
    ).toBe("an:vTBD/c380")
    expect(
      parseMangagoUrl(`${fixture.seriesUrl}an/vTBD/c380/pg-2/`).chapterId
    ).toBe("an:vTBD/c380")
    expect(
      parseMangagoUrl(
        `${fixture.secondary.seriesUrl}nbt/dad7dd2c1bbb26b4/Vol1_Ch1/`
      ).chapterId
    ).toBe("nbt:dad7dd2c1bbb26b4")
    expect(
      parseMangagoUrl(
        `${fixture.secondary.seriesUrl}nbt/dad7dd2c1bbb26b4/Vol1_Ch1`
      ).chapterId
    ).toBe("nbt:dad7dd2c1bbb26b4")
    for (const url of [
      `${fixture.seriesUrl}an/a/b/c/d/pg-1/`,
      `${fixture.seriesUrl}an/pg-1/`,
      fixture.readerUrl.replace("www.mangago.me", "untrusted.example"),
    ])
      expect(() => parseMangagoUrl(url)).toThrow()
  })
  it("decodes the captured reader list in page order without executing downloaded JavaScript", async () => {
    const protocol = parseMangagoProtocol(fixture.protocolScript)
    const reader = parseMangagoReader(
      documentFor(readerHtml),
      fixture.readerUrl
    )
    const plan = await decodeMangagoImageList(reader.encryptedImages, protocol)
    expect(plan).toHaveLength(19)
    expect(plan[0]).toBe(fixture.firstImage)
    expect(plan[18]).toBe(fixture.lastImage)
    expect(plan.slice(0, 2)).toEqual(
      [...documentFor(readerHtml).querySelectorAll('img[id^="page"]')].map(
        (image) => image.getAttribute("src")
      )
    )
    expect(
      parseMangagoReader(documentFor(readerHtml), fixture.readerUrl).totalPages
    ).toBe(19)
    expect(reader.scriptUrl).toBe(
      "https://pic1.mangapicgallery.com/js/chapter.js?895"
    )
  })
  it("retains the secondary complete catalog and reader protocol observation", async () => {
    const result = parseMangagoSeries(
      documentFor(secondarySeriesHtml),
      fixture.secondary.seriesUrl
    )
    expect(result.seriesMetadata).toMatchObject({
      author: "Nenjuu Mugichatarou, Iiman, Ijou",
      genres: [
        "Action",
        "Fantasy",
        "School Life",
        "Shoujo Ai",
        "Slice Of Life",
      ],
      year: 2000,
    })
    expect(result.seriesMetadata?.description).toContain(
      "Royal Capital’s Adventurer’s School"
    )
    expect(result.seriesMetadata?.description).toMatch(
      /stronger than the instructors\.$/
    )
    const chapters =
      result.chapterList && !Array.isArray(result.chapterList)
        ? result.chapterList.chapters
        : []
    expect(chapters).toHaveLength(74)
    expect(
      chapters.some((chapter) => chapter.id === "nbt:mk_v-4-chapter-40.5")
    ).toBe(true)
    const reader = parseMangagoReader(
      documentFor(secondaryReaderHtml),
      fixture.secondary.readerUrl
    )
    const pages = await decodeMangagoImageList(
      reader.encryptedImages,
      parseMangagoProtocol(fixture.protocolScript)
    )
    expect(pages).toHaveLength(35)
    expect(pages[0]).toBe(fixture.secondary.firstImage)
    expect(pages.at(-1)).toBe(fixture.secondary.lastImage)
  })
  it("rejects malformed reader and protocol responses instead of producing empty success", async () => {
    expect(() =>
      parseMangagoReader(documentFor("<h1>Unavailable</h1>"), fixture.readerUrl)
    ).toThrow()
    expect(() => parseMangagoProtocol("<h1>challenge</h1>")).toThrow()
    await expect(
      decodeMangagoImageList(
        "not base64",
        parseMangagoProtocol(fixture.protocolScript)
      )
    ).rejects.toThrow()
  })
})

describe("Mangago image reconstruction", () => {
  afterEach(() => vi.unstubAllGlobals())
  it("requires a complete tile permutation for scrambled image transport", () => {
    const base =
      "https://iweb_9.mangapicgallery.com/r/cspiclink/chapter/page.jpg"
    expect(parseMangagoImageTransport(`${base}#mg-grid=2:2,0,3,1`)).toEqual({
      sourceUrl: base,
      columns: 2,
      grid: [2, 0, 3, 1],
    })
    for (const suffix of [
      "",
      "#mg-grid=2:0,0,2,3",
      "#mg-grid=2:0,1,2,9",
      "#mg-grid=100:0",
    ])
      expect(() => parseMangagoImageTransport(base + suffix)).toThrow()
  })
  it("reconstructs the declared tile destinations and transfers only the final bytes", async () => {
    const bytes = new Uint8Array(SHONEN_JUMP_PLUS_SCRAMBLED_PNG).buffer
    const ledger = new OffscreenLiveResourceLedger()
    const sourceLease = ledger.reserve(bytes.byteLength, "source image")
    const bitmap = { width: 32, height: 32, close: vi.fn() }
    const drawImage = vi.fn()
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap)
    )
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage }
        }
        async convertToBlob() {
          return new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
        }
      }
    )
    const output = await reconstructMangagoImage(
      bytes,
      "image/png",
      2,
      [2, 0, 3, 1],
      undefined,
      ledger,
      sourceLease
    )
    expect(drawImage.mock.calls).toEqual([
      [bitmap, 0, 0, 16, 16, 0, 16, 16, 16],
      [bitmap, 16, 0, 16, 16, 0, 0, 16, 16],
      [bitmap, 0, 16, 16, 16, 16, 16, 16, 16],
      [bitmap, 16, 16, 16, 16, 16, 0, 16, 16],
    ])
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(3)
    output.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })
  it("releases source and decoded ownership when image decoding fails", async () => {
    const bytes = new Uint8Array(SHONEN_JUMP_PLUS_SCRAMBLED_PNG).buffer
    const ledger = new OffscreenLiveResourceLedger()
    const sourceLease = ledger.reserve(bytes.byteLength, "source image")
    const cause = new Error("Image cannot be decoded")
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw cause
      })
    )
    await expect(
      reconstructMangagoImage(
        bytes,
        "image/png",
        2,
        [2, 0, 3, 1],
        undefined,
        ledger,
        sourceLease
      )
    ).rejects.toBe(cause)
    expect(ledger.getUsedBytes()).toBe(0)
  })
})
