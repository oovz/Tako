import { afterEach, describe, expect, it, vi } from "vitest"
import { convertMangaMillionAvifToJpeg } from "@/src/site-integrations/mangamillion/avif"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"

function avif(): ArrayBuffer {
  const bytes = new Uint8Array(72)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 24)
  bytes.set(new TextEncoder().encode("ftypavif"), 4)
  bytes.set(new TextEncoder().encode("avif"), 16)
  view.setUint32(24, 48)
  bytes.set(new TextEncoder().encode("meta"), 28)
  view.setUint32(36, 36)
  bytes.set(new TextEncoder().encode("iprp"), 40)
  view.setUint32(44, 28)
  bytes.set(new TextEncoder().encode("ipco"), 48)
  view.setUint32(52, 20)
  bytes.set(new TextEncoder().encode("ispe"), 56)
  view.setUint32(64, 32)
  view.setUint32(68, 32)
  return bytes.buffer
}

afterEach(() => vi.unstubAllGlobals())

describe("AVIF conversion failure ownership", () => {
  it("consumes source ownership when browser conversion is unavailable", async () => {
    vi.stubGlobal("createImageBitmap", undefined)
    const buffer = avif()
    const ledger = new OffscreenLiveResourceLedger()
    const source = ledger.reserve(buffer.byteLength, "source")
    await expect(
      convertMangaMillionAvifToJpeg(buffer, undefined, ledger, source)
    ).rejects.toThrow(/unavailable/)
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it.each([
    "decode",
    "dimensions",
    "canvas",
    "encode",
    "buffer",
    "cancel",
  ] as const)(
    "releases all allocations after a %s failure",
    async (failure) => {
      const controller = new AbortController()
      const cause = new Error(`native ${failure} failed`)
      const close = vi.fn()
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => {
          if (failure === "decode") throw cause
          return {
            width: failure === "dimensions" ? 31 : 32,
            height: 32,
            close,
          }
        })
      )
      const copy = vi.fn(async () => {
        if (failure === "buffer") throw cause
        return new ArrayBuffer(3)
      })
      vi.stubGlobal(
        "OffscreenCanvas",
        class {
          getContext() {
            return failure === "canvas" ? null : { drawImage() {} }
          }
          async convertToBlob() {
            if (failure === "encode") throw cause
            if (failure === "cancel") controller.abort(cause)
            return { size: 3, arrayBuffer: copy }
          }
        }
      )
      const buffer = avif()
      const ledger = new OffscreenLiveResourceLedger()
      const source = ledger.reserve(buffer.byteLength, "source")
      await expect(
        convertMangaMillionAvifToJpeg(buffer, controller.signal, ledger, source)
      ).rejects.toThrow()
      expect(ledger.getUsedBytes()).toBe(0)
      expect(close).toHaveBeenCalledTimes(failure === "decode" ? 0 : 1)
      if (failure === "cancel") expect(copy).not.toHaveBeenCalled()
    }
  )
})
