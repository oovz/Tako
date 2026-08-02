import { describe, expect, it } from "vitest"

import {
  assertDecodedImageWithinLimits,
  DecodedImageResourceLimitError,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"

describe("decoded image resource limits", () => {
  it("reads PNG dimensions without decoding the image", () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    new DataView(bytes.buffer).setUint32(16, 1600)
    new DataView(bytes.buffer).setUint32(20, 2400)

    expect(readEncodedImageDimensions(bytes.buffer, "image/png")).toEqual({
      width: 1600,
      height: 2400,
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
