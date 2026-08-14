import { describe, expect, it } from "vitest"

import {
  assertDecodedImageWithinLimits,
  DecodedImageResourceLimitError,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"

function makeJpegFrame(
  marker: number,
  width: number,
  height: number,
  prefix: number[] = []
): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...prefix,
    0xff,
    marker,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ])
}

describe("decoded image resource limits", () => {
  it.each(["GIF87a", "GIF89a"])(
    "reads little-endian logical dimensions from a complete %s fixture",
    (signature) => {
      // Complete single-frame GIF fixture. The logical screen is deliberately
      // larger than 255px so a byte-order regression cannot pass accidentally.
      const bytes = new Uint8Array([
        ...signature.split("").map((character) => character.charCodeAt(0)),
        0x02,
        0x01,
        0x01,
        0x02,
        0x80,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xff,
        0xff,
        0xff,
        0x2c,
        0x00,
        0x00,
        0x00,
        0x00,
        0x01,
        0x00,
        0x01,
        0x00,
        0x00,
        0x02,
        0x02,
        0x44,
        0x01,
        0x00,
        0x3b,
      ])

      expect(readEncodedImageDimensions(bytes.buffer, "image/gif")).toEqual({
        width: 258,
        height: 513,
      })
    }
  )

  it("reads PNG dimensions without decoding the image", () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    new DataView(bytes.buffer).setUint32(16, 1600)
    new DataView(bytes.buffer).setUint32(20, 2400)

    expect(
      readEncodedImageDimensions(bytes.buffer as ArrayBuffer, "image/png")
    ).toEqual({
      width: 1600,
      height: 2400,
    })
  })

  it.each([0xc0, 0xc2])(
    "reads baseline/progressive JPEG SOF marker 0x%02x",
    (marker) => {
      const bytes = makeJpegFrame(marker, 1600, 2400)
      expect(
        readEncodedImageDimensions(bytes.buffer as ArrayBuffer, "image/jpeg")
      ).toEqual({
        width: 1600,
        height: 2400,
      })
    }
  )

  it("handles fill, TEM, and restart markers before a JPEG frame", () => {
    const bytes = makeJpegFrame(0xc0, 320, 240, [0xff, 0xff, 0x01, 0xff, 0xd0])
    expect(
      readEncodedImageDimensions(bytes.buffer as ArrayBuffer, "image/jpeg")
    ).toEqual({
      width: 320,
      height: 240,
    })
  })

  it.each([
    ["SOS before SOF", new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])],
    [
      "truncated segment length",
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]),
    ],
    [
      "invalid segment length",
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]),
    ],
  ])("rejects hostile JPEG metadata: %s", (_label, bytes) => {
    expect(() =>
      readEncodedImageDimensions(bytes.buffer, "image/jpeg")
    ).toThrow("dimensions are unavailable")
  })

  it("does not treat entropy SOF-like bytes as metadata", () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0,
    ])
    expect(() =>
      readEncodedImageDimensions(bytes.buffer, "image/jpeg")
    ).toThrow("dimensions are unavailable")
  })

  it("stops scanning JPEG metadata at the bounded budget", () => {
    const bytes = new Uint8Array(1_100_000)
    bytes[0] = 0xff
    bytes[1] = 0xd8
    for (let offset = 2; offset + 4 < bytes.length; offset += 65_537) {
      bytes[offset] = 0xff
      bytes[offset + 1] = 0xe0
      bytes[offset + 2] = 0xff
      bytes[offset + 3] = 0xff
    }
    expect(() =>
      readEncodedImageDimensions(bytes.buffer, "image/jpeg")
    ).toThrow("dimensions are unavailable")
  })

  it("rejects AVIF before metadata parsing", () => {
    const bytes = new Uint8Array(48)
    new DataView(bytes.buffer).setUint32(0, 24)
    bytes.set([0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4)
    bytes.set([0x61, 0x76, 0x69, 0x66], 16)
    bytes.set([0x69, 0x73, 0x70, 0x65], 28)
    new DataView(bytes.buffer).setUint32(36, 1200)
    new DataView(bytes.buffer).setUint32(40, 1800)

    expect(() =>
      readEncodedImageDimensions(bytes.buffer, "image/avif")
    ).toThrow("AVIF images are not supported")
  })

  it("rejects a structurally valid AVIF until bounded support is implemented", () => {
    const bytes = new Uint8Array(72)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 24)
    bytes.set([0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4)
    bytes.set([0x61, 0x76, 0x69, 0x66], 16)
    view.setUint32(24, 48)
    bytes.set([0x6d, 0x65, 0x74, 0x61], 28)
    view.setUint32(36, 36)
    bytes.set([0x69, 0x70, 0x72, 0x70], 40)
    view.setUint32(44, 28)
    bytes.set([0x69, 0x70, 0x63, 0x6f], 48)
    view.setUint32(52, 20)
    bytes.set([0x69, 0x73, 0x70, 0x65], 56)
    view.setUint32(64, 1200)
    view.setUint32(68, 1800)

    expect(() =>
      readEncodedImageDimensions(bytes.buffer, "image/avif")
    ).toThrow("AVIF images are not supported")
  })

  it("accepts a normal comic page", () => {
    expect(() =>
      assertDecodedImageWithinLimits(1600, 2400, "Test")
    ).not.toThrow()
  })

  it("rejects an excessive single dimension", () => {
    expect(() => assertDecodedImageWithinLimits(16_385, 100, "Test")).toThrow(
      DecodedImageResourceLimitError
    )
    expect(() => assertDecodedImageWithinLimits(16_385, 100, "Test")).toThrow(
      "dimension"
    )
  })

  it("rejects excessive decoded pixel area", () => {
    expect(() => assertDecodedImageWithinLimits(8192, 8192, "Test")).toThrow(
      DecodedImageResourceLimitError
    )
    expect(() => assertDecodedImageWithinLimits(8192, 8192, "Test")).toThrow(
      "pixel"
    )
  })
})
