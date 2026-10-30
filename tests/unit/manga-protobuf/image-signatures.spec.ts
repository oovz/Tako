import { describe, expect, it } from "vitest"
import { detectImageMimeTypeAndExt } from "@/src/site-integrations/mangamillion/crypto"

function fileType(brand: string, size = 24): Uint8Array {
  const bytes = new Uint8Array(24)
  new DataView(bytes.buffer).setUint32(0, size)
  bytes.set(new TextEncoder().encode(`ftyp${brand}`), 4)
  return bytes
}

describe("MangaMillion image signature admission", () => {
  it.each(["GIF87a", "GIF89a"])("accepts the %s image header", (header) => {
    expect(detectImageMimeTypeAndExt(new TextEncoder().encode(header))).toEqual(
      { mimeType: "image/gif", extension: ".gif" }
    )
  })

  it("finds an AVIF compatible brand after an unrecognized major brand", () => {
    const bytes = fileType("mif1")
    bytes.set(new TextEncoder().encode("avif"), 20)
    expect(detectImageMimeTypeAndExt(bytes)).toEqual({
      mimeType: "image/avif",
      extension: ".avif",
    })
  })

  it.each([
    fileType("mif1"),
    fileType("avif", 12),
    fileType("avif", 28),
    fileType("avif").subarray(0, 14),
  ])("rejects unsupported or truncated AVIF file-type boxes", (bytes) => {
    expect(() => detectImageMimeTypeAndExt(bytes)).toThrow(/signature/)
  })
})
