import { afterEach, describe, expect, it, vi } from 'vitest'

import { descramblePixivImage } from '@/src/site-integrations/pixiv-comic/descrambler'

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

describe('descramblePixivImage', () => {
  const originalCreateImageBitmap = (globalThis as { createImageBitmap?: unknown }).createImageBitmap
  const originalOffscreenCanvas = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas

  afterEach(() => {
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = originalCreateImageBitmap
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreenCanvas
  })

  it('returns original buffer when createImageBitmap is not available', async () => {
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = undefined
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {}

    const buffer = new ArrayBuffer(10)
    const result = await descramblePixivImage(buffer, 'image/png', 'test-key', 'https://example.com/img.png')
    expect(result).toBe(buffer)
  })

  it('returns original buffer when OffscreenCanvas is not available', async () => {
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn()
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined

    const buffer = new ArrayBuffer(10)
    const result = await descramblePixivImage(buffer, 'image/png', 'test-key', 'https://example.com/img.png')
    expect(result).toBe(buffer)
  })

  it('returns original buffer when 2D context is unavailable', async () => {
    const bitmap = createMockBitmap(64, 64)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => bitmap)
    const { canvas } = createMockCanvas(64, 64)
    canvas.getContext = vi.fn(() => null as never)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = vi.fn(() => canvas)

    const buffer = new ArrayBuffer(10)
    const result = await descramblePixivImage(buffer, 'image/png', 'test-key', 'https://example.com/img.png')
    expect(result).toBe(buffer)
  })

  it('returns original buffer when grid dimensions result in 0 rows or columns', async () => {
    const bitmap = createMockBitmap(1, 1)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => bitmap)
    const { canvas } = createMockCanvas(1, 1)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = vi.fn(() => canvas)

    const buffer = new ArrayBuffer(10)
    const result = await descramblePixivImage(buffer, 'image/png', 'test-key', 'https://example.com/img.png')
    expect(result).toBe(buffer)
  })

  it('descrambles a 4x4 grid image with gridshuffle32:32', async () => {
    const width = 128
    const height = 128
    const bitmap = createMockBitmap(width, height)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => bitmap)
    const { canvas, context } = createMockCanvas(width, height)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = vi.fn(() => canvas)

    const buffer = new ArrayBuffer(width * height * 4)
    const result = await descramblePixivImage(buffer, 'image/png', 'test-key', 'https://example.com/img_gridshuffle32:32.png')

    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
    expect(context.putImageData).toHaveBeenCalledTimes(1)
    expect(canvas.convertToBlob).toHaveBeenCalledWith({
      type: 'image/png',
      quality: undefined,
    })
    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('passes correct quality for jpeg output', async () => {
    const width = 64
    const height = 64
    const bitmap = createMockBitmap(width, height)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => bitmap)
    const { canvas } = createMockCanvas(width, height)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = vi.fn(() => canvas)

    const buffer = new ArrayBuffer(width * height * 4)
    await descramblePixivImage(buffer, 'image/jpeg', 'test-key', 'https://example.com/img_gridshuffle32:32.jpg')

    expect(canvas.convertToBlob).toHaveBeenCalledWith({
      type: 'image/jpeg',
      quality: 0.92,
    })
  })

  it('defaults to image/png output for non-image mime types', async () => {
    const width = 64
    const height = 64
    const bitmap = createMockBitmap(width, height)
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => bitmap)
    const { canvas } = createMockCanvas(width, height)
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = vi.fn(() => canvas)

    const buffer = new ArrayBuffer(width * height * 4)
    await descramblePixivImage(buffer, 'application/octet-stream', 'test-key', 'https://example.com/img_gridshuffle32:32.bin')

    expect(canvas.convertToBlob).toHaveBeenCalledWith({
      type: 'image/png',
      quality: undefined,
    })
  })
})
