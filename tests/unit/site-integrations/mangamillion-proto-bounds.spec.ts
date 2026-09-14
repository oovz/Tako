import { describe, expect, it } from "vitest"
import { decodeMangaMillionResponse } from "@/src/site-integrations/mangamillion/proto"

function varint(input: number): number[] {
  let value = input >>> 0
  const bytes: number[] = []
  while (value >= 128) {
    bytes.push((value & 127) | 128)
    value >>>= 7
  }
  return [...bytes, value]
}
function message(field: number, bytes: number[]): number[] {
  return [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes]
}

describe("MangaMillion Protobuf bounds", () => {
  it.each([
    ["truncated root varint", [0x80]],
    ["tag zero", [0]],
    ["overlong tag", [...Array<number>(11).fill(0x80), 0]],
    ["wrong wire type for status", [10, 0]],
    ["truncated string", [18, 4, 65]],
    ["child beyond physical bytes", [...varint(402), ...varint(4096)]],
    ["child beyond its parent", [0x92, 3, 2, 10, 3, 18, 1, 65]],
    ["truncated fixed-width unknown field", [0x29, 0]],
    ["root end-group", [0x2c]],
  ] as const)("rejects %s", (_label, bytes) => {
    expect(() => decodeMangaMillionResponse(Uint8Array.from(bytes))).toThrow()
  })

  it("accepts the viewer-page cap and rejects one more before materializing it", () => {
    const pages = Array.from({ length: 2000 }, () => [10, 0]).flat()
    expect(
      decodeMangaMillionResponse(Uint8Array.from(message(70, pages))).viewer
        ?.pages
    ).toHaveLength(2000)
    expect(() =>
      decodeMangaMillionResponse(
        Uint8Array.from(message(70, [...pages, 10, 0]))
      )
    ).toThrow(/limit|budget/)
  })

  it("bounds total chapter entries across multiple groups", () => {
    const chapters = Array.from({ length: 5001 }, () => [18, 0]).flat()
    const groups = [...message(2, chapters), ...message(2, chapters)]
    expect(() =>
      decodeMangaMillionResponse(Uint8Array.from(message(60, groups)))
    ).toThrow(/limit|budget/)
  })

  it("bounds chapter-group objects before allocating excess entries", () => {
    const groups = Array.from({ length: 10_001 }, () => [18, 0]).flat()
    expect(() =>
      decodeMangaMillionResponse(Uint8Array.from(message(60, groups)))
    ).toThrow(/limit|budget/)
  })

  it("preserves signed int32 and length-delimited metadata", () => {
    const result = decodeMangaMillionResponse(
      Uint8Array.from([
        8, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1, 18, 3, 98,
        97, 100,
      ])
    )
    expect(result).toMatchObject({ status: -1, errorMessage: "bad" })
  })

  it("skips a complete unknown field while preserving known data", () => {
    expect(
      decodeMangaMillionResponse(
        Uint8Array.from([8, 0, ...message(999, [1, 2, 3])])
      )
    ).toEqual({ status: 0 })
  })
})
