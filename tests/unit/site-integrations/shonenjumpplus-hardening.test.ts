import { afterEach, describe, expect, it, vi } from "vitest"

import {
  extractImageUrlsFromEpisodeJsonScript,
  readEpisodeJsonSeriesMetadataFromHtml,
} from "@/src/site-integrations/shonenjumpplus/episode-json"
import {
  buildGigaviewerTileMoves,
  descrambleGigaviewerImage,
} from "@/src/site-integrations/shonenjumpplus/gigaviewer-image"
import {
  isTrustedShonenJumpPlusAssetUrl,
  parseTrustedShonenJumpPlusEpisodeUrl,
} from "@/src/site-integrations/shonenjumpplus/urls"
import { offscreenSiteAdapter } from "@/src/site-integrations/shonenjumpplus/offscreen-runtime"

const fetchImageWithStallDetectionMock = vi.hoisted(() => vi.fn())

vi.mock("@/src/runtime/fetch-image", () => ({
  fetchImageWithStallDetection: fetchImageWithStallDetectionMock,
}))

function encodeAttributeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

afterEach(() => {
  fetchImageWithStallDetectionMock.mockReset()
  vi.unstubAllGlobals()
})

function makePngHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

describe("Shonen Jump+ hardening contracts", () => {
  it("parses episode-json regardless of script attribute order", () => {
    const dataValue = encodeAttributeJson({
      readableProduct: {
        pageStructure: {
          pages: [
            {
              type: "main",
              src: "https://cdn-ak-img.shonenjumpplus.com/public/page/1.jpg",
            },
          ],
        },
      },
    })

    expect(
      extractImageUrlsFromEpisodeJsonScript(
        `<script data-value="${dataValue}" type="application/json" id="episode-json"></script>`
      )
    ).toEqual(["https://cdn-ak-img.shonenjumpplus.com/public/page/1.jpg"])
  })

  it("reads the stable series id from episode-json metadata", () => {
    const dataValue = encodeAttributeJson({
      readableProduct: {
        series: { id: "4401", title: "Series title" },
      },
    })

    expect(
      readEpisodeJsonSeriesMetadataFromHtml(
        `<script id="episode-json" data-value="${dataValue}"></script>`
      )
    ).toMatchObject({
      seriesId: "4401",
      seriesTitle: "Series title",
    })
  })

  it("accepts only official HTTPS episode and asset URLs", () => {
    expect(
      parseTrustedShonenJumpPlusEpisodeUrl(
        "https://shonenjumpplus.com/episode/123"
      )?.episodeId
    ).toBe("123")
    expect(
      parseTrustedShonenJumpPlusEpisodeUrl(
        "https://attacker.example/episode/123"
      )
    ).toBeNull()
    expect(
      parseTrustedShonenJumpPlusEpisodeUrl(
        "http://shonenjumpplus.com/episode/123"
      )
    ).toBeNull()
    expect(
      parseTrustedShonenJumpPlusEpisodeUrl(
        "https://shonenjumpplus.com/episode/not-numeric"
      )
    ).toBeNull()
    expect(
      parseTrustedShonenJumpPlusEpisodeUrl(
        "https://shonenjumpplus.com/series/4401"
      )
    ).toBeNull()

    expect(
      isTrustedShonenJumpPlusAssetUrl(
        "https://cdn-ak-img.shonenjumpplus.com/public/page/1.jpg"
      )
    ).toBe(true)
    expect(
      isTrustedShonenJumpPlusAssetUrl(
        "https://cdn-ak.shonenjumpplus.com/pages/1.jpg"
      )
    ).toBe(true)
    expect(
      isTrustedShonenJumpPlusAssetUrl(
        "https://cdn-ak-img.shonenjumpplus.com.attacker.example/public/page/1.jpg"
      )
    ).toBe(false)
  })

  it("matches the current GigaViewer fixed 4x4 transpose golden matrix", () => {
    const scrambled = [
      ["A", "E", "I", "M"],
      ["B", "F", "J", "N"],
      ["C", "G", "K", "O"],
      ["D", "H", "L", "P"],
    ]
    const restored = Array.from({ length: 4 }, () => Array<string>(4).fill(""))

    const { moves, tileWidth, tileHeight } = buildGigaviewerTileMoves(32, 32)
    for (const move of moves) {
      restored[move.dest.y][move.dest.x] =
        scrambled[move.source.y][move.source.x]
    }

    expect({ tileWidth, tileHeight }).toEqual({
      tileWidth: 8,
      tileHeight: 8,
    })
    expect(restored).toEqual([
      ["A", "B", "C", "D"],
      ["E", "F", "G", "H"],
      ["I", "J", "K", "L"],
      ["M", "N", "O", "P"],
    ])
  })

  it("fails instead of returning scrambled bytes when canvas support is absent", async () => {
    vi.stubGlobal("createImageBitmap", undefined)
    vi.stubGlobal("OffscreenCanvas", undefined)

    await expect(
      descrambleGigaviewerImage(new Uint8Array([1, 2, 3]).buffer, "image/jpeg")
    ).rejects.toThrow("image reconstruction is unavailable")
  })

  it("rejects oversized encoded dimensions before bitmap allocation", async () => {
    const createImageBitmap = vi.fn(async () => ({
      width: 20_000,
      height: 20_000,
      close: vi.fn(),
    }))
    vi.stubGlobal("createImageBitmap", createImageBitmap)
    vi.stubGlobal("OffscreenCanvas", class {})

    await expect(
      descrambleGigaviewerImage(makePngHeader(20_000, 20_000), "image/png")
    ).rejects.toThrow("dimension")
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it("reconstructs the fixed transpose and preserves edge strips through the download adapter", async () => {
    const width = 40
    const height = 40
    const tileSize = 8
    const sourcePixels = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let marker: number
        if (x >= 32 && y >= 32) marker = 203
        else if (x >= 32) marker = 201
        else if (y >= 32) marker = 202
        else
          marker = Math.floor(x / tileSize) * 4 + Math.floor(y / tileSize) + 1

        const offset = (y * width + x) * 4
        sourcePixels[offset] = marker
        sourcePixels[offset + 3] = 255
      }
    }

    const canvasPixels = new Uint8ClampedArray(width * height * 4)
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width,
        height,
        pixels: sourcePixels,
        close: vi.fn(),
      }))
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
            imageSmoothingEnabled: true,
            drawImage: (
              bitmap: { pixels: Uint8ClampedArray },
              sourceX: number,
              sourceY: number,
              sourceWidth: number,
              sourceHeight: number,
              destX: number,
              destY: number,
              destWidth: number,
              destHeight: number
            ) => {
              expect(destWidth).toBe(sourceWidth)
              expect(destHeight).toBe(sourceHeight)
              for (let y = 0; y < sourceHeight; y += 1) {
                for (let x = 0; x < sourceWidth; x += 1) {
                  const sourceOffset = ((sourceY + y) * width + sourceX + x) * 4
                  const destOffset = ((destY + y) * width + destX + x) * 4
                  canvasPixels.set(
                    bitmap.pixels.subarray(sourceOffset, sourceOffset + 4),
                    destOffset
                  )
                }
              }
            },
          }
        }
        convertToBlob(options: { type: string }) {
          return Promise.resolve(
            new Blob([canvasPixels], { type: options.type })
          )
        }
      }
    )
    fetchImageWithStallDetectionMock.mockResolvedValue({
      data: makePngHeader(width, height),
      mimeType: "image/png",
    })

    const result = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
      "https://cdn-ak-img.shonenjumpplus.com/public/page/known-vector.png"
    )
    const output = new Uint8Array(result.data)
    const markerAt = (x: number, y: number) => output[(y * width + x) * 4]
    const tileMarkers = Array.from({ length: 4 }, (_, row) =>
      Array.from({ length: 4 }, (_, column) =>
        markerAt(column * tileSize, row * tileSize)
      )
    )

    expect(tileMarkers).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
    ])
    expect(markerAt(35, 4)).toBe(201)
    expect(markerAt(4, 35)).toBe(202)
    expect(markerAt(35, 35)).toBe(203)
    expect(result.mimeType).toBe("image/png")
  })
})
