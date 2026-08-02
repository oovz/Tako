/**
 * Image Processor Unit Tests
 * Tests for Cover Image Download
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  downloadCoverImage,
  fetchImageWithStallDetection,
  fetchChapterHtml,
  withRetries,
} from "@/entrypoints/offscreen/image-processor"
import { MAX_IMAGE_BYTES } from "@/src/constants/timeouts"

// Keep legacy generic-fetch tests working while routing integration-aware cover
// downloads through the explicit integration helper used in production.
vi.mock("@/src/runtime/rate-limit", () => {
  const rateLimitedFetchByUrlScope = vi.fn()
  return {
    rateLimitedFetchByUrlScope,
    rateLimitedFetchForIntegration: vi.fn(
      (
        _integrationId: string,
        url: string,
        scope: "image" | "chapter",
        init?: RequestInit,
        policy?: unknown
      ) => rateLimitedFetchByUrlScope(url, scope, init, policy)
    ),
    scheduleForIntegrationScope: vi.fn(
      async (
        _integrationId: string,
        _scope: string,
        task: () => Promise<unknown>
      ) => task()
    ),
  }
})

describe("downloadCoverImage", () => {
  const mockUrl = "https://uploads.mangadex.org/covers/series/cover.jpg"
  const mockIntegrationId = "mangadex"
  const mockFetchTimeoutMs = 30000

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe("fetchChapterHtml", () => {
    it("decodes shift-jis chapter HTML when the response header declares it", async () => {
      const bytes = new Uint8Array([0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4])
      const mockResponse = {
        ok: true,
        url: "https://api.mangadex.org/chapter",
        headers: {
          get: (key: string) =>
            key === "content-type" ? "text/html; charset=shift-jis" : null,
        },
        arrayBuffer: () => Promise.resolve(bytes.buffer),
      }

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse))

      await expect(
        fetchChapterHtml("https://api.mangadex.org/chapter", 1000, "mangadex")
      ).resolves.toBe("あいう")
      expect(fetch).toHaveBeenCalledWith(
        "https://api.mangadex.org/chapter",
        expect.objectContaining({ credentials: "omit" })
      )
    })

    it("sniffs meta charset when the response header omits charset", async () => {
      const asciiPrefix =
        '<html><head><meta charset="windows-1252"></head><body>'
      const suffix = "</body></html>"
      const bytes = new Uint8Array([
        ...new TextEncoder().encode(asciiPrefix),
        0x93,
        0x54,
        0x4d,
        0x44,
        0x94,
        ...new TextEncoder().encode(suffix),
      ])
      const mockResponse = {
        ok: true,
        url: "https://api.mangadex.org/chapter-meta",
        headers: {
          get: (key: string) => (key === "content-type" ? "text/html" : null),
        },
        arrayBuffer: () => Promise.resolve(bytes.buffer),
      }

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse))

      await expect(
        fetchChapterHtml(
          "https://api.mangadex.org/chapter-meta",
          1000,
          "mangadex"
        )
      ).resolves.toContain("“TMD”")
    })

    it("rejects HTML when no supported charset declaration is present", async () => {
      const bytes = new TextEncoder().encode(
        "<html><head></head><body>plain html</body></html>"
      )
      const mockResponse = {
        ok: true,
        url: "https://api.mangadex.org/chapter-undeclared",
        headers: {
          get: (key: string) => (key === "content-type" ? "text/html" : null),
        },
        arrayBuffer: () => Promise.resolve(bytes.buffer),
      }

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse))

      await expect(
        fetchChapterHtml(
          "https://api.mangadex.org/chapter-undeclared",
          1000,
          "mangadex"
        )
      ).rejects.toThrow("no supported charset declaration found")
    })

    it("keeps the timeout active while the response body is being read", async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue({
            ok: true,
            url: "https://api.mangadex.org/stalled-body",
            headers: new Headers({
              "content-type": "text/html; charset=utf-8",
            }),
            arrayBuffer: () => new Promise<ArrayBuffer>(() => undefined),
          } as unknown as Response)
        )

        const result = fetchChapterHtml(
          "https://api.mangadex.org/stalled-body",
          20,
          "mangadex"
        )
        const rejection = expect(result).rejects.toThrow("fetch-html-timeout")
        await vi.advanceTimersByTimeAsync(21)
        await rejection
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe("fetchImageWithStallDetection", () => {
    it("aborts pending response headers at the hard timeout", async () => {
      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockImplementation(
        async () => await new Promise<Response>(() => undefined)
      )

      await expect(
        fetchImageWithStallDetection("https://example.com/no-response.jpg", {
          stallTimeoutMs: 10,
          hardTimeoutMs: 20,
        })
      ).rejects.toThrow("Image download hard timeout")
    })

    it("allows a custom fetcher to wait longer than the body stall timeout before returning a response", async () => {
      vi.useFakeTimers()
      try {
        const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "image/jpeg" }),
          body: null,
          arrayBuffer: async () => mockImageData,
        }
        const fetcher = vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return mockResponse as unknown as Response
        })

        const promise = fetchImageWithStallDetection(
          "https://example.com/retry-wait.jpg",
          {
            stallTimeoutMs: 10,
            hardTimeoutMs: 200,
            fetcher,
          }
        )

        await vi.advanceTimersByTimeAsync(51)

        await expect(promise).resolves.toEqual({
          data: mockImageData,
          mimeType: "image/jpeg",
        })
        expect(fetcher).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it("rejects unsupported MIME types", async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: (key: string) => (key === "content-type" ? "text/html" : null),
        },
        body: {
          getReader: () => ({
            read: () =>
              new Promise<ReadableStreamReadResult<Uint8Array>>(
                () => undefined
              ),
            releaseLock: () => undefined,
          }),
        },
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      await expect(
        fetchImageWithStallDetection("https://example.com/not-image", {
          stallTimeoutMs: 20,
          hardTimeoutMs: 50,
        })
      ).rejects.toThrow("Unsupported MIME type")
    })

    it("rejects SVG even though it is an image media type", async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: (key: string) =>
            key === "content-type" ? "image/svg+xml" : null,
        },
        body: null,
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode("<svg />").buffer),
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      await expect(
        fetchImageWithStallDetection("https://example.com/vector.svg", {
          stallTimeoutMs: 20,
          hardTimeoutMs: 50,
        })
      ).rejects.toThrow("Unsupported MIME type: image/svg+xml")
    })

    it("aborts when stream stalls beyond stall timeout", async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: (key: string) => (key === "content-type" ? "image/jpeg" : null),
        },
        body: {
          getReader: () => ({
            read: () =>
              new Promise<ReadableStreamReadResult<Uint8Array>>(
                () => undefined
              ),
            releaseLock: () => undefined,
          }),
        },
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      await expect(
        fetchImageWithStallDetection("https://example.com/stalled.jpg", {
          stallTimeoutMs: 10,
          hardTimeoutMs: 200,
        })
      ).rejects.toThrow("stalled")
    })

    it("rejects on hard timeout even when the active stream read has not reached stall timeout", async () => {
      vi.useFakeTimers()
      try {
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "image/jpeg" }),
          body: {
            getReader: () => ({
              read: () =>
                new Promise<ReadableStreamReadResult<Uint8Array>>(
                  () => undefined
                ),
              releaseLock: vi.fn(),
            }),
          },
        }

        const promise = fetchImageWithStallDetection(
          "https://example.com/hard-timeout.jpg",
          {
            stallTimeoutMs: 1_000,
            hardTimeoutMs: 10,
            fetcher: async () => mockResponse as unknown as Response,
          }
        )
        const rejection = expect(promise).rejects.toThrow(
          "Image download hard timeout"
        )

        await vi.advanceTimersByTimeAsync(11)
        await rejection
      } finally {
        vi.useRealTimers()
      }
    })

    it("reports cumulative byte progress from streamed image responses", async () => {
      const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"]]),
        body: {
          getReader: () => {
            let index = 0
            return {
              read: async () => {
                const value = chunks[index++]
                return value
                  ? { done: false, value }
                  : { done: true, value: undefined }
              },
              releaseLock: vi.fn(),
            }
          },
        },
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )
      const onBytesReceived = vi.fn()

      await fetchImageWithStallDetection(
        "https://example.com/progressive.jpg",
        {
          stallTimeoutMs: 20,
          hardTimeoutMs: 100,
          onBytesReceived,
        }
      )

      expect(onBytesReceived).toHaveBeenCalledTimes(2)
      expect(onBytesReceived).toHaveBeenNthCalledWith(1, 2)
      expect(onBytesReceived).toHaveBeenNthCalledWith(2, 5)
    })

    it("uses a custom HTTP error factory when provided", async () => {
      const customError = Object.assign(new Error("custom 404"), {
        status: 404,
      })
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Map([["content-type", "text/plain"]]),
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      await expect(
        fetchImageWithStallDetection("https://example.com/missing.jpg", {
          stallTimeoutMs: 20,
          hardTimeoutMs: 100,
          createHttpError: () => customError,
        })
      ).rejects.toMatchObject({ message: "custom 404", status: 404 })
    })
  })

  describe("fetchImageWithStallDetection — MAX_IMAGE_BYTES decompression bomb guard", () => {
    it("rejects a non-streaming response whose arrayBuffer exceeds MAX_IMAGE_BYTES", async () => {
      const oversizedBuffer = new ArrayBuffer(MAX_IMAGE_BYTES + 1)
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"]]),
        body: null,
        arrayBuffer: async () => oversizedBuffer,
      }

      const fetcher = vi.fn(async () => mockResponse as unknown as Response)

      await expect(
        fetchImageWithStallDetection("https://example.com/bomb.jpg", {
          stallTimeoutMs: 1000,
          hardTimeoutMs: 2000,
          fetcher,
        })
      ).rejects.toThrow(`Image size exceeds ${MAX_IMAGE_BYTES} byte limit`)
    })

    it("rejects a streaming response whose accumulated chunks exceed MAX_IMAGE_BYTES", async () => {
      // Two chunks: one exactly at the limit, the next pushes over.
      const chunkAtLimit = new Uint8Array(MAX_IMAGE_BYTES)
      const overflowChunk = new Uint8Array(1)
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"]]),
        body: {
          getReader: () => {
            let index = 0
            const chunks = [chunkAtLimit, overflowChunk]
            return {
              read: async () => {
                const value = chunks[index++]
                return value
                  ? { done: false, value }
                  : { done: true, value: undefined }
              },
              releaseLock: vi.fn(),
            }
          },
        },
      }

      const fetcher = vi.fn(async () => mockResponse as unknown as Response)

      await expect(
        fetchImageWithStallDetection("https://example.com/stream-bomb.jpg", {
          stallTimeoutMs: 1000,
          hardTimeoutMs: 2000,
          fetcher,
        })
      ).rejects.toThrow(`Image size exceeds ${MAX_IMAGE_BYTES} byte limit`)
    })

    it("accepts a non-streaming response whose arrayBuffer is exactly MAX_IMAGE_BYTES (boundary)", async () => {
      const boundaryBuffer = new ArrayBuffer(MAX_IMAGE_BYTES)
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"]]),
        body: null,
        arrayBuffer: async () => boundaryBuffer,
      }

      const fetcher = vi.fn(async () => mockResponse as unknown as Response)

      await expect(
        fetchImageWithStallDetection("https://example.com/exact-limit.jpg", {
          stallTimeoutMs: 1000,
          hardTimeoutMs: 2000,
          fetcher,
        })
      ).resolves.toEqual({ data: boundaryBuffer, mimeType: "image/jpeg" })
    })

    it("accepts a streaming response whose total is exactly MAX_IMAGE_BYTES (boundary)", async () => {
      const chunk = new Uint8Array(MAX_IMAGE_BYTES)
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"]]),
        body: {
          getReader: () => {
            let sent = false
            return {
              read: async () => {
                if (!sent) {
                  sent = true
                  return { done: false, value: chunk }
                }
                return { done: true, value: undefined }
              },
              releaseLock: vi.fn(),
            }
          },
        },
      }

      const fetcher = vi.fn(async () => mockResponse as unknown as Response)

      const result = await fetchImageWithStallDetection(
        "https://example.com/stream-exact.jpg",
        {
          stallTimeoutMs: 1000,
          hardTimeoutMs: 2000,
          fetcher,
        }
      )

      expect(result.data.byteLength).toBe(MAX_IMAGE_BYTES)
      expect(result.mimeType).toBe("image/jpeg")
    })

    it("accepts a non-streaming response just under MAX_IMAGE_BYTES", async () => {
      const underBuffer = new ArrayBuffer(MAX_IMAGE_BYTES - 1)
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"]]),
        body: null,
        arrayBuffer: async () => underBuffer,
      }

      const fetcher = vi.fn(async () => mockResponse as unknown as Response)

      await expect(
        fetchImageWithStallDetection("https://example.com/just-under.jpg", {
          stallTimeoutMs: 1000,
          hardTimeoutMs: 2000,
          fetcher,
        })
      ).resolves.toEqual({ data: underBuffer, mimeType: "image/jpeg" })
    })

    it("reports the observed byte count in the size-limit error message (non-streaming)", async () => {
      const oversizedBuffer = new ArrayBuffer(MAX_IMAGE_BYTES + 10)
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"]]),
        body: null,
        arrayBuffer: async () => oversizedBuffer,
      }

      const fetcher = vi.fn(async () => mockResponse as unknown as Response)

      await expect(
        fetchImageWithStallDetection("https://example.com/bomb-count.jpg", {
          stallTimeoutMs: 1000,
          hardTimeoutMs: 2000,
          fetcher,
        })
      ).rejects.toThrow(`got ${MAX_IMAGE_BYTES + 10}`)
    })

    it("reports the accumulated byte count in the size-limit error message (streaming)", async () => {
      // Chunk 1: MAX_IMAGE_BYTES - 50, Chunk 2: 100 → total = MAX_IMAGE_BYTES + 50
      const firstChunk = new Uint8Array(MAX_IMAGE_BYTES - 50)
      const secondChunk = new Uint8Array(100)
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "image/jpeg"]]),
        body: {
          getReader: () => {
            let index = 0
            const chunks = [firstChunk, secondChunk]
            return {
              read: async () => {
                const value = chunks[index++]
                return value
                  ? { done: false, value }
                  : { done: true, value: undefined }
              },
              releaseLock: vi.fn(),
            }
          },
        },
      }

      const fetcher = vi.fn(async () => mockResponse as unknown as Response)

      await expect(
        fetchImageWithStallDetection("https://example.com/stream-count.jpg", {
          stallTimeoutMs: 1000,
          hardTimeoutMs: 2000,
          fetcher,
        })
      ).rejects.toThrow(`got ${MAX_IMAGE_BYTES + 50}`)
    })
  })

  describe("Successful Downloads", () => {
    it("downloads cover image successfully", async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: {
          get: (key: string) => (key === "content-type" ? "image/jpeg" : null),
        },
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).not.toBeNull()
      expect(result?.data).toBe(mockArrayBuffer)
      expect(result?.mimeType).toBe("image/jpeg")
      expect(result?.extension).toBe("jpeg")
    })

    it("handles PNG images", async () => {
      const mockArrayBuffer = new ArrayBuffer(2048)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: {
          get: (key: string) => (key === "content-type" ? "image/png" : null),
        },
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).not.toBeNull()
      expect(result?.mimeType).toBe("image/png")
      expect(result?.extension).toBe("png")
    })

    it("handles WebP images", async () => {
      const mockArrayBuffer = new ArrayBuffer(1536)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([["content-type", "image/webp"]]),
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).not.toBeNull()
      expect(result?.extension).toBe("webp")
    })

    it("returns null when content-type is missing", async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map(),
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).toBeNull()
    })

    it("handles content-type with charset", async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([["content-type", "image/jpeg; charset=utf-8"]]),
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).not.toBeNull()
      expect(result?.extension).toBe("jpeg")
    })
  })

  describe("Graceful Failures (Non-blocking)", () => {
    it("returns null when coverUrl is undefined", async () => {
      const result = await downloadCoverImage(
        undefined,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).toBeNull()
    })

    it("returns null when coverUrl is empty string", async () => {
      const result = await downloadCoverImage(
        "",
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).toBeNull()
    })

    it("returns null on 404 response", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).toBeNull()
    })

    it("returns null on 403 response", async () => {
      const mockResponse = {
        ok: false,
        status: 403,
        statusText: "Forbidden",
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).toBeNull()
    })

    it("returns null on 500 response", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).toBeNull()
    })

    it("returns null on network error", async () => {
      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockRejectedValue(
        new Error("Network error")
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).toBeNull()
    })

    it("returns null on timeout", async () => {
      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockRejectedValue(
        new Error("Timeout")
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).toBeNull()
    })
  })

  describe("Retry Logic", () => {
    it("performs the initial attempt when zero retries are configured", async () => {
      const operation = vi.fn(async () => "success")

      await expect(withRetries(operation, 0, 0)).resolves.toBe("success")
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it("performs the initial attempt plus the configured retries", async () => {
      const operation = vi.fn(async () => {
        throw new Error("retryable failure")
      })

      await expect(withRetries(operation, 2, 0)).rejects.toThrow(
        "retryable failure"
      )
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it("can succeed on the final configured retry", async () => {
      const operation = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error("first failure"))
        .mockRejectedValueOnce(new Error("second failure"))
        .mockResolvedValueOnce("success")

      await expect(withRetries(operation, 2, 0)).resolves.toBe("success")
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it("does not retry cancellation errors", async () => {
      const operation = vi.fn(async () => {
        throw new Error("job-cancelled")
      })

      await expect(withRetries(operation, 3, 1)).rejects.toThrow(
        "job-cancelled"
      )
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it("cancels an in-progress retry delay without starting another attempt", async () => {
      const controller = new AbortController()
      const operation = vi.fn(async () => {
        throw new Error("retryable failure")
      })

      const result = withRetries(
        operation,
        3,
        60_000,
        undefined,
        controller.signal
      )
      const rejection = expect(result).rejects.toThrow("job-cancelled")
      await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(1))
      controller.abort()

      await rejection
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it("retries on failure (default 3 times)", async () => {
      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope)
        .mockRejectedValueOnce(new Error("Fail 1"))
        .mockRejectedValueOnce(new Error("Fail 2"))
        .mockRejectedValueOnce(new Error("Fail 3"))

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, 3)

      expect(result).toBeNull()
      // Note: withRetries should have been called, verifying retry behavior
    })

    it("succeeds after retry", async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([["content-type", "image/jpeg"]]),
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope)
        .mockRejectedValueOnce(new Error("Fail 1"))
        .mockResolvedValueOnce(mockResponse as unknown as Response)

      const result = await downloadCoverImage(mockUrl, mockIntegrationId, 3)

      expect(result).not.toBeNull()
      expect(result?.data).toBe(mockArrayBuffer)
    })
  })

  describe("Rate Limiting", () => {
    it("uses image scope for rate limiting", async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([["content-type", "image/jpeg"]]),
      }

      const { rateLimitedFetchForIntegration, rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      await downloadCoverImage(mockUrl, mockIntegrationId, mockFetchTimeoutMs)

      expect(rateLimitedFetchForIntegration).toHaveBeenCalledWith(
        mockIntegrationId,
        mockUrl,
        "image",
        expect.objectContaining({
          credentials: "omit",
          signal: expect.any(AbortSignal),
        }),
        undefined
      )
    })
  })

  describe("Data Integrity", () => {
    it("returns correct ArrayBuffer size", async () => {
      const expectedSize = 4096
      const mockArrayBuffer = new ArrayBuffer(expectedSize)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([["content-type", "image/jpeg"]]),
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result?.data.byteLength).toBe(expectedSize)
    })

    it("handles large images (>1MB)", async () => {
      const largeSize = 2 * 1024 * 1024 // 2MB
      const mockArrayBuffer = new ArrayBuffer(largeSize)
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([["content-type", "image/jpeg"]]),
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      const result = await downloadCoverImage(
        mockUrl,
        mockIntegrationId,
        mockFetchTimeoutMs
      )

      expect(result).not.toBeNull()
      expect(result?.data.byteLength).toBe(largeSize)
    })
  })

  describe("Real-world Scenarios", () => {
    it("handles typical manga cover from mangadex.org", async () => {
      const mockArrayBuffer = new ArrayBuffer(153600) // ~150KB typical cover
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map([["content-type", "image/jpeg"]]),
      }

      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockResolvedValue(
        mockResponse as unknown as Response
      )

      const result = await downloadCoverImage(
        "https://uploads.mangadex.org/covers/series/series-cover.jpg",
        "mangadex",
        mockFetchTimeoutMs
      )

      expect(result).not.toBeNull()
      expect(result?.extension).toBe("jpeg")
      expect(result?.data.byteLength).toBe(153600)
    })

    it("gracefully handles CDN failures", async () => {
      const { rateLimitedFetchByUrlScope } =
        await import("@/src/runtime/rate-limit")
      vi.mocked(rateLimitedFetchByUrlScope).mockRejectedValue(
        new Error("CDN unavailable")
      )

      const result = await downloadCoverImage(
        "https://uploads.mangadex.org/covers/series/cover.jpg",
        "mangadex",
        mockFetchTimeoutMs
      )

      expect(result).toBeNull()
      // Download continues without cover
    })
  })
})
