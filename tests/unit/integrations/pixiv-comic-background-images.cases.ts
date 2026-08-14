import { describe, expect, it, vi } from "vitest"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import {
  makeHtmlResponse,
  makePngHeader,
  mockRateLimitedFetch,
  rateLimitService,
  rateLimitSettings,
  siteIntegrationSettingsReader,
} from "./pixiv-comic-test-setup"
import { backgroundSiteAdapter } from "@/src/site-integrations/pixiv-comic/background-runtime"
import { offscreenSiteAdapter as offscreenSiteAdapterImpl } from "@/src/site-integrations/pixiv-comic/offscreen-runtime"

export function registerPixivComicBackgroundImageCases(): void {
  const runtime = { rateLimitService, rateLimitSettings }
  const resolveChapterPlan = (
    chapter: Parameters<
      typeof offscreenSiteAdapterImpl.offscreen.chapter.resolveChapterPlan
    >[0],
    input?: Record<string, unknown>
  ) =>
    offscreenSiteAdapterImpl.offscreen.chapter.resolveChapterPlan(chapter, {
      ...(input ?? {}),
      runtime,
    } as Parameters<
      typeof offscreenSiteAdapterImpl.offscreen.chapter.resolveChapterPlan
    >[1])
  const downloadImage = (url: string, input?: Record<string, unknown>) =>
    offscreenSiteAdapterImpl.offscreen.chapter.downloadImage(url, {
      ...(input ?? {}),
      runtime,
    } as Parameters<
      typeof offscreenSiteAdapterImpl.offscreen.chapter.downloadImage
    >[1])

  const offscreenSiteAdapter = {
    offscreen: {
      chapter: {
        resolveChapterPlan,
        downloadImage,
      },
    },
  }

  describe("Pixiv Comic integration", () => {
    it("prepares task-scoped context without reading browser cookies", async () => {
      const context =
        await backgroundSiteAdapter.background.prepareDispatchContext?.({
          taskId: "task-1",
          seriesKey: "pixiv-comic#9012",
          chapter: {
            id: "c1",
            url: "https://comic.pixiv.net/viewer/stories/1",
            title: "Episode 1",
            comicInfo: {},
          },
          settingsSnapshot: {
            ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "pixiv-comic"),
          },
          siteIntegrationSettingsReader,
        })

      expect(context).toEqual({
        taskId: "task-1",
      })
    })

    it("downloads image through rate-limited fetch", async () => {
      const payload = makePngHeader()
      mockRateLimitedFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-type" ? "image/webp" : null,
        },
        arrayBuffer: async () => payload,
      })

      const result = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://img-comic.pximg.net/a/b/c/page01.webp"
      )

      expect(result.mimeType).toBe("image/webp")
      expect(result.filename).toBe("page01.webp")
      expect(result.data.byteLength).toBe(24)
    })

    it("rejects non-raster image responses before returning downloaded image data", async () => {
      mockRateLimitedFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-type" ? "text/html; charset=utf-8" : null,
        },
        arrayBuffer: async () =>
          new TextEncoder().encode("<html>captcha</html>").buffer,
      })

      await expect(
        offscreenSiteAdapter.offscreen.chapter.downloadImage(
          "https://img-comic.pximg.net/a/b/c/page01.webp"
        )
      ).rejects.toThrow("Unsupported MIME type: text/html")
    })

    it("resolves image urls via Pixiv API and refreshes stale build id on 404", async () => {
      mockRateLimitedFetch
        .mockResolvedValueOnce(
          makeHtmlResponse(
            '<script src="/_next/static/build-old/_buildManifest.js"></script>'
          )
        )
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({}),
        })
        .mockResolvedValueOnce(
          makeHtmlResponse(
            '<script src="/_next/static/build-new/_buildManifest.js"></script>'
          )
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pageProps: {
              story: {
                reading_episode: {
                  pages: [
                    {
                      src: "https://img-comic.pximg.net/chapters/100/001.jpg",
                      key: "k1",
                    },
                    {
                      src: "https://img-comic.pximg.net/chapters/100/002.jpg",
                      key: "k2",
                    },
                  ],
                },
              },
              salt: "salt-value",
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pages: [
              {
                url: "https://img-comic.pximg.net/chapters/100/001.jpg",
                key: "k1",
              },
              {
                url: "https://img-comic.pximg.net/chapters/100/002.jpg",
                key: "k2",
              },
            ],
          }),
        })

      const { imageUrls: urls } =
        await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          {
            id: "100",
            url: "https://comic.pixiv.net/viewer/stories/100",
          },
          { dispatchContext: { taskId: "task-100" } }
        )

      expect(urls).toEqual([
        "https://img-comic.pximg.net/chapters/100/001.jpg#tmdPixivKey=azE%3D",
        "https://img-comic.pximg.net/chapters/100/002.jpg#tmdPixivKey=azI%3D",
      ])

      const calls = mockRateLimitedFetch.mock.calls.map(
        (call) => (call[0] as { url: string }).url
      )
      expect(
        calls.some((url) =>
          url.includes("/_next/data/build-old/viewer/stories/100.json")
        )
      ).toBe(true)
      expect(
        calls.some((url) =>
          url.includes("/_next/data/build-new/viewer/stories/100.json")
        )
      ).toBe(true)
      for (const call of mockRateLimitedFetch.mock.calls) {
        const requestInit = (call[0] as { init?: RequestInit }).init
        expect(requestInit?.credentials).toBe("include")
        expect(new Headers(requestInit?.headers).has("cookie")).toBe(false)
      }
    })

    it("resolves image urls when read_v4 returns pages under data.reading_episode", async () => {
      mockRateLimitedFetch
        .mockResolvedValueOnce(
          makeHtmlResponse(
            '<script src="/_next/static/build-3/_buildManifest.js"></script>'
          )
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pageProps: {
              salt: "salt-value",
              story: {
                reading_episode: {
                  pages: [],
                },
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              reading_episode: {
                pages: [
                  {
                    src: "https://img-comic.pximg.net/chapters/103/001.jpg",
                    key: "k1",
                  },
                  {
                    src: "https://img-comic.pximg.net/chapters/103/002.jpg",
                    key: "k2",
                  },
                ],
              },
            },
          }),
        })

      const { imageUrls: urls } =
        await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          {
            id: "103",
            url: "https://comic.pixiv.net/viewer/stories/103",
          },
          { dispatchContext: { taskId: "task-103" } }
        )

      expect(urls).toEqual([
        "https://img-comic.pximg.net/chapters/103/001.jpg#tmdPixivKey=azE%3D",
        "https://img-comic.pximg.net/chapters/103/002.jpg#tmdPixivKey=azI%3D",
      ])
    })

    it("rejects a mixed page list instead of omitting a page without an image URL", async () => {
      mockRateLimitedFetch
        .mockResolvedValueOnce(
          makeHtmlResponse(
            '<script src="/_next/static/build-mixed/_buildManifest.js"></script>'
          )
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ pageProps: { salt: "salt-value" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pages: [
              {
                url: "https://img-comic.pximg.net/chapters/107/001.jpg",
                key: "k1",
              },
              { key: "missing-url" },
            ],
          }),
        })

      await expect(
        offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          {
            id: "107",
            url: "https://comic.pixiv.net/viewer/stories/107",
          },
          { dispatchContext: { taskId: "task-107" } }
        )
      ).rejects.toThrow("page image URL is missing")
    })

    it("normalizes relative API image paths against Pixiv and rejects untrusted origins", async () => {
      mockRateLimitedFetch
        .mockResolvedValueOnce(
          makeHtmlResponse(
            '<script src="/_next/static/build-relative/_buildManifest.js"></script>'
          )
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ pageProps: { salt: "salt-value" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              reading_episode: {
                pages: [
                  {
                    url: "/c/q90_gridshuffle32:32/images/page/104/1.jpg?token=abc",
                    key: "k1",
                  },
                ],
              },
            },
          }),
        })

      await expect(
        offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          {
            id: "104",
            url: "https://comic.pixiv.net/viewer/stories/104",
          },
          { dispatchContext: { taskId: "task-104" } }
        )
      ).resolves.toEqual({
        imageUrls: [
          "https://comic.pixiv.net/c/q90_gridshuffle32:32/images/page/104/1.jpg?token=abc#tmdPixivKey=azE%3D",
        ],
      })

      mockRateLimitedFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ pageProps: { salt: "salt-value" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pages: [{ url: "https://attacker.example/page.jpg", key: "k1" }],
          }),
        })

      await expect(
        offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          {
            id: "105",
            url: "https://comic.pixiv.net/viewer/stories/105",
          },
          { dispatchContext: { taskId: "task-104" } }
        )
      ).rejects.toThrow("Untrusted Pixiv image URL")
    })

    it("logs debug details when image descrambling is applied during download", async () => {
      mockRateLimitedFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-type" ? "image/webp" : null,
        },
        arrayBuffer: async () => makePngHeader(),
      })

      await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://img-comic.pximg.net/a/b/c/page01.webp#tmdPixivKey=azE%3D"
      )
    })

    it("returns the MIME type produced by Pixiv descrambling", async () => {
      mockRateLimitedFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) => (name === "content-type" ? "image/gif" : null),
        },
        arrayBuffer: async () => makePngHeader(),
      })
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => ({ width: 32, height: 32, close: vi.fn() }))
      )
      vi.stubGlobal(
        "OffscreenCanvas",
        class {
          constructor(
            public width: number,
            public height: number
          ) {}
          getContext() {
            return {
              drawImage: vi.fn(),
              getImageData: () => ({
                data: new Uint8ClampedArray(32 * 32 * 4),
              }),
              createImageData: () => ({
                data: new Uint8ClampedArray(32 * 32 * 4),
              }),
              putImageData: vi.fn(),
            }
          }
          convertToBlob() {
            return Promise.resolve(
              new Blob([new Uint8Array([9, 8, 7])], { type: "image/png" })
            )
          }
        }
      )

      const result = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://img-comic.pximg.net/c/gridshuffle32:32/page.gif#tmdPixivKey=azE%3D"
      )

      expect(result.mimeType).toBe("image/png")
      expect(new Uint8Array(result.data)).toEqual(new Uint8Array([9, 8, 7]))
    })

    it("reconstructs a known Pixiv gridshuffle vector through the download adapter", async () => {
      const width = 128
      const height = 128
      const cellSize = 32
      const sourcePixels = new Uint8ClampedArray(width * height * 4)
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          const marker = row * 4 + column
          for (let y = row * cellSize; y < (row + 1) * cellSize; y += 1) {
            for (
              let x = column * cellSize;
              x < (column + 1) * cellSize;
              x += 1
            ) {
              const offset = (y * width + x) * 4
              sourcePixels[offset] = marker
              sourcePixels[offset + 3] = 255
            }
          }
        }
      }

      const reconstructedPixels = new Uint8ClampedArray(width * height * 4)
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => ({ width, height, close: vi.fn() }))
      )
      vi.stubGlobal(
        "OffscreenCanvas",
        class {
          constructor(
            public width: number,
            public height: number
          ) {}
          getContext() {
            return {
              drawImage: vi.fn(
                (
                  _bitmap: unknown,
                  sourceX: number,
                  sourceY: number,
                  copyWidth?: number,
                  copyHeight?: number,
                  destX?: number,
                  destY?: number
                ) => {
                  if (
                    copyWidth === undefined ||
                    copyHeight === undefined ||
                    destX === undefined ||
                    destY === undefined
                  ) {
                    return
                  }
                  for (let y = 0; y < copyHeight; y += 1) {
                    for (let x = 0; x < copyWidth; x += 1) {
                      const sourceOffset =
                        ((sourceY + y) * width + sourceX + x) * 4
                      const destinationOffset =
                        ((destY + y) * width + destX + x) * 4
                      reconstructedPixels.set(
                        sourcePixels.subarray(sourceOffset, sourceOffset + 4),
                        destinationOffset
                      )
                    }
                  }
                }
              ),
              getImageData: () => ({ data: sourcePixels, width, height }),
              createImageData: () => ({
                data: new Uint8ClampedArray(width * height * 4),
                width,
                height,
              }),
              putImageData: vi.fn(),
            }
          }
          convertToBlob(options: { type: string }) {
            return Promise.resolve(
              new Blob([reconstructedPixels], { type: options.type })
            )
          }
        }
      )
      mockRateLimitedFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-type" ? "image/webp" : null,
        },
        arrayBuffer: async () => makePngHeader(),
      })

      const result = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://img-comic.pximg.net/c/gridshuffle32:32/page.webp#tmdPixivKey=azE%3D"
      )
      const output = new Uint8Array(result.data)
      const markers = Array.from({ length: 4 }, (_, row) =>
        Array.from(
          { length: 4 },
          (_, column) =>
            output[(row * cellSize * width + column * cellSize) * 4]
        )
      )

      // Static golden vector for key "k1". It validates the SHA-256 seed,
      // xoshiro shuffle, reverse mapping, canvas write, and adapter output.
      expect(markers).toEqual([
        [3, 0, 1, 2],
        [7, 4, 6, 5],
        [8, 10, 9, 11],
        [15, 14, 13, 12],
      ])
      expect(result.mimeType).toBe("image/webp")
    })

    it("relies on DNR for Pixiv referer and sends the gridshuffle key header", async () => {
      mockRateLimitedFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-type" ? "image/jpeg" : null,
        },
        arrayBuffer: async () => makePngHeader(),
      })

      const abortController = new AbortController()
      await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://img-comic.pximg.net/a/b/c/page01.jpg?foo=bar#tmdPixivKey=azE%3D",
        {
          signal: abortController.signal,
          dispatchContext: {
            taskId: "task-image",
          },
        }
      )

      expect(mockRateLimitedFetch).toHaveBeenCalledTimes(1)
      const request = mockRateLimitedFetch.mock.calls[0]?.[0] as {
        scope: string
        init: RequestInit
      }
      const requestInit = request.init
      expect(request.scope).toBe("image")
      expect(requestInit.credentials).toBe("include")
      expect(requestInit).not.toHaveProperty("referrer")
      expect(requestInit).not.toHaveProperty("referrerPolicy")
      expect(requestInit.signal).toBeInstanceOf(AbortSignal)

      expect(requestInit.headers).toEqual({
        "x-cobalt-thumber-parameter-gridshuffle-key": "k1",
      })
    })

    it("preserves key-only signed query params when fetching chapter image URLs", async () => {
      mockRateLimitedFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-type" ? "image/jpeg" : null,
        },
        arrayBuffer: async () => makePngHeader(),
      })

      await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        "https://img-comic.pximg.net/c/q90_gridshuffle32:32/images/page/136645/jEPBvqSTmG1KdJJGxzSS/1.jpg?20230208180812#tmdPixivKey=azE%3D"
      )

      expect(mockRateLimitedFetch).toHaveBeenCalledTimes(1)
      const requestedUrl = (
        mockRateLimitedFetch.mock.calls[0]?.[0] as { url: string }
      ).url
      expect(requestedUrl).toBe(
        "https://img-comic.pximg.net/c/q90_gridshuffle32:32/images/page/136645/jEPBvqSTmG1KdJJGxzSS/1.jpg?20230208180812"
      )
      expect(requestedUrl.includes("?20230208180812=")).toBe(false)
    })

    it("sends read_v4 x-client-time header without milliseconds", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-03-01T11:22:33.789Z"))

      mockRateLimitedFetch
        .mockResolvedValueOnce(
          makeHtmlResponse(
            '<script src="/_next/static/build-1/_buildManifest.js"></script>'
          )
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pageProps: {
              story: {
                reading_episode: {
                  pages: [
                    {
                      src: "https://img-comic.pximg.net/chapters/101/001.jpg",
                      key: "k1",
                    },
                  ],
                },
              },
              salt: "salt-value",
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pages: [
              {
                url: "https://img-comic.pximg.net/chapters/101/001.jpg",
                key: "k1",
              },
            ],
          }),
        })

      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "101",
          url: "https://comic.pixiv.net/viewer/stories/101",
        },
        { dispatchContext: { taskId: "task-101" } }
      )

      const readV4Call = mockRateLimitedFetch.mock.calls.find((call) =>
        (call[0] as { url: string }).url.includes(
          "/api/app/episodes/101/read_v4"
        )
      )
      expect(readV4Call).toBeDefined()

      const requestInit = (
        readV4Call?.[0] as
          | {
              init?: {
                credentials?: RequestCredentials
                headers?: HeadersInit
              }
            }
          | undefined
      )?.init
      expect(requestInit?.credentials).toBe("include")
      const headers = requestInit?.headers
      const clientTime =
        headers instanceof Headers
          ? headers.get("x-client-time")
          : (headers as Record<string, string> | undefined)?.["x-client-time"]
      expect(clientTime).toBe("2026-03-01T11:22:33Z")
      expect(
        (headers as Record<string, string> | undefined)?.cookie
      ).toBeUndefined()
    })

    it("derives read_v4 x-client-hash from normalized timestamp and salt", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-03-01T11:22:33.789Z"))

      mockRateLimitedFetch
        .mockResolvedValueOnce(
          makeHtmlResponse(
            '<script src="/_next/static/build-2/_buildManifest.js"></script>'
          )
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pageProps: {
              story: {
                reading_episode: {
                  pages: [
                    {
                      src: "https://img-comic.pximg.net/chapters/102/001.jpg",
                      key: "k1",
                    },
                  ],
                },
              },
              salt: "salt-for-hash",
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pages: [
              {
                url: "https://img-comic.pximg.net/chapters/102/001.jpg",
                key: "k1",
              },
            ],
          }),
        })

      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "102",
          url: "https://comic.pixiv.net/viewer/stories/102",
        },
        { dispatchContext: { taskId: "task-102" } }
      )

      const readV4Call = mockRateLimitedFetch.mock.calls.find((call) =>
        (call[0] as { url: string }).url.includes(
          "/api/app/episodes/102/read_v4"
        )
      )
      const requestInit = (
        readV4Call?.[0] as { init?: { headers?: HeadersInit } } | undefined
      )?.init
      const headers = requestInit?.headers
      const actualHash =
        headers instanceof Headers
          ? headers.get("x-client-hash")
          : (headers as Record<string, string> | undefined)?.["x-client-hash"]

      const payload = "2026-03-01T11:22:33Zsalt-for-hash"
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(payload)
      )
      const expectedHash = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0")
      ).join("")
      expect(actualHash).toBe(expectedHash)
    })

    it("fails explicitly when Web Crypto is unavailable instead of sending an invalid raw hash", async () => {
      mockRateLimitedFetch
        .mockResolvedValueOnce(
          makeHtmlResponse(
            '<script src="/_next/static/build-no-crypto/_buildManifest.js"></script>'
          )
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ pageProps: { salt: "salt-value" } }),
        })
      vi.stubGlobal("crypto", {})

      await expect(
        offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          {
            id: "106",
            url: "https://comic.pixiv.net/viewer/stories/106",
          },
          { dispatchContext: { taskId: "task-106" } }
        )
      ).rejects.toThrow(
        "Web Crypto subtle API is required for Pixiv API authentication"
      )
    })
  })
}
