import { afterEach, describe, expect, it, vi } from "vitest"

import { descramblePixivImage } from "@/src/site-integrations/pixiv-comic/descrambler"

function makePngHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

function createMockBitmap(width: number, height: number) {
  return {
    width,
    height,
    close: vi.fn(),
  }
}

function createMockCanvas(width: number, height: number) {
  const imageData = {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  }

  const context = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => imageData),
    createImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    })),
    putImageData: vi.fn(),
  }

  const canvas = {
    width,
    height,
    getContext: vi.fn(() => context),
    convertToBlob: vi.fn(async () => ({
      arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
    })),
  }

  return { canvas, context, imageData }
}

// Vitest 4 mock functions are not constructable with `new`, so we use a
// class wrapper to mock OffscreenCanvas (which the source calls with `new`).
function createOffscreenCanvasMock(
  canvas: ReturnType<typeof createMockCanvas>["canvas"]
) {
  return class MockOffscreenCanvas {
    width: number
    height: number
    getContext: typeof canvas.getContext
    convertToBlob: typeof canvas.convertToBlob
    constructor(w: number, h: number) {
      this.width = w
      this.height = h
      this.getContext = canvas.getContext
      this.convertToBlob = canvas.convertToBlob
    }
  }
}

describe("descramblePixivImage", () => {
  const originalCreateImageBitmap = (
    globalThis as { createImageBitmap?: unknown }
  ).createImageBitmap
  const originalOffscreenCanvas = (globalThis as { OffscreenCanvas?: unknown })
    .OffscreenCanvas

  afterEach(() => {
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap =
      originalCreateImageBitmap
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas =
      originalOffscreenCanvas
  })

  it("fails instead of returning scrambled bytes when createImageBitmap is unavailable", async () => {
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap =
      undefined
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {}

    const buffer = new ArrayBuffer(10)
    await expect(
      descramblePixivImage(
        buffer,
        "image/png",
        "test-key",
        "https://example.com/img.png"
      )
    ).rejects.toThrow("image reconstruction is unavailable")
  })

  it("fails instead of returning scrambled bytes when OffscreenCanvas is unavailable", async () => {
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn()
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined

    const buffer = new ArrayBuffer(10)
    await expect(
      descramblePixivImage(
        buffer,
        "image/png",
        "test-key",
        "https://example.com/img.png"
      )
    ).rejects.toThrow("image reconstruction is unavailable")
  })

  it("fails instead of returning scrambled bytes when the 2D context is unavailable", async () => {
    const bitmap = createMockBitmap(64, 64)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
      async () => bitmap
    )
    const { canvas } = createMockCanvas(64, 64)
    canvas.getContext = vi.fn(() => null as never)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas =
      createOffscreenCanvasMock(canvas)

    const buffer = makePngHeader(64, 64)
    await expect(
      descramblePixivImage(
        buffer,
        "image/png",
        "test-key",
        "https://example.com/img.png"
      )
    ).rejects.toThrow("reconstruction canvas is unavailable")
  })

  it("fails instead of returning scrambled bytes when the image is too small", async () => {
    const bitmap = createMockBitmap(1, 1)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
      async () => bitmap
    )
    const { canvas } = createMockCanvas(1, 1)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas =
      createOffscreenCanvasMock(canvas)

    const buffer = makePngHeader(1, 1)
    await expect(
      descramblePixivImage(
        buffer,
        "image/png",
        "test-key",
        "https://example.com/img.png"
      )
    ).rejects.toThrow("too small to reconstruct safely")
  })

  it("descrambles a 4x4 grid image with gridshuffle32:32", async () => {
    const width = 128
    const height = 128
    const bitmap = createMockBitmap(width, height)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
      async () => bitmap
    )
    const { canvas, context } = createMockCanvas(width, height)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas =
      createOffscreenCanvasMock(canvas)

    const buffer = makePngHeader(width, height)
    const result = await descramblePixivImage(
      buffer,
      "image/png",
      "test-key",
      "https://example.com/img_gridshuffle32:32.png"
    )

    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
    expect(context.putImageData).toHaveBeenCalledTimes(1)
    expect(canvas.convertToBlob).toHaveBeenCalledWith({
      type: "image/png",
      quality: undefined,
    })
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    expect(result.mimeType).toBe("image/png")
    expect(bitmap.close).toHaveBeenCalled()
  })

  it("passes correct quality for jpeg output", async () => {
    const width = 64
    const height = 64
    const bitmap = createMockBitmap(width, height)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
      async () => bitmap
    )
    const { canvas } = createMockCanvas(width, height)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas =
      createOffscreenCanvasMock(canvas)

    const buffer = makePngHeader(width, height)
    await descramblePixivImage(
      buffer,
      "image/jpeg",
      "test-key",
      "https://example.com/img_gridshuffle32:32.jpg"
    )

    expect(canvas.convertToBlob).toHaveBeenCalledWith({
      type: "image/jpeg",
      quality: 0.92,
    })
  })

  it("defaults to image/png output for non-image mime types", async () => {
    const width = 64
    const height = 64
    const bitmap = createMockBitmap(width, height)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
      async () => bitmap
    )
    const { canvas } = createMockCanvas(width, height)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas =
      createOffscreenCanvasMock(canvas)

    const buffer = makePngHeader(width, height)
    await descramblePixivImage(
      buffer,
      "application/octet-stream",
      "test-key",
      "https://example.com/img_gridshuffle32:32.bin"
    )

    expect(canvas.convertToBlob).toHaveBeenCalledWith({
      type: "image/png",
      quality: undefined,
    })
  })

  it("clamps gridshuffle1:1 to minimum cell size to prevent DoS", async () => {
    const width = 256
    const height = 256
    const bitmap = createMockBitmap(width, height)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
      async () => bitmap
    )
    const { canvas, context } = createMockCanvas(width, height)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas =
      createOffscreenCanvasMock(canvas)

    const buffer = makePngHeader(width, height)
    await descramblePixivImage(
      buffer,
      "image/png",
      "test-key",
      "https://example.com/img_gridshuffle1:1.png"
    )

    // With MIN_GRID_DIMENSION=8, a 256×256 image → 32×32=1024 cells (under cap)
    // Should descramble normally, not return original buffer
    expect(context.putImageData).toHaveBeenCalledTimes(1)
  })

  it("rejects images whose descrambling grid exceeds the safety cap", async () => {
    const width = 1800
    const height = 1800
    const bitmap = createMockBitmap(width, height)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
      async () => bitmap
    )
    // The safety check depends on bitmap dimensions, not pixel-buffer size.
    // Keep the mocked pixel arrays tiny so the regression itself cannot exhaust
    // the Vitest worker heap.
    const { canvas, context } = createMockCanvas(1, 1)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas =
      createOffscreenCanvasMock(canvas)

    const buffer = makePngHeader(1800, 1800)
    await expect(
      descramblePixivImage(
        buffer,
        "image/png",
        "test-key",
        "https://example.com/img_gridshuffle8:8.png"
      )
    ).rejects.toThrow("Pixiv descrambling safety cap exceeded")

    // With 8:8 on 1800×1800 → 225×225=50,625 cells (over 50k cap)
    expect(context.putImageData).not.toHaveBeenCalled()
    expect(canvas.convertToBlob).not.toHaveBeenCalled()
    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })

  it("preserves large grid cell sizes without capping (correctness)", async () => {
    const width = 128
    const height = 128
    const bitmap = createMockBitmap(width, height)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
      async () => bitmap
    )
    const { canvas, context } = createMockCanvas(width, height)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas =
      createOffscreenCanvasMock(canvas)

    const buffer = makePngHeader(width, height)
    await descramblePixivImage(
      buffer,
      "image/png",
      "test-key",
      "https://example.com/img_gridshuffle128:128.png"
    )

    // 128:128 on 128×128 → 1×1=1 cell. Should descramble, not cap to 64.
    expect(context.putImageData).toHaveBeenCalledTimes(1)
  })
})
