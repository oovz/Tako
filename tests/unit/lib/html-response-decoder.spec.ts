import { describe, expect, it, vi } from "vitest"

import {
  decodeHtmlBytes,
  decodeHtmlResponse,
  readResponseBytes,
  ResponseBodyLimitError,
} from "@/src/shared/html-response-decoder"

describe("html response decoder", () => {
  describe("decodeHtmlResponse", () => {
    it("rejects a response body that exceeds the configured byte limit", async () => {
      const response = new Response("<html>too large</html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })

      await expect(
        decodeHtmlResponse(response, { maxBytes: 4 })
      ).rejects.toBeInstanceOf(ResponseBodyLimitError)
    })

    it("cancels a body rejected by Content-Length before throwing the limit", async () => {
      const cancel = vi.fn(async () => undefined)
      const response = {
        headers: { get: () => "9" },
        body: { cancel },
      } as unknown as Response

      await expect(readResponseBytes(response, 4)).rejects.toBeInstanceOf(
        ResponseBodyLimitError
      )
      expect(cancel).toHaveBeenCalledWith(expect.any(ResponseBodyLimitError))
    })

    it("preserves a streaming limit when reader cancellation rejects", async () => {
      const reader = {
        read: vi.fn(async () => ({
          done: false,
          value: new Uint8Array([1, 2, 3, 4, 5]),
        })),
        cancel: vi.fn(async () => {
          throw new Error("cancel failed")
        }),
        releaseLock: vi.fn(),
      }
      const response = {
        headers: { get: () => null },
        body: { getReader: () => reader },
      } as unknown as Response

      await expect(readResponseBytes(response, 4)).rejects.toBeInstanceOf(
        ResponseBodyLimitError
      )
      expect(reader.cancel).toHaveBeenCalledWith(
        expect.any(ResponseBodyLimitError)
      )
      expect(reader.releaseLock).toHaveBeenCalled()
    })
  })

  describe("decodeHtmlBytes", () => {
    it("throws when no charset declaration is present", () => {
      const bytes = new TextEncoder().encode("<html><body>hello</body></html>")
      expect(() => decodeHtmlBytes(bytes)).toThrow(
        "no supported charset declaration"
      )
    })

    it("uses BOM-detected encoding (UTF-8)", () => {
      const content = "<html><body>hello</body></html>"
      const encoded = new TextEncoder().encode(content)
      const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoded])
      const result = decodeHtmlBytes(bytes)
      expect(result.encoding).toBe("utf-8")
      expect(result.source).toBe("bom")
      expect(result.html).toBe(content)
    })

    it("uses BOM-detected encoding (UTF-16LE)", () => {
      const content = "<html><body>hello</body></html>"
      const utf16le = new Uint16Array(content.length)
      for (let i = 0; i < content.length; i += 1) {
        utf16le[i] = content.charCodeAt(i)
      }
      const bytes = new Uint8Array(2 + utf16le.byteLength)
      bytes[0] = 0xff
      bytes[1] = 0xfe
      bytes.set(new Uint8Array(utf16le.buffer), 2)
      const result = decodeHtmlBytes(bytes)
      expect(result.encoding).toBe("utf-16le")
      expect(result.source).toBe("bom")
      expect(result.html).toBe(content)
    })

    it("uses charset from Content-Type header", () => {
      const content = "<html><body>hello</body></html>"
      const bytes = new TextEncoder().encode(content)
      const result = decodeHtmlBytes(bytes, {
        contentType: "text/html; charset=utf-8",
      })
      expect(result.encoding).toBe("utf-8")
      expect(result.source).toBe("header")
      expect(result.html).toBe(content)
    })

    it("uses charset from <meta> tag", () => {
      const content =
        '<html><head><meta charset="utf-8"></head><body>hello</body></html>'
      const bytes = new TextEncoder().encode(content)
      const result = decodeHtmlBytes(bytes)
      expect(result.encoding).toBe("utf-8")
      expect(result.source).toBe("meta")
      expect(result.html).toBe(content)
    })

    it("uses charset from <meta http-equiv> tag", () => {
      const content =
        '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>hello</body></html>'
      const bytes = new TextEncoder().encode(content)
      const result = decodeHtmlBytes(bytes)
      expect(result.encoding).toBe("utf-8")
      expect(result.source).toBe("meta")
      expect(result.html).toBe(content)
    })

    it("prefers BOM over conflicting Content-Type charset", () => {
      const content = "<html><body>hello</body></html>"
      const encoded = new TextEncoder().encode(content)
      const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoded])
      const result = decodeHtmlBytes(bytes, {
        contentType: "text/html; charset=iso-8859-1",
      })
      expect(result.encoding).toBe("utf-8")
      expect(result.source).toBe("bom")
    })

    it("prefers BOM over conflicting <meta> charset", () => {
      const content =
        '<html><head><meta charset="iso-8859-1"></head><body>hello</body></html>'
      const encoded = new TextEncoder().encode(content)
      const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoded])
      const result = decodeHtmlBytes(bytes)
      expect(result.encoding).toBe("utf-8")
      expect(result.source).toBe("bom")
    })

    it("prefers Content-Type header over <meta> charset", () => {
      const content =
        '<html><head><meta charset="iso-8859-1"></head><body>hello</body></html>'
      const bytes = new TextEncoder().encode(content)
      const result = decodeHtmlBytes(bytes, {
        contentType: "text/html; charset=utf-8",
      })
      expect(result.encoding).toBe("utf-8")
      expect(result.source).toBe("header")
    })

    it("handles unsupported charset gracefully by throwing", () => {
      const content = "<html><body>hello</body></html>"
      const bytes = new TextEncoder().encode(content)
      expect(() =>
        decodeHtmlBytes(bytes, {
          contentType: "text/html; charset=encoding-that-doesnt-exist",
        })
      ).toThrow("Failed to decode HTML response")
    })

    it("throws clear message when declared charset cannot decode the bytes", () => {
      const bytes = new Uint8Array([0xff, 0x80, 0xc1])
      expect(() =>
        decodeHtmlBytes(bytes, { contentType: "text/html; charset=utf-8" })
      ).toThrow("Failed to decode HTML response")
    })
  })

  it("returns the body-limit error without waiting for a hanging cancellation", async () => {
    const reader = {
      read: vi.fn(async () => ({
        done: false,
        value: new Uint8Array([1, 2, 3, 4, 5]),
      })),
      cancel: vi.fn(() => new Promise<void>(() => undefined)),
      releaseLock: vi.fn(),
    }
    const response = {
      headers: { get: () => null },
      body: { getReader: () => reader },
    } as unknown as Response

    const result = readResponseBytes(response, 4)
    await expect(
      Promise.race([
        result,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("readResponseBytes hung")), 50)
        ),
      ])
    ).rejects.toBeInstanceOf(ResponseBodyLimitError)
    expect(reader.releaseLock).toHaveBeenCalled()
  })
})
