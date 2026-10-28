import { describe, expect, it } from "vitest"
import { zipSync } from "fflate"
import { readChapterArchive } from "../../e2e/fixtures/chapter-artifact"
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
})
