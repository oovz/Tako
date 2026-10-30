import { afterEach, describe, expect, it, vi } from "vitest"
import { MAX_IMAGE_BYTES } from "@/src/constants/timeouts"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { reconstructMangagoImage } from "@/src/site-integrations/mangago/grid-image"
import { descrambleGigaviewerImage } from "@/src/site-integrations/shonenjumpplus/gigaviewer-image"

function pngHeader(): ArrayBuffer {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, 32)
  view.setUint32(20, 32)
  return bytes.buffer
}

afterEach(() => vi.unstubAllGlobals())

const reconstructors = [
  {
    name: "Mangago",
    run: (
      buffer: ArrayBuffer,
      ledger: OffscreenLiveResourceLedger,
      signal?: AbortSignal
    ) =>
      reconstructMangagoImage(
        buffer,
        "image/png",
        2,
        [2, 0, 3, 1],
        signal,
        ledger,
        ledger.reserve(buffer.byteLength, "source")
      ),
  },
  {
    name: "Gigaviewer",
    run: (
      buffer: ArrayBuffer,
      ledger: OffscreenLiveResourceLedger,
      signal?: AbortSignal
    ) =>
      descrambleGigaviewerImage(
        buffer,
        "image/png",
        signal,
        ledger,
        ledger.reserve(buffer.byteLength, "source")
      ),
  },
]

for (const { name, run } of reconstructors) {
  describe(`${name} image ownership`, () => {
    it("releases source ownership when cancellation precedes decode", async () => {
      const createImageBitmap = vi.fn()
      vi.stubGlobal("createImageBitmap", createImageBitmap)
      vi.stubGlobal("OffscreenCanvas", class {})
      const signal = AbortSignal.abort(new Error("Stopped"))
      const ledger = new OffscreenLiveResourceLedger()
      await expect(run(pngHeader(), ledger, signal)).rejects.toBe(signal.reason)
      expect(createImageBitmap).not.toHaveBeenCalled()
      expect(ledger.getUsedBytes()).toBe(0)
    })

    it.each([
      "missing canvas",
      "encoding failure",
      "oversized output",
      "readback failure",
    ])("releases temporary resources after %s", async (failure) => {
      const close = vi.fn()
      const cause = new Error("Output failed")
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => ({ width: 32, height: 32, close }))
      )
      vi.stubGlobal(
        "OffscreenCanvas",
        class {
          getContext() {
            return failure === "missing canvas" ? null : { drawImage: vi.fn() }
          }
          async convertToBlob() {
            if (failure === "encoding failure") throw cause
            return {
              size: failure === "oversized output" ? MAX_IMAGE_BYTES + 1 : 3,
              type: "image/png",
              arrayBuffer: async () => {
                throw cause
              },
            }
          }
        }
      )
      const ledger = new OffscreenLiveResourceLedger()
      const promise = run(pngHeader(), ledger)
      if (failure === "encoding failure" || failure === "readback failure")
        await expect(promise).rejects.toBe(cause)
      else await expect(promise).rejects.toThrow()
      expect(close).toHaveBeenCalledOnce()
      expect(ledger.getUsedBytes()).toBe(0)
    })
  })
}
