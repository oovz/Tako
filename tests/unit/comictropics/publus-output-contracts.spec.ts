import { afterEach, describe, expect, it, vi } from "vitest"
import contract from "@/tests/fixtures/site-integrations/comictropics/contract.json"
import pixelVectors from "@/tests/fixtures/site-integrations/comictropics/publus-pixel-vectors.json"
import { MAX_IMAGE_BYTES } from "@/src/constants/timeouts"
import {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLimitError,
} from "@/src/runtime/offscreen-live-resource-ledger"
import { buildPublusImageUrlsFromConfig } from "@/src/site-integrations/comictropics/publus-config"
import {
  appendPublusImageMetadata,
  buildPublusPageTileRects,
  descramblePublusImage,
  parsePublusImageTransportUrl,
  type PublusImageMetadata,
  type PublusTileRect,
} from "@/src/site-integrations/comictropics/publus-image"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"

const imageUrl = "https://cdn.comicnettai.com/page.png"
const capturedMetadata = readCapturedMetadata()

function readCapturedMetadata(): PublusImageMetadata {
  const [url] = buildPublusImageUrlsFromConfig(
    "https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/",
    contract.data.publusConfig
  )
  if (!url) throw new Error("Configuration did not produce an image")
  const parsed = parsePublusImageTransportUrl(url).metadata
  if (!parsed) throw new Error("Configuration did not admit metadata")
  return parsed
}

function metadata(overrides: Partial<PublusImageMetadata> = {}) {
  return { ...capturedMetadata, ...overrides }
}

function bitmapSourcesByCanvasPixel(
  rects: PublusTileRect[],
  width: number,
  height: number
) {
  const pixels = Array<number>(width * height).fill(-1)
  for (const rect of rects) {
    for (const value of Object.values(rect))
      expect(Number.isInteger(value)).toBe(true)
    expect(
      Math.min(rect.srcX, rect.srcY, rect.destX, rect.destY)
    ).toBeGreaterThanOrEqual(0)
    expect(Math.max(rect.srcX, rect.destX) + rect.width).toBeLessThanOrEqual(
      width
    )
    expect(Math.max(rect.srcY, rect.destY) + rect.height).toBeLessThanOrEqual(
      height
    )
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        // The processor reads destX/Y from the bitmap and writes srcX/Y on the canvas.
        const output = (rect.srcY + y) * width + rect.srcX + x
        expect(pixels[output]).toBe(-1)
        pixels[output] = (rect.destY + y) * width + rect.destX + x
      }
    }
  }
  expect([...pixels].sort((left, right) => left - right)).toEqual(
    Array.from({ length: width * height }, (_, index) => index)
  )
  return pixels
}

function pngHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

function webpHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(30)
  bytes.set([0x52, 0x49, 0x46, 0x46])
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(4, bytes.length - 8, true)
  view.setUint32(16, 10, true)
  for (let index = 0; index < 3; index += 1) {
    bytes[24 + index] = ((width - 1) >>> (index * 8)) & 255
    bytes[27 + index] = ((height - 1) >>> (index * 8)) & 255
  }
  return bytes.buffer
}

function renderer(width: number, height: number) {
  const close = vi.fn()
  const createBitmap = vi.fn(async () => ({ width, height, close }))
  const createCanvas = vi.fn()
  const drawImage = vi.fn()
  const convertToBlob = vi.fn(
    async (options: ImageEncodeOptions) =>
      new Blob([new Uint8Array([1, 2, 3])], { type: options.type })
  )
  vi.stubGlobal("createImageBitmap", createBitmap)
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor() {
        createCanvas()
      }
      getContext() {
        return { imageSmoothingEnabled: true, drawImage }
      }
      convertToBlob = convertToBlob
    }
  )
  return { close, createBitmap, createCanvas, drawImage, convertToBlob }
}

function reconstruct(
  source: ArrayBuffer,
  imageMetadata: PublusImageMetadata,
  ledger: OffscreenLiveResourceLedger,
  mimeType = "image/png"
) {
  return descramblePublusImage(
    source,
    mimeType,
    imageMetadata,
    undefined,
    ledger,
    ledger.reserve(source.byteLength, "source")
  )
}

