import { describe, expect, it } from "vitest"
import { readEncodedImageDimensions } from "@/src/runtime/decoded-image-limits"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"

function webpChunk(type: string, payload: number[]): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length + (payload.length % 2))
  bytes.set(new TextEncoder().encode(type))
  new DataView(bytes.buffer).setUint32(4, payload.length, true)
  bytes.set(payload, 8)
  return bytes
}

function webp(...chunks: Uint8Array[]): ArrayBuffer {
  const bytes = new Uint8Array(
    12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  )
  bytes.set(new TextEncoder().encode("RIFF"))
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true)
  bytes.set(new TextEncoder().encode("WEBP"), 8)
  let offset = 12
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes.buffer
}

function dimensions(buffer: ArrayBuffer) {
  return readEncodedImageDimensions(
    buffer,
    "image/webp",
    new OffscreenLiveResourceLedger()
  )
}

describe("WebP bounded dimension metadata", () => {
  it.each([
    ["VP8X", [0, 0, 0, 0, 1, 1, 0, 0, 2, 0]],
    ["VP8L", [0x2f, 1, 1, 0x80, 0]],
    ["VP8 ", [0, 0, 0, 0x9d, 1, 0x2a, 2, 1, 1, 2]],
  ] as const)("reads %s canvas dimensions", (type, payload) => {
    expect(dimensions(webp(webpChunk(type, [...payload])))).toEqual({
      width: 258,
      height: 513,
    })
  })

  it("skips padded unknown metadata before the dimension chunk", () => {
    expect(
      dimensions(
        webp(webpChunk("JUNK", [9]), webpChunk("VP8L", [0x2f, 1, 1, 0x80, 0]))
      )
    ).toEqual({ width: 258, height: 513 })
  })

  it.each([
    webp(webpChunk("VP8L", [0, 1, 1, 0x80, 0])),
    webp(webpChunk("VP8 ", [0, 0, 0, 0, 1, 0x2a, 2, 1, 1, 2])),
    webp(webpChunk("VP8X", [0, 0, 0])),
    webp(webpChunk("JUNK", [1])).slice(0, 20),
  ])("rejects incomplete or unrecognized frame metadata", (buffer) => {
    expect(() => dimensions(buffer)).toThrow("dimensions are unavailable")
  })

  it("bounds the number of metadata chunks scanned", () => {
    const junk = Array.from({ length: 4096 }, () => webpChunk("JUNK", []))
    expect(() =>
      dimensions(
        webp(...junk, webpChunk("VP8X", [0, 0, 0, 0, 1, 1, 0, 0, 2, 0]))
      )
    ).toThrow("dimensions are unavailable")
  })
})
