import { describe, expect, it } from "vitest"

import {
  buildCoverOutputFilename,
  buildImageOutputFilename,
} from "@/entrypoints/offscreen/chapter-processing-helpers"

describe("chapter output filename contracts", () => {
  it.each([
    ["image/gif", "page.gif", "001-page.gif"],
    ["image/jpeg", "page.jpeg", "001-page.jpg"],
    ["image/png", "page.png", "001-page.png"],
    ["image/webp", "page.webp", "001-page.webp"],
  ])("replaces the source extension for %s", (mimeType, source, expected) => {
    expect(
      buildImageOutputFilename({
        index: 0,
        totalImages: 1,
        originalFilename: source,
        mimeType,
        normalizeImageFilenames: false,
        imagePaddingDigits: "auto",
      })
    ).toBe(expected)
  })

  it("keeps normalized names canonical and preserves GIF covers", () => {
    expect(
      buildImageOutputFilename({
        index: 4,
        totalImages: 12,
        originalFilename: "ignored.jpg",
        mimeType: "image/gif; charset=binary",
        normalizeImageFilenames: true,
        imagePaddingDigits: "auto",
      })
    ).toBe("05.gif")
    expect(buildCoverOutputFilename("image/gif")).toBe("000-cover.gif")
  })

  it("fails closed for an unsupported output MIME type", () => {
    expect(() => buildCoverOutputFilename("image/avif")).toThrow(
      "Unsupported MIME type"
    )
    expect(() =>
      buildImageOutputFilename({
        index: 0,
        totalImages: 1,
        originalFilename: "page",
        mimeType: "application/octet-stream",
        normalizeImageFilenames: false,
        imagePaddingDigits: "auto",
      })
    ).toThrow("Unsupported MIME type")
  })
})
