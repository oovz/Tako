import { describe, expect, it } from "vitest"

import {
  assertDecodedImageWithinLimits,
  DecodedImageResourceLimitError,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { MAX_IMAGE_DIMENSION_PX } from "@/src/constants/timeouts"

const dimensionLedger = new OffscreenLiveResourceLedger()

function readDimensions(buffer: ArrayBuffer, mimeType: string) {
  return readEncodedImageDimensions(buffer, mimeType, dimensionLedger)
}

function makePngHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

function makeWebpHeader(
  format: "VP8L" | "VP8X",
  width: number,
  height: number
): ArrayBuffer {
  const payloadSize = format === "VP8L" ? 5 : 10
  const bytes = new Uint8Array(20 + payloadSize + (payloadSize % 2))
  const view = new DataView(bytes.buffer)
  const encoder = new TextEncoder()
  bytes.set(encoder.encode("RIFF"))
  view.setUint32(4, bytes.length - 8, true)
  bytes.set(encoder.encode("WEBP"), 8)
  bytes.set(encoder.encode(format), 12)
  view.setUint32(16, payloadSize, true)
  if (format === "VP8L") {
    bytes[20] = 0x2f
    // VP8L packs width minus one and height minus one into 14 bits each.
    view.setUint32(21, (height - 1) * 2 ** 14 + width - 1, true)
  } else {
    for (const [offset, dimension] of [
      [24, width],
      [27, height],
    ]) {
      const encoded = new Uint8Array(4)
      new DataView(encoded.buffer).setUint32(0, dimension - 1, true)
      bytes.set(encoded.subarray(0, 3), offset)
    }
  }
  return bytes.buffer
}

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

      expect(readDimensions(bytes.buffer, "image/gif")).toEqual({
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

    expect(readDimensions(bytes.buffer as ArrayBuffer, "image/png")).toEqual({
      width: 1600,
      height: 2400,
    })
  })

  it("reads the full PNG IHDR width before applying the decoded image limit", () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    const view = new DataView(bytes.buffer)
    view.setUint32(16, 65_537)
    view.setUint32(20, 512)

    const dimensions = readDimensions(bytes.buffer, "image/png")

    expect(dimensions).toEqual({ width: 65_537, height: 512 })
    expect(() =>
      assertDecodedImageWithinLimits(dimensions.width, dimensions.height, "PNG")
    ).toThrow(DecodedImageResourceLimitError)
  })

  it.each([
    ["VP8L", 1025],
    ["VP8X", 514],
  ] as const)(
    "preserves %s height bytes before resource admission",
    (format, height) => {
      const dimensions = readDimensions(
        makeWebpHeader(format, 258, height),
        "image/webp"
      )

      expect(dimensions).toEqual({ width: 258, height })
      expect(() =>
        assertDecodedImageWithinLimits(
          dimensions.width,
          dimensions.height,
          "WebP"
        )
      ).not.toThrow()
    }
  )

  it.each([
    [0, 512],
    [512, 0],
  ])("rejects an encoded PNG with dimensions %d×%d", (width, height) => {
    const dimensions = readDimensions(makePngHeader(width, height), "image/png")

    expect(() =>
      assertDecodedImageWithinLimits(dimensions.width, dimensions.height, "PNG")
    ).toThrow(DecodedImageResourceLimitError)
  })

  it.each([
    [MAX_IMAGE_DIMENSION_PX, 1],
    [1, MAX_IMAGE_DIMENSION_PX],
  ])("admits a PNG at the inclusive dimension cap %d×%d", (width, height) => {
    const dimensions = readDimensions(makePngHeader(width, height), "image/png")

    expect(dimensions).toEqual({ width, height })
    expect(() =>
      assertDecodedImageWithinLimits(dimensions.width, dimensions.height, "PNG")
    ).not.toThrow()
  })

  it("reads JPEG prefix dimensions from SOF when APP data contains IHDR", () => {
    const bytes = new Uint8Array(47)
    const view = new DataView(bytes.buffer)
    bytes.set([0xff, 0xd8, 0xff, 0xef, 0, 24])
    // APP15 data is opaque; these bytes do not define PNG dimensions.
    bytes.set(new TextEncoder().encode("IHDR"), 12)
    view.setUint32(16, 1)
    view.setUint32(20, 1)
    bytes.set([0xff, 0xc0, 0, 17, 8], 28)
    view.setUint16(33, 8192)
    view.setUint16(35, 8192)
    bytes[37] = 3
    bytes.set([1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 38)

    const dimensions = readDimensions(bytes.buffer, "image/jpeg")

    expect(dimensions).toEqual({ width: 8192, height: 8192 })
    expect(() =>
      assertDecodedImageWithinLimits(
        dimensions.width,
        dimensions.height,
        "JPEG"
      )
    ).toThrow(DecodedImageResourceLimitError)
  })

  it("reads GIF logical dimensions when comment data contains a WebP header", () => {
    const bytes = new Uint8Array(79)
    const view = new DataView(bytes.buffer)
    bytes.set(new TextEncoder().encode("GIF89a"))
    view.setUint16(6, 2048, true)
    view.setUint16(8, 17_751, true)
    // No global palette; a comment holds data resembling two WebP chunks.
    bytes.set([0x42, 0x50, 0, 0x21, 0xfe, 40], 10)
    view.setUint32(16, 10, true)
    bytes.set(new TextEncoder().encode("VP8X"), 30)
    view.setUint32(34, 10, true)
    bytes[56] = 0
    // The complete local-palette image is 1×1 within the larger logical screen.
    bytes.set(
      [
        0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x80, 0, 0, 0, 255, 255, 255, 2, 2, 0x44,
        1, 0, 0x3b,
      ],
      57
    )

    const dimensions = readDimensions(bytes.buffer, "image/gif")

    expect(dimensions).toEqual({ width: 2048, height: 17_751 })
    expect(() =>
      assertDecodedImageWithinLimits(dimensions.width, dimensions.height, "GIF")
    ).toThrow(DecodedImageResourceLimitError)
  })

  it.each([0xc0, 0xc2])(
    "reads baseline/progressive JPEG SOF marker 0x%02x",
    (marker) => {
      const bytes = makeJpegFrame(marker, 1600, 2400)
      expect(readDimensions(bytes.buffer as ArrayBuffer, "image/jpeg")).toEqual(
        {
          width: 1600,
          height: 2400,
        }
      )
    }
  )

  it("handles fill, TEM, and restart markers before a JPEG frame", () => {
    const bytes = makeJpegFrame(0xc0, 320, 240, [0xff, 0xff, 0x01, 0xff, 0xd0])
    expect(readDimensions(bytes.buffer as ArrayBuffer, "image/jpeg")).toEqual({
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
    expect(() => readDimensions(bytes.buffer, "image/jpeg")).toThrow(
      "dimensions are unavailable"
    )
  })

  it("does not treat entropy SOF-like bytes as metadata", () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0,
    ])
    expect(() => readDimensions(bytes.buffer, "image/jpeg")).toThrow(
      "dimensions are unavailable"
    )
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
    expect(() => readDimensions(bytes.buffer, "image/jpeg")).toThrow(
      "dimensions are unavailable"
    )
  })

  it("rejects truncated AVIF metadata", () => {
    const bytes = new Uint8Array(48)
    new DataView(bytes.buffer).setUint32(0, 24)
    bytes.set([0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4)
    bytes.set([0x61, 0x76, 0x69, 0x66], 16)
    bytes.set([0x69, 0x73, 0x70, 0x65], 28)
    new DataView(bytes.buffer).setUint32(36, 1200)
    new DataView(bytes.buffer).setUint32(40, 1800)

    expect(() => readDimensions(bytes.buffer, "image/avif")).toThrow(
      "dimensions are unavailable"
    )
  })

  it("reads AVIF dimensions within the bounded metadata prefix", () => {
    const bytes = new Uint8Array(106)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 24)
    bytes.set([0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4)
    bytes.set([0x61, 0x76, 0x69, 0x66], 16)
    view.setUint32(24, 82)
    bytes.set([0x6d, 0x65, 0x74, 0x61], 28)
    view.setUint32(36, 56)
    bytes.set([0x69, 0x70, 0x72, 0x70], 40)
    view.setUint32(44, 28)
    bytes.set([0x69, 0x70, 0x63, 0x6f], 48)
    view.setUint32(52, 20)
    bytes.set([0x69, 0x73, 0x70, 0x65], 56)
    view.setUint32(64, 1200)
    view.setUint32(68, 1800)
    // Primary item 1 uses the first ipco property (ispe).
    view.setUint32(72, 20)
    bytes.set([0x69, 0x70, 0x6d, 0x61], 76)
    view.setUint32(84, 1)
    view.setUint16(88, 1)
    bytes.set([1, 1], 90)
    view.setUint32(92, 14)
    bytes.set([0x70, 0x69, 0x74, 0x6d], 96)
    view.setUint16(104, 1)

    expect(readDimensions(bytes.buffer, "image/avif")).toEqual({
      width: 1200,
      height: 1800,
    })
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
