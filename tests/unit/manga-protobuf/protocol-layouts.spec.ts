import { describe, expect, it } from "vitest"
import { BinaryWriter } from "@bufbuild/protobuf/wire"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import { decodeMangaMillionResponse } from "@/src/site-integrations/mangamillion/proto"
import {
  decodeMangaPlusTitle,
  decodeMangaPlusViewer,
} from "@/src/site-integrations/mangaplus/proto"

function message(field: number, data: Uint8Array): Uint8Array {
  return new BinaryWriter().tag(field, 2).bytes(data).finish()
}
const unknown = () =>
  new BinaryWriter()
    .tag(999, 0)
    .uint32(3)
    .tag(998, 2)
    .string("future")
    .tag(997, 5)
    .fixed32(5)
    .finish()
function plusChapter(id: number): Uint8Array {
  return new BinaryWriter()
    .tag(1, 0)
    .uint32(7)
    .tag(2, 0)
    .uint32(id)
    .tag(3, 2)
    .string(`#${id}`)
    .tag(4, 2)
    .string("Subtitle")
    .tag(6, 0)
    .uint32(100)
    .tag(7, 0)
    .uint32(200)
    .tag(16, 0)
    .uint32(2)
    .raw(unknown())
    .finish()
}
function plusDetail(chapters: Uint8Array): Uint8Array {
  const title = new BinaryWriter()
    .tag(1, 0)
    .uint32(7)
    .tag(2, 2)
    .string("Series")
    .tag(3, 2)
    .string("Author")
    .tag(4, 2)
    .string("https://example.com/cover.jpg")
    .tag(7, 0)
    .uint32(2)
    .raw(unknown())
    .finish()
  const detail = new BinaryWriter()
    .raw(message(1, title))
    .tag(3, 2)
    .string("Description")
    .raw(chapters)
    .raw(unknown())
    .finish()
  return message(1, message(8, detail))
}
function plusImage(key = "0102"): Uint8Array {
  return new BinaryWriter()
    .tag(1, 2)
    .string("https://jumpg-assets3.tokyo-cdn.com/page.jpg")
    .tag(2, 0)
    .uint32(10)
    .tag(3, 0)
    .uint32(20)
    .tag(5, 2)
    .string(key)
    .raw(unknown())
    .finish()
}
function plusViewer(pages: Uint8Array, token = "token"): Uint8Array {
  return message(
    1,
    message(
      10,
      new BinaryWriter()
        .raw(pages)
        .tag(2, 0)
        .uint32(17)
        .tag(19, 2)
        .string(token)
        .raw(unknown())
        .finish()
    )
  )
}

describe("MangaMillion message contracts", () => {
  it("retains title, chapter catalog, viewer metadata and unknown fields at every message boundary", () => {
    const title = new BinaryWriter()
      .tag(1, 2)
      .string("cover")
      .tag(2, 2)
      .string("Series")
      .tag(3, 2)
      .string("Author")
      .tag(7, 2)
      .string("Description")
      .raw(unknown())
      .finish()
    const detail = new BinaryWriter()
      .raw(message(1, title))
      .tag(5, 0)
      .bool(true)
      .raw(unknown())
      .finish()
    const chapter = new BinaryWriter()
      .tag(1, 2)
      .string("#12.5")
      .tag(2, 2)
      .string("Chapter")
      .tag(3, 0)
      .uint32(17)
      .tag(4, 0)
      .uint32(4)
      .tag(5, 2)
      .string("thumbnail")
      .tag(6, 0)
      .bool(true)
      .raw(unknown())
      .finish()
    const group = new BinaryWriter()
      .tag(1, 0)
      .int32(-1)
      .raw(message(2, chapter))
      .raw(unknown())
      .finish()
    const list = new BinaryWriter()
      .tag(1, 0)
      .uint32(9)
      .raw(message(2, group))
      .tag(3, 0)
      .bool(true)
      .tag(7, 0)
      .uint32(8)
      .raw(unknown())
      .finish()
    const page = new BinaryWriter()
      .tag(1, 2)
      .string("page")
      .tag(2, 0)
      .uint32(10)
      .tag(3, 0)
      .uint32(20)
      .tag(4, 0)
      .int32(-1)
      .raw(unknown())
      .finish()
    const viewerChapter = new BinaryWriter()
      .tag(1, 2)
      .string("Series")
      .tag(2, 0)
      .uint32(7)
      .tag(4, 2)
      .string("#12.5")
      .tag(5, 0)
      .uint32(16)
      .tag(6, 0)
      .uint32(18)
      .tag(7, 0)
      .uint32(4)
      .raw(unknown())
      .finish()
    const viewer = new BinaryWriter()
      .raw(message(1, page))
      .raw(message(2, viewerChapter))
      .tag(7, 2)
      .string("key")
      .tag(8, 2)
      .string("iv")
      .tag(9, 0)
      .int32(2)
      .raw(unknown())
      .finish()
    const result = decodeMangaMillionResponse(
      new BinaryWriter()
        .tag(1, 0)
        .int32(0)
        .raw(message(50, detail))
        .raw(message(60, list))
        .raw(message(70, viewer))
        .raw(unknown())
        .finish()
    )
    expect(result).toEqual({
      status: 0,
      titleDetail: {
        serviceTitle: {
          coverUrl: "cover",
          serviceTitleName: "Series",
          authorName: "Author",
          description: "Description",
        },
        isMPlusRegion: true,
      },
      chapterList: {
        totalChapters: 9,
        availableChapters: 8,
        isMPlusRegion: true,
        chapterGroups: [
          {
            groupType: -1,
            chapters: [
              {
                number: "#12.5",
                name: "Chapter",
                translatedChapterId: 17,
                commentCount: 4,
                thumbnailUrl: "thumbnail",
                read: true,
              },
            ],
          },
        ],
      },
      viewer: {
        pages: [{ imageUrl: "page", widthPx: 10, heightPx: 20, pageType: -1 }],
        chapter: {
          serviceTitleName: "Series",
          originalTitleId: 7,
          number: "#12.5",
          prevId: 16,
          nextId: 18,
          commentCount: 4,
        },
        aesKey: "key",
        aesIv: "iv",
        maxImageQuality: 2,
      },
    })
  })

  it("rejects an overflowing unsigned chapter identity", () => {
    const chapter = new BinaryWriter().tag(3, 0).uint64(0x1_0000_0000n).finish()
    expect(() =>
      decodeMangaMillionResponse(message(60, message(2, message(2, chapter))))
    ).toThrow(/overflow/)
  })
})

