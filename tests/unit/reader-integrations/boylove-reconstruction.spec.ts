import { afterEach, describe, expect, it, vi } from "vitest"
import { reconstructBoyloveImage } from "@/src/site-integrations/boylove/image-reconstruction"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { MAX_IMAGE_BYTES } from "@/src/constants/timeouts"

function pngHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

function renderer(width: number, height: number) {
  const bitmap = { width, height, close: vi.fn() }
  const drawImage = vi.fn()
  const convertToBlob = vi.fn(async () => new Blob(["page"]))
  const canvases: { width: number; height: number }[] = []
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap)
  )
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(width: number, height: number) {
        canvases.push({ width, height })
      }
      getContext() {
        return { drawImage, imageSmoothingEnabled: true }
      }
      convertToBlob = convertToBlob
    }
  )
  return { bitmap, drawImage, convertToBlob, canvases }
}

afterEach(() => vi.unstubAllGlobals())

describe("BoyLove page reconstruction", () => {
  it("reverses short-page strips and places the remainder at the right edge", async () => {
    const control = renderer(7, 2)
    const ledger = new OffscreenLiveResourceLedger()
    const data = pngHeader(7, 2)
    const image = await reconstructBoyloveImage(
      data,
      "image/png",
      { columns: 3, width: 7, height: 2 },
      undefined,
      ledger,
      ledger.reserve(data.byteLength, "source")
    )
    expect(control.drawImage.mock.calls).toEqual([
      [control.bitmap, 5, 0, 2, 2, 0, 0, 2, 2],
      [control.bitmap, 3, 0, 2, 2, 2, 0, 2, 2],
      [control.bitmap, 0, 0, 3, 2, 4, 0, 3, 2],
    ])
    expect(control.bitmap.close).toHaveBeenCalledOnce()
    expect(new TextDecoder().decode(image.data)).toBe("page")
    expect(image.mimeType).toBe("image/png")
    expect(ledger.getUsedBytes()).toBe(image.data.byteLength)
    image.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("keeps tall pages in source order and floors the fractional canvas height", async () => {
    const control = renderer(7, 4000)
    const ledger = new OffscreenLiveResourceLedger()
    const data = pngHeader(7, 4000)
    const image = await reconstructBoyloveImage(
      data,
      "image/png",
      { columns: 3, width: 7, height: 4000.5 },
      undefined,
      ledger,
      ledger.reserve(data.byteLength, "source")
    )
    expect(control.canvases).toEqual([{ width: 7, height: 4000 }])
    expect(control.drawImage.mock.calls).toEqual([[control.bitmap, 0, 0]])
    image.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it.each([0, MAX_IMAGE_BYTES + 1])(
    "releases source, bitmap and output ownership for invalid encoded size %s",
    async (size) => {
      const control = renderer(7, 2)
      control.convertToBlob.mockResolvedValue(new Blob([new Uint8Array(size)]))
      const ledger = new OffscreenLiveResourceLedger()
      const data = pngHeader(7, 2)
      await expect(
        reconstructBoyloveImage(
          data,
          "image/png",
          { columns: 3, width: 7, height: 2 },
          undefined,
          ledger,
          ledger.reserve(data.byteLength, "source")
        )
      ).rejects.toThrow(/byte limit/)
      expect(control.bitmap.close).toHaveBeenCalledOnce()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )

  it("releases all ownership when cancellation arrives during encoding", async () => {
    const control = renderer(7, 2)
    const abort = new AbortController()
    control.convertToBlob.mockImplementation(async () => {
      abort.abort()
      return new Blob(["page"])
    })
    const ledger = new OffscreenLiveResourceLedger()
    const data = pngHeader(7, 2)
    await expect(
      reconstructBoyloveImage(
        data,
        "image/png",
        { columns: 3, width: 7, height: 2 },
        abort.signal,
        ledger,
        ledger.reserve(data.byteLength, "source")
      )
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(control.bitmap.close).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(0)
  })
})
