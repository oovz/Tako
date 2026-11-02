import { describe, expect, it } from "vitest"
import { BinaryWriter } from "@bufbuild/protobuf/wire"
import {
  decodeMangaPlusTitle,
  decodeMangaPlusViewer,
} from "@/src/site-integrations/mangaplus/proto"

function bytes(field: number, value: Uint8Array): Uint8Array {
  return new BinaryWriter().tag(field, 2).bytes(value).finish()
}
function titleResponse(): Uint8Array {
  const title = new BinaryWriter()
    .tag(1, 0)
    .uint32(100467)
    .tag(2, 2)
    .string("Home at the Horizon")
    .tag(3, 2)
    .string("Taiyo Watabe")
    .finish()
  const chapter = (id: number) =>
    new BinaryWriter()
      .tag(1, 0)
      .uint32(100467)
      .tag(2, 0)
      .uint32(id)
      .tag(3, 2)
      .string("#001")
      .finish()
  const content = bytes(1, chapter(1024395))
  const middle = bytes(2, bytes(1, chapter(1024563)))
  const detail = new BinaryWriter()
    .raw(bytes(1, title))
    .raw(bytes(47, content))
    .raw(bytes(47, middle))
    .finish()
  return bytes(1, bytes(8, detail))
}

describe("MANGA Plus website protocol", () => {
  it("resolves current chapter content entries and keeps app-only middle chapters unavailable", () => {
    const result = decodeMangaPlusTitle(titleResponse())
    expect(result.title).toMatchObject({
      id: 100467,
      name: "Home at the Horizon",
      author: "Taiyo Watabe",
    })
    expect(
      result.chapters.map(({ id, locked }) => ({ id, locked: !!locked }))
    ).toEqual([
      { id: 1024395, locked: false },
      { id: 1024563, locked: true },
    ])
  })
  it("rejects HTTP-success protocol errors", () => {
    const error = bytes(2, new BinaryWriter().tag(1, 0).uint32(3).finish())
    expect(() => decodeMangaPlusTitle(error)).toThrow(/rejected.*3/)
  })
  it("rejects a child length crossing its parent before decoding a nested message", () => {
    expect(() => decodeMangaPlusTitle(new Uint8Array([10, 2, 66, 3]))).toThrow()
  })
  it("retains manga pages in order and excludes explicit advertisement pages", () => {
    const page = (url: string) =>
      bytes(
        1,
        new BinaryWriter()
          .tag(1, 2)
          .string(url)
          .tag(2, 0)
          .uint32(1110)
          .tag(3, 0)
          .uint32(1620)
          .tag(5, 2)
          .string("0102")
          .finish()
      )
    const viewer = new BinaryWriter()
      .raw(bytes(1, page("https://jumpg-assets3.tokyo-cdn.com/1.jpg")))
      .raw(bytes(1, bytes(4, new Uint8Array())))
      .raw(bytes(1, page("https://jumpg-assets3.tokyo-cdn.com/2.jpg")))
      .tag(2, 0)
      .uint32(1030661)
      .tag(19, 2)
      .string("synthetic-viewer-token")
      .finish()
    const result = decodeMangaPlusViewer(bytes(1, bytes(10, viewer)))
    expect(result.images.map(({ url }) => url)).toEqual([
      "https://jumpg-assets3.tokyo-cdn.com/1.jpg",
      "https://jumpg-assets3.tokyo-cdn.com/2.jpg",
    ])
    expect(result.viewerToken).toBe("synthetic-viewer-token")
  })
})
