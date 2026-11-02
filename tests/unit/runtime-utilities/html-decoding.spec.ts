import { describe, expect, it, vi } from "vitest"
import {
  decodeHtmlBytes,
  readResponseBytes,
  ResponseBodyLimitError,
} from "@/src/shared/html-response-decoder"

describe("declared HTML byte decoding", () => {
  it("decodes a UTF-16BE BOM before a conflicting header", () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0, 0x41, 0x4e, 0x2d])
    expect(
      decodeHtmlBytes(bytes, { contentType: "text/html; charset=utf-8" })
    ).toEqual({ html: "A中", encoding: "utf-16be", source: "bom" })
  })

  it("does not accept a partial UTF-8 BOM as an encoding declaration", () => {
    expect(() => decodeHtmlBytes(new Uint8Array([0xef, 0xbb]))).toThrow(
      "no supported charset"
    )
  })

  it("keeps a meta declaration outside the scan budget unavailable", () => {
    const bytes = new TextEncoder().encode(
      " ".repeat(32) + '<meta charset="utf-8">'
    )
    expect(() => decodeHtmlBytes(bytes, { scanByteLimit: 32 })).toThrow(
      "no supported charset"
    )
    expect(decodeHtmlBytes(bytes, { scanByteLimit: bytes.length }).source).toBe(
      "meta"
    )
  })

  it("counts UTF-8 bytes for unstreamed text fallback responses", async () => {
    const response = {
      headers: new Headers(),
      body: null,
      text: async () => "中",
    } as unknown as Response
    await expect(readResponseBytes(response, 2)).rejects.toBeInstanceOf(
      ResponseBodyLimitError
    )
    await expect(readResponseBytes(response, 3)).resolves.toEqual(
      new Uint8Array([0xe4, 0xb8, 0xad])
    )
  })

  it("keeps the original body limit when cancellation throws synchronously", async () => {
    const response = {
      headers: new Headers({ "content-length": "9" }),
      body: {
        cancel: vi.fn(() => {
          throw new Error("cancel failed")
        }),
      },
    } as unknown as Response
    await expect(readResponseBytes(response, 3)).rejects.toBeInstanceOf(
      ResponseBodyLimitError
    )
  })
  it("reads unstreamed script bytes through their binary transport", async () => {
    const bytes = new Uint8Array([0xff, 0x80, 0x61])
    const response = {
      headers: new Headers({ "content-type": "application/javascript" }),
      body: null,
      arrayBuffer: async () => bytes.buffer,
      text: () => {
        throw new Error("text decoding loses script bytes")
      },
    } as unknown as Response
    await expect(readResponseBytes(response, 3)).resolves.toEqual(bytes)
    await expect(readResponseBytes(response, 2)).rejects.toBeInstanceOf(
      ResponseBodyLimitError
    )
  })

  it("bounds the serialized UTF-8 bytes of an unstreamed JSON response", async () => {
    const response = {
      headers: new Headers(),
      body: null,
      json: async () => ({ title: "中" }),
    } as unknown as Response
    const bytes = await readResponseBytes(response, 15)
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({ title: "中" })
    await expect(readResponseBytes(response, 14)).rejects.toBeInstanceOf(
      ResponseBodyLimitError
    )
  })
})
