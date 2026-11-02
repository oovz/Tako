import { describe, expect, it } from "vitest"
import { zipSync } from "fflate"
import {
  readChapterArchive,
  readChapterArchiveWithComicInfo,
} from "../../e2e/fixtures/chapter-artifact"
import { SMALL_PNG_BYTES } from "../../e2e/fixtures/mock-data/shared/pixel-png"

describe("saved chapter archive inspection", () => {
  it("opens every expected numbered image entry", () => {
    const archive = zipSync({
      "001.png": SMALL_PNG_BYTES,
      "002.png": SMALL_PNG_BYTES,
    })
    expect(readChapterArchive(archive, 2).map((image) => image.name)).toEqual([
      "001.png",
      "002.png",
    ])
  })

  it.each([
    ["missing page", { "001.png": SMALL_PNG_BYTES }, 2],
    [
      "numbering gap",
      { "001.png": SMALL_PNG_BYTES, "003.png": SMALL_PNG_BYTES },
      2,
    ],
    ["empty image", { "001.png": new Uint8Array() }, 1],
    [
      "metadata only",
      { "ComicInfo.xml": new TextEncoder().encode("<ComicInfo/>") },
      1,
    ],
    [
      "unexpected entry",
      { "001.png": SMALL_PNG_BYTES, "error.html": SMALL_PNG_BYTES },
      1,
    ],
    ["empty chapter", {}, 0],
  ])("rejects %s", (_name, entries, count) => {
    expect(() => readChapterArchive(zipSync(entries), count)).toThrow()
  })

  it("rejects a ZIP signature without an archive", () => {
    expect(() =>
      readChapterArchive(new Uint8Array([80, 75, 3, 4]), 1)
    ).toThrow()
  })

  it("reads metadata separately while enforcing the complete image sequence", () => {
    const xml =
      "<ComicInfo><Series>作品 &amp; Authors</Series><PageCount>1</PageCount></ComicInfo>"
    const archive = zipSync({
      "001.png": SMALL_PNG_BYTES,
      "ComicInfo.xml": new TextEncoder().encode(xml),
    })
    const inspected = readChapterArchiveWithComicInfo(archive, 1)
    expect(inspected.comicInfoXml).toBe(xml)
    expect(inspected.images.map((image) => image.name)).toEqual(["001.png"])
    expect(() => readChapterArchiveWithComicInfo(archive, 2)).toThrow(
      "Expected 2 chapter images"
    )
  })

  it.each([
    ["missing metadata", {}],
    ["empty metadata", { "ComicInfo.xml": new Uint8Array() }],
    ["invalid UTF-8", { "ComicInfo.xml": new Uint8Array([255]) }],
    [
      "unexpected file",
      {
        "ComicInfo.xml": new TextEncoder().encode("<ComicInfo/>"),
        "error.html": SMALL_PNG_BYTES,
      },
    ],
  ])("rejects an archive with %s", (_reason, entries) => {
    expect(() =>
      readChapterArchiveWithComicInfo(
        zipSync({ "001.png": SMALL_PNG_BYTES, ...entries }),
        1
      )
    ).toThrow()
  })
})
