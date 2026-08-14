/**
 * Image Processor Unit Tests
 * Tests for Cover Image Download
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fetchImageWithStallDetection } from "@/entrypoints/offscreen/image-processor"
import { MAX_IMAGE_BYTES } from "@/src/constants/timeouts"

vi.mock("@/src/site-integrations/http-client", () => ({
  fetchSharedResource: vi.fn((url: string, init: RequestInit) =>
    fetch(url, init)
  ),
  integrationHttpClient: { request: vi.fn() },
}))

describe("image processor runtime helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe("fetchImageWithStallDetection", () => {
    it("aborts pending response headers at the hard timeout", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => await new Promise<Response>(() => undefined))
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
      const cancel = vi.fn(async () => undefined)
      const mockResponse = {
        ok: true,
        headers: {
          get: (key: string) => (key === "content-type" ? "text/html" : null),
        },
        body: {
          cancel,
          getReader: () => ({
            read: () =>
              new Promise<ReadableStreamReadResult<Uint8Array>>(
                () => undefined
              ),
            cancel: async () => undefined,
            releaseLock: () => undefined,
          }),
        },
      }

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse))

      await expect(
        fetchImageWithStallDetection("https://example.com/not-image", {
          stallTimeoutMs: 20,
          hardTimeoutMs: 50,
        })
      ).rejects.toThrow("Unsupported MIME type")
      expect(cancel).toHaveBeenCalledOnce()
    })

    it("cancels rejected HTTP responses without replacing the HTTP error", async () => {
      const cancel = vi.fn(async () => undefined)
      const mockResponse = {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers(),
        body: { cancel },
      }

      await expect(
        fetchImageWithStallDetection("https://example.com/unavailable.jpg", {
          fetcher: vi.fn(async () => mockResponse as unknown as Response),
          createHttpError: () => new Error("HTTP 503"),
        })
      ).rejects.toThrow("HTTP 503")
      expect(cancel).toHaveBeenCalledOnce()
    })

    it("attaches HTTP status when no custom image error is provided", async () => {
      const cancel = vi.fn(async () => undefined)
      const mockResponse = {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers(),
        body: { cancel },
      }

      await expect(
        fetchImageWithStallDetection("https://example.com/unavailable.jpg", {
          fetcher: vi.fn(async () => mockResponse as unknown as Response),
        })
      ).rejects.toMatchObject({ status: 503 })
    })

    it("cancels the body when response handling rejects", async () => {
      const cancel = vi.fn(async () => undefined)
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "image/jpeg" }),
        body: { cancel },
      }

      await expect(
        fetchImageWithStallDetection("https://example.com/rejected.jpg", {
          fetcher: vi.fn(async () => mockResponse as unknown as Response),
          onResponse: () => {
            throw new Error("response rejected")
          },
        })
      ).rejects.toThrow("response rejected")
      expect(cancel).toHaveBeenCalledOnce()
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

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse))

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
            cancel: async () => undefined,
            releaseLock: () => undefined,
          }),
        },
      }

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse))

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
              cancel: async () => undefined,
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
              cancel: async () => undefined,
              releaseLock: vi.fn(),
            }
          },
        },
      }

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse))
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

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse))

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
      const cancel = vi.fn(async () => undefined)
      const releaseLock = vi.fn()
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
              cancel,
              releaseLock,
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
      expect(cancel).toHaveBeenCalledWith(expect.any(Error))
      expect(releaseLock).toHaveBeenCalledOnce()
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
              cancel: async () => undefined,
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
              cancel: async () => undefined,
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
      // Download continues without cover
    })
  })
})
