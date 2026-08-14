import { describe, expect, it } from "vitest"
import { getExtensionFromMimeType } from "@/src/shared/filename-sanitizer"

export function registerMimeTypeExtensionCases(): void {
  describe("getExtensionFromMimeType", () => {
    describe("accepted image MIME types", () => {
      it("detects JPEG", () => {
        expect(getExtensionFromMimeType("image/jpeg")).toBe("jpg")
      })

      it("detects PNG", () => {
        expect(getExtensionFromMimeType("image/png")).toBe("png")
      })

      it("detects WebP", () => {
        expect(getExtensionFromMimeType("image/webp")).toBe("webp")
      })

      it("detects GIF", () => {
        expect(getExtensionFromMimeType("image/gif")).toBe("gif")
      })
    })

    it.each(["", "application/pdf", "text/html", "image/unknown"])(
      "rejects unsupported MIME type %j",
      (mimeType) => {
        expect(() => getExtensionFromMimeType(mimeType)).toThrow(
          "Unsupported image MIME type"
        )
      }
    )

    it("does not normalize case or parameters inside the filename helper", () => {
      expect(() => getExtensionFromMimeType("IMAGE/PNG")).toThrow(
        "Unsupported image MIME type"
      )
      expect(() =>
        getExtensionFromMimeType("image/png; charset=utf-8")
      ).toThrow("Unsupported image MIME type")
    })
  })
}