function transport(rawJson: string) {
  const binary = Array.from(new TextEncoder().encode(rawJson), (byte) =>
    String.fromCharCode(byte)
  ).join("")
  const encoded = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
  return `${imageUrl}#tmdPublus=${encoded}`
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("PUBLUS output pixels", () => {
  it.each(pixelVectors)(
    "preserves the bitmap mapping for $input.sourceWidth x $input.sourceHeight, mode $input.mode, seed $input.seed1",
    ({ input, bitmapSourcePixelByOrderedCanvasPixel }) => {
      expect(
        bitmapSourcesByCanvasPixel(
          buildPublusPageTileRects(input),
          input.sourceWidth,
          input.sourceHeight
        )
      ).toEqual(bitmapSourcePixelByOrderedCanvasPixel)
    }
  )

  it("uses every bitmap pixel once when a permutation seed is zero", () => {
    const input = {
      ...metadata({
        seed1: 0,
        seed2: 3,
        seed3: 4,
        tileWidth: 4,
        tileHeight: 4,
      }),
      sourceWidth: 13,
      sourceHeight: 9,
    }
    bitmapSourcesByCanvasPixel(buildPublusPageTileRects(input), 13, 9)
  })
})

describe("PUBLUS transport metadata", () => {
  const valid = {
    mode: 0,
    seed1: 0,
    seed2: 0,
    seed3: 0,
    tileWidth: 4,
    tileHeight: 4,
  }

  it("roundtrips valid zero fields using browser base64 APIs without Buffer", () => {
    vi.stubGlobal("Buffer", undefined)
    let parsed: ReturnType<typeof parsePublusImageTransportUrl> | undefined
    let failure: unknown
    try {
      parsed = parsePublusImageTransportUrl(
        appendPublusImageMetadata(imageUrl, valid)
      )
    } catch (error) {
      failure = error
    } finally {
      vi.unstubAllGlobals()
    }
    expect(failure).toBeUndefined()
    expect(parsed).toEqual({ sourceUrl: imageUrl, metadata: valid })
  })

  it.each([
    { name: "null", value: null },
    { name: "an array", value: [] },
    { name: "a string", value: "metadata" },
    { name: "missing seed fields", value: { tileWidth: 4, tileHeight: 4 } },
    { name: "a negative mode", value: { ...valid, mode: -1 } },
    { name: "a string mode", value: { ...valid, mode: "0" } },
    { name: "a negative tile width", value: { ...valid, tileWidth: -1 } },
    { name: "a string tile width", value: { ...valid, tileWidth: "4" } },
    { name: "a zero tile width", value: { ...valid, tileWidth: 0 } },
    { name: "a zero tile height", value: { ...valid, tileHeight: 0 } },
  ])("rejects $name at the wire boundary", ({ value }) => {
    const url = transport(JSON.stringify(value))
    expect(() => parsePublusImageTransportUrl(url)).not.toThrow()
    expect(parsePublusImageTransportUrl(url)).toEqual({
      sourceUrl: imageUrl,
      metadata: null,
    })
  })

  it("rejects a JSON number that overflows to infinity", () => {
    const raw =
      '{"mode":1e400,"seed1":0,"seed2":0,"seed3":0,"tileWidth":4,"tileHeight":4}'
    expect(parsePublusImageTransportUrl(transport(raw)).metadata).toBeNull()
  })
})

describe("PUBLUS reconstruction admission and ownership", () => {
  it.each([
    {
      axis: "columns",
      width: 32,
      height: 2048,
      tileWidth: 32 / 65535,
      tileHeight: 2048,
    },
    {
      axis: "rows",
      width: 2048,
      height: 32,
      tileWidth: 2048,
      tileHeight: 32 / 65535,
    },
  ])(
    "admits the inclusive 16-bit $axis boundary",
    async ({ width, height, tileWidth, tileHeight }) => {
      const canvas = renderer(width, height)
      const stop = new Error("canvas construction boundary")
      canvas.createCanvas.mockImplementation(() => {
        throw stop
      })
      const ledger = new OffscreenLiveResourceLedger()
      await expect(
        reconstruct(
          pngHeader(width, height),
          metadata({ tileWidth, tileHeight }),
          ledger
        )
      ).rejects.toBe(stop)
      expect(canvas.createBitmap).toHaveBeenCalledOnce()
      expect(canvas.drawImage).not.toHaveBeenCalled()
      expect(canvas.close).toHaveBeenCalledOnce()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )

  it("reconstructs one-pixel-high tiles", async () => {
    const canvas = renderer(32, 32)
    const ledger = new OffscreenLiveResourceLedger()
    const reconstruction = reconstruct(
      pngHeader(32, 32),
      metadata({ tileWidth: 2, tileHeight: 1 }),
      ledger
    )
    await expect(reconstruction).resolves.toMatchObject({
      mimeType: "image/png",
    })
    const result = await reconstruction
    result.liveResourceLease.release()
    expect(canvas.drawImage).toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("rejects a tile taller than the decoded image", async () => {
    const canvas = renderer(32, 32)
    const ledger = new OffscreenLiveResourceLedger()
    await expect(
      reconstruct(
        pngHeader(32, 32),
        metadata({ tileWidth: 32, tileHeight: 64 }),
        ledger
      )
    ).rejects.toBeInstanceOf(ProviderContractError)
    expect(canvas.createCanvas).not.toHaveBeenCalled()
    expect(canvas.close).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("preserves the resource-cap failure when the first surface cannot be reserved", async () => {
    const canvas = renderer(32, 32)
    const ledger = new OffscreenLiveResourceLedger(7000)
    await expect(
      reconstruct(pngHeader(32, 32), metadata(), ledger)
    ).rejects.toBeInstanceOf(OffscreenLiveResourceLimitError)
    expect(canvas.createBitmap).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("keeps WebP encoding on the browser's native quality default", async () => {
    const canvas = renderer(32, 32)
    const ledger = new OffscreenLiveResourceLedger()
    const result = await reconstruct(
      webpHeader(32, 32),
      metadata(),
      ledger,
      "image/webp"
    )
    result.liveResourceLease.release()
    expect(canvas.convertToBlob).toHaveBeenCalledWith({
      type: "image/webp",
      quality: undefined,
    })
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("admits a Blob at the byte limit and preserves its readback failure", async () => {
    const width = 8192
    const height = 4096
    const canvas = renderer(width, height)
    const part = new Blob([new Uint8Array(1024 * 1024)])
    const output = new Blob(
      Array.from({ length: 100 }, () => part),
      { type: "image/png" }
    )
    expect(output.size).toBe(MAX_IMAGE_BYTES)
    const failure = new Error("encoded Blob readback failed")
    const readback = vi.spyOn(output, "arrayBuffer").mockRejectedValue(failure)
    canvas.convertToBlob.mockResolvedValue(output)
    const ledger = new OffscreenLiveResourceLedger()
    try {
      await expect(
        reconstruct(
          pngHeader(width, height),
          metadata({ tileWidth: width, tileHeight: height }),
          ledger
        )
      ).rejects.toBe(failure)
      expect(readback).toHaveBeenCalledOnce()
      expect(canvas.close).toHaveBeenCalledOnce()
      expect(ledger.getUsedBytes()).toBe(0)
    } finally {
      canvas.convertToBlob.mockReset()
      readback.mockRestore()
    }
  })

  it("charges the same workspace for transposed grids on the same square image", async () => {
    const source = pngHeader(33, 33)
    async function drawCharge(tileWidth: number, tileHeight: number) {
      const canvas = renderer(33, 33)
      const ledger = new OffscreenLiveResourceLedger()
      const charges: number[] = []
      canvas.drawImage.mockImplementation(() => {
        charges.push(ledger.getUsedBytes())
      })
      const result = await reconstruct(
        source,
        metadata({ tileWidth, tileHeight }),
        ledger
      )
      result.liveResourceLease.release()
      expect(ledger.getUsedBytes()).toBe(0)
      return {
        charges: [...new Set(charges)],
        rectangles: canvas.drawImage.mock.calls.length,
      }
    }
    // Both orientations have one-by-eight cells, two remainder edges and a corner.
    // The payload, pixel surfaces and counts of every plan representation agree.
    const horizontal = await drawCharge(17, 4)
    const vertical = await drawCharge(4, 17)
    expect(horizontal.rectangles).toBeGreaterThan(0)
    expect(horizontal.rectangles).toBe(vertical.rectangles)
    expect(horizontal.charges).toHaveLength(1)
    expect(vertical.charges).toHaveLength(1)
    expect(horizontal.charges).toEqual(vertical.charges)
  })
})
