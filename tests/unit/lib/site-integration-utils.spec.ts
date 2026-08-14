import { describe, expect, it } from "vitest"

import {
  normalizeAllowedImageMimeType,
  parseChapterNumber,
  parseRateLimitRetryAfterHeader,
  parseVolumeInfo,
  sanitizeLabel,
} from "@/src/shared/site-integration-utils"

describe("site integration utils", () => {
  describe("sanitizeLabel", () => {
    it("removes control characters and normalizes whitespace", () => {
      const input = "  Chapter\u0000\u0007   12\n\tSpecial  "
      expect(sanitizeLabel(input)).toBe("Chapter 12 Special")
    })

    it("strips embedded null bytes", () => {
      expect(sanitizeLabel("Chapter\x0012")).toBe("Chapter 12")
      expect(sanitizeLabel("a\x00b\x00c")).toBe("a b c")
    })

    it("strips backspace, bell, and vertical tab characters", () => {
      expect(sanitizeLabel("Ch\x08apter")).toBe("Ch apter")
      expect(sanitizeLabel("Ch\x07apter")).toBe("Ch apter")
      expect(sanitizeLabel("Ch\x0Bapter")).toBe("Ch apter")
      expect(sanitizeLabel("a\x07b\x08c\x0Bd")).toBe("a b c d")
    })

    it("returns empty string for input with only control characters", () => {
      expect(sanitizeLabel("\x00\x01\x02\x03\x04\x05")).toBe("")
      expect(sanitizeLabel("\x07\x08\x0B\x0C\x0E\x0F")).toBe("")
      expect(sanitizeLabel("\x00")).toBe("")
      expect(sanitizeLabel("\x7F")).toBe("")
    })

    it("preserves printable characters when mixed with control characters", () => {
      expect(sanitizeLabel("Hello\x00World")).toBe("Hello World")
      expect(sanitizeLabel("A\x01B\x02C\x03D")).toBe("A B C D")
      expect(sanitizeLabel("keep\x7Fthis")).toBe("keep this")
    })

    it("returns empty string for empty input", () => {
      expect(sanitizeLabel("")).toBe("")
    })

    it("preserves unicode text (CJK and emoji)", () => {
      expect(sanitizeLabel("第１話")).toBe("第１話")
      expect(sanitizeLabel("ファイル名")).toBe("ファイル名")
      expect(sanitizeLabel("Chapter🔥01")).toBe("Chapter🔥01")
      expect(sanitizeLabel("第\x001話")).toBe("第 1話")
    })

    it("strips ANSI escape sequence escape character", () => {
      expect(sanitizeLabel("\x1B[31mred\x1B[0m")).toBe("[31mred [0m")
      expect(sanitizeLabel("\x1B[0mtext")).toBe("[0mtext")
    })
  })

  describe("normalizeAllowedImageMimeType", () => {
    it("accepts image/png and returns it lowercased", () => {
      expect(normalizeAllowedImageMimeType("image/png")).toBe("image/png")
      expect(normalizeAllowedImageMimeType("IMAGE/PNG")).toBe("image/png")
    })

    it("accepts image/jpeg", () => {
      expect(normalizeAllowedImageMimeType("image/jpeg")).toBe("image/jpeg")
    })

    it("accepts image/webp", () => {
      expect(normalizeAllowedImageMimeType("image/webp")).toBe("image/webp")
    })

    it("accepts image/gif", () => {
      expect(normalizeAllowedImageMimeType("image/gif")).toBe("image/gif")
    })

    it("rejects image/avif until bounded dimension support exists", () => {
      expect(() => normalizeAllowedImageMimeType("image/avif")).toThrow(
        "Unsupported MIME type"
      )
    })

    it("rejects text/html", () => {
      expect(() => normalizeAllowedImageMimeType("text/html")).toThrow(
        "Unsupported MIME type"
      )
    })

    it("rejects application/javascript", () => {
      expect(() =>
        normalizeAllowedImageMimeType("application/javascript")
      ).toThrow("Unsupported MIME type")
    })

    it("rejects image/svg+xml (SVG blocked for security)", () => {
      expect(() => normalizeAllowedImageMimeType("image/svg+xml")).toThrow(
        "Unsupported MIME type"
      )
    })

    it("handles MIME with parameters by extracting the base type", () => {
      expect(normalizeAllowedImageMimeType("image/png; charset=utf-8")).toBe(
        "image/png"
      )
      expect(
        normalizeAllowedImageMimeType("image/jpeg; boundary=something")
      ).toBe("image/jpeg")
    })

    it("rejects empty string", () => {
      expect(() => normalizeAllowedImageMimeType("")).toThrow(
        "Unsupported MIME type: missing"
      )
    })

    it("rejects null", () => {
      expect(() => normalizeAllowedImageMimeType(null)).toThrow(
        "Unsupported MIME type: missing"
      )
    })

    it("rejects undefined", () => {
      expect(() => normalizeAllowedImageMimeType(undefined)).toThrow(
        "Unsupported MIME type: missing"
      )
    })

    it("rejects MIME injection with CRLF header smuggling", () => {
      expect(() =>
        normalizeAllowedImageMimeType("image/png\r\nX-Injected: header")
      ).toThrow("Unsupported MIME type")
    })
  })

  describe("parseChapterNumber", () => {
    it("extracts decimal chapter numbers from labels", () => {
      expect(parseChapterNumber("Chapter 12.5 - Bonus")).toBe(12.5)
    })

    it("extracts chapter numbers from full-width numerals", () => {
      expect(parseChapterNumber("第１話")).toBe(1)
    })

    it("returns undefined for labels without numeric value", () => {
      expect(parseChapterNumber("Extra chapter")).toBeUndefined()
    })
  })

  describe("parseVolumeInfo", () => {
    it("parses volume number and keeps normalized label", () => {
      expect(parseVolumeInfo("  Vol. 03  ")).toEqual({
        volumeLabel: "Vol. 03",
        volumeNumber: 3,
      })
    })

    it("parses full-width volume numerals and keeps normalized label", () => {
      expect(parseVolumeInfo("第３巻")).toEqual({
        volumeLabel: "第３巻",
        volumeNumber: 3,
      })
    })

    it("returns only volumeLabel when no numeric volume is present", () => {
      expect(parseVolumeInfo("Special Edition")).toEqual({
        volumeLabel: "Special Edition",
      })
    })
  })

  describe("parseRateLimitRetryAfterHeader", () => {
    it("returns null when headers are empty or missing relevant fields", () => {
      expect(parseRateLimitRetryAfterHeader({})).toBeNull()
      expect(
        parseRateLimitRetryAfterHeader({ "Content-Type": "application/json" })
      ).toBeNull()
    })

    it("parses standard HTTP Retry-After relative seconds", () => {
      expect(parseRateLimitRetryAfterHeader({ "Retry-After": "120" })).toBe(
        120000
      )
      expect(parseRateLimitRetryAfterHeader({ "retry-after": "5" })).toBe(5000)
    })

    it("parses standard HTTP Retry-After HTTP-dates", () => {
      const futureDate = new Date(Date.now() + 10000).toUTCString()
      const delayMs = parseRateLimitRetryAfterHeader({
        "Retry-After": futureDate,
      })
      expect(delayMs).toBeGreaterThan(8000)
      expect(delayMs).toBeLessThanOrEqual(10000)
    })

    it("parses custom X-RateLimit-Retry-After UNIX timestamps", () => {
      const futureUnixSec = Math.floor(Date.now() / 1000) + 30
      const delayMs = parseRateLimitRetryAfterHeader({
        "X-RateLimit-Retry-After": String(futureUnixSec),
      })
      expect(delayMs).toBeGreaterThan(25000)
      expect(delayMs).toBeLessThanOrEqual(30000)
    })

    it("applies clampFn to the parsed duration", () => {
      const clampFn = (ms: number) => Math.min(ms, 60000)
      expect(
        parseRateLimitRetryAfterHeader({ "Retry-After": "120" }, clampFn)
      ).toBe(60000)
    })

    it("supports Headers object interface via get() method", () => {
      const mockHeaders = {
        get: (name: string) => {
          if (name === "X-RateLimit-Retry-After") return "1609459200"
          return null
        },
      }
      expect(parseRateLimitRetryAfterHeader(mockHeaders)).not.toBeNull()
    })
  })
})
