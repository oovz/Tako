import { afterEach, describe, expect, it, vi } from "vitest"
import {
  descramblePublusImage,
  type PublusImageMetadata,
} from "@/src/site-integrations/comictropics/publus-image"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"

const metadata: PublusImageMetadata = {
  mode: 1,
  seed1: 2,
  seed2: 3,
  seed3: 4,
  tileWidth: 32,
  tileHeight: 32,
}

function pngHeader(): ArrayBuffer {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, 32)
  view.setUint32(20, 32)
  return bytes.buffer
}

function setupRenderer() {
  const close = vi.fn()
  const bitmap = { width: 32, height: 32, close }
  const createBitmap = vi.fn(async () => bitmap)
  const context = { imageSmoothingEnabled: true, drawImage: vi.fn() }
  const getContext = vi.fn((): typeof context | null => context)
  const convertToBlob = vi.fn(
    async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
  )
  vi.stubGlobal("createImageBitmap", createBitmap)
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext = getContext
      convertToBlob = convertToBlob
    }
  )
  return { bitmap, createBitmap, context, getContext, convertToBlob, close }
}

function reconstruct(
  ledger: OffscreenLiveResourceLedger,
  imageMetadata = metadata
) {
  const buffer = pngHeader()
  return descramblePublusImage(
    buffer,
    "image/png",
    imageMetadata,
    undefined,
    ledger,
    ledger.reserve(buffer.byteLength, "source")
  )
}

afterEach(() => vi.unstubAllGlobals())

describe("PUBLUS reconstruction resource ownership", () => {
  it("retains only the completed output buffer after closing the bitmap", async () => {
    const renderer = setupRenderer()
    const ledger = new OffscreenLiveResourceLedger()
    const result = await reconstruct(ledger)
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]))
    expect(renderer.context.drawImage).toHaveBeenCalled()
    expect(renderer.context.imageSmoothingEnabled).toBe(false)
    expect(renderer.close).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(result.data.byteLength)
    result.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("releases encoded and surface allocations when bitmap decoding rejects", async () => {
    const renderer = setupRenderer()
    const failure = new Error("decode failed")
    renderer.createBitmap.mockRejectedValue(failure)
    const ledger = new OffscreenLiveResourceLedger()
    await expect(reconstruct(ledger)).rejects.toBe(failure)
    expect(renderer.convertToBlob).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("closes an oversized decoded bitmap before allocating a canvas or output", async () => {
    const renderer = setupRenderer()
    renderer.bitmap.width = 1_000_000
    const ledger = new OffscreenLiveResourceLedger()
    await expect(reconstruct(ledger)).rejects.toThrow()
    expect(renderer.close).toHaveBeenCalledOnce()
    expect(renderer.getContext).not.toHaveBeenCalled()
    expect(renderer.convertToBlob).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("closes the bitmap and releases resources if no drawing context is available", async () => {
    const renderer = setupRenderer()
    renderer.getContext.mockReturnValue(null)
    const ledger = new OffscreenLiveResourceLedger()
    await expect(reconstruct(ledger)).rejects.toThrow("canvas context")
    expect(renderer.close).toHaveBeenCalledOnce()
    expect(renderer.convertToBlob).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("rejects an image smaller than its reconstruction tile without encoding it", async () => {
    const renderer = setupRenderer()
    const ledger = new OffscreenLiveResourceLedger()
    await expect(
      reconstruct(ledger, { ...metadata, tileWidth: 64 })
    ).rejects.toThrow("no valid tiles")
    expect(renderer.close).toHaveBeenCalledOnce()
    expect(renderer.convertToBlob).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("releases both encoded output allocations when buffer conversion rejects", async () => {
    const renderer = setupRenderer()
    const failure = new Error("buffer conversion failed")
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
    vi.spyOn(blob, "arrayBuffer").mockRejectedValue(failure)
    renderer.convertToBlob.mockResolvedValue(blob)
    const ledger = new OffscreenLiveResourceLedger()
    await expect(reconstruct(ledger)).rejects.toBe(failure)
    expect(renderer.close).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("releases the bitmap and source if output reservation exceeds the ledger cap", async () => {
    const renderer = setupRenderer()
    const ledger = new OffscreenLiveResourceLedger(1_000_000)
    await expect(reconstruct(ledger)).rejects.toThrow("resource cap")
    expect(renderer.close).toHaveBeenCalledOnce()
    expect(renderer.convertToBlob).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })
})