describe("MANGA Plus historical and current layouts", () => {
  it("preserves both legacy chapter fields and grouped catalog order", () => {
    const group = new BinaryWriter()
      .raw(message(2, plusChapter(3)))
      .raw(message(3, plusChapter(4)))
      .raw(message(4, plusChapter(5)))
      .raw(unknown())
      .finish()
    const chapters = new BinaryWriter()
      .raw(message(9, plusChapter(1)))
      .raw(message(10, plusChapter(2)))
      .raw(message(28, group))
      .finish()
    const result = decodeMangaPlusTitle(plusDetail(chapters))
    expect(result.chapters.map(({ id }) => id)).toEqual([1, 2, 3, 4, 5])
    expect(result.chapters[0]).toMatchObject({
      titleId: 7,
      name: "#1",
      subtitle: "Subtitle",
      type: 2,
      start: 100,
      end: 200,
    })
    expect(result.title).toMatchObject({
      language: 2,
      coverUrl: "https://example.com/cover.jpg",
    })
    expect(result.description).toBe("Description")
  })

  it("prefers v2 chapters to legacy chapters and current entries to both", () => {
    const historical = new BinaryWriter()
      .raw(message(9, plusChapter(1)))
      .raw(message(38, plusChapter(2)))
      .finish()
    expect(
      decodeMangaPlusTitle(plusDetail(historical)).chapters.map(({ id }) => id)
    ).toEqual([2])
    const current = new BinaryWriter()
      .raw(message(1, plusChapter(3)))
      .raw(
        message(
          2,
          new BinaryWriter()
            .raw(message(1, plusChapter(4)))
            .raw(unknown())
            .finish()
        )
      )
      .raw(unknown())
      .finish()
    const chapters = new BinaryWriter()
      .raw(historical)
      .raw(message(47, current))
      .finish()
    expect(
      decodeMangaPlusTitle(plusDetail(chapters)).chapters.map(
        ({ id, locked }) => ({ id, locked: !!locked })
      )
    ).toEqual([
      { id: 3, locked: false },
      { id: 4, locked: true },
    ])
  })

  it("preserves the last matching success across unrelated success envelopes and honors an error envelope", () => {
    const valid = plusDetail(message(38, plusChapter(2)))
    const unrelated = message(1, message(100, new Uint8Array()))
    const combined = new BinaryWriter()
      .raw(valid)
      .raw(unrelated)
      .raw(unknown())
      .finish()
    expect(decodeMangaPlusTitle(combined).chapters[0].id).toBe(2)
    expect(() =>
      decodeMangaPlusTitle(
        new BinaryWriter()
          .raw(combined)
          .raw(message(2, new Uint8Array()))
          .finish()
      )
    ).toThrow(/rejected.*0/)
  })

  it.each(["0", "xyz", "01".repeat(129)])(
    "rejects invalid image keys (%s)",
    (key) => {
      expect(() =>
        decodeMangaPlusViewer(
          plusViewer(message(1, message(1, plusImage(key))))
        )
      ).toThrow()
    }
  )

  it("accepts the image cap, rejects excess pages, and rejects unknown page variants", () => {
    const pages = new BinaryWriter()
    for (let index = 0; index < MAX_CHAPTER_IMAGES; index++)
      pages.raw(message(1, message(1, plusImage(""))))
    const capped = pages.finish()
    expect(decodeMangaPlusViewer(plusViewer(capped)).images).toHaveLength(
      MAX_CHAPTER_IMAGES
    )
    const excess = new BinaryWriter()
      .raw(capped)
      .raw(message(1, message(1, plusImage())))
      .finish()
    expect(() => decodeMangaPlusViewer(plusViewer(excess))).toThrow()
    expect(() =>
      decodeMangaPlusViewer(plusViewer(message(1, unknown())))
    ).toThrow()
    expect(() =>
      decodeMangaPlusViewer(
        plusViewer(message(1, message(1, plusImage())), "x".repeat(8193))
      )
    ).toThrow()
  })

  it("rejects field groups, unsigned overflow, invalid UTF-8 and oversized strings", () => {
    const badTitles = [
      new Uint8Array([0x0b, 0x0c]),
      new BinaryWriter()
        .tag(1, 0)
        .uint64(0x1_0000_0000n)
        .tag(2, 2)
        .string("Series")
        .finish(),
      new BinaryWriter()
        .tag(1, 0)
        .uint32(7)
        .tag(2, 2)
        .bytes(Uint8Array.of(0xff))
        .finish(),
      new BinaryWriter()
        .tag(1, 0)
        .uint32(7)
        .tag(2, 2)
        .string("x".repeat(128001))
        .finish(),
    ]
    for (const title of badTitles) {
      const detail = new BinaryWriter()
        .raw(message(1, title))
        .raw(message(38, plusChapter(1)))
        .finish()
      expect(() =>
        decodeMangaPlusTitle(message(1, message(8, detail)))
      ).toThrow()
    }
  })
})
