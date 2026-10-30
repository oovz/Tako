import { afterEach, describe, expect, it, vi } from "vitest"
import { descramblePixivImage } from "@/src/site-integrations/pixiv-comic/descrambler"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"

function imageHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}
function fixture() {
  const bitmap = { width: 70, height: 35, close: vi.fn() }
  const drawImage = vi.fn()
  const convertToBlob = vi.fn(
    async () => new Blob([new Uint8Array([1, 2])], { type: "image/png" })
  )
  const decode = vi.fn(async () => bitmap)
  vi.stubGlobal("createImageBitmap", decode)
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return { drawImage }
      }
      convertToBlob = convertToBlob
    }
  )
  const ledger = new OffscreenLiveResourceLedger()
  const buffer = imageHeader(bitmap.width, bitmap.height)
  const sourceLease = ledger.reserve(buffer.byteLength, "encoded source")
  const run = () =>
    descramblePixivImage(
      buffer,
      "image/png",
      "key",
      "https://img-comic.pximg.net/gridshuffle32:32.png",
      undefined,
      ledger,
      sourceLease
    )
  return { bitmap, drawImage, convertToBlob, decode, ledger, run }
}

afterEach(() => vi.unstubAllGlobals())

describe("Pixiv image reconstruction ownership", () => {
  it("draws full tiles and the partial right and bottom edges exactly once", async () => {
    const { run, drawImage, bitmap, ledger } = fixture()
    const result = await run()
    const destinations = drawImage.mock.calls.map((args) => args.slice(5))
    expect(destinations).toEqual([
      [0, 0, 32, 32],
      [32, 0, 32, 32],
      [64, 0, 6, 32],
      [0, 32, 32, 3],
      [32, 32, 32, 3],
      [64, 32, 6, 3],
    ])
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2]))
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(2)
    result.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("releases encoded and reserved decoded ownership if bitmap decoding fails", async () => {
    const { run, decode, bitmap, ledger } = fixture()
    decode.mockRejectedValueOnce(new Error("decode failed"))
    await expect(run()).rejects.toThrow("decode failed")
    expect(bitmap.close).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("closes the bitmap and releases all ownership if output encoding fails", async () => {
    const { run, convertToBlob, bitmap, ledger } = fixture()
    convertToBlob.mockRejectedValueOnce(new Error("encode failed"))
    await expect(run()).rejects.toThrow("encode failed")
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("releases output Blob and buffer reservations if reading the encoded output fails", async () => {
    const { run, convertToBlob, bitmap, ledger } = fixture()
    const blob = new Blob([new Uint8Array([1])], { type: "image/png" })
    vi.spyOn(blob, "arrayBuffer").mockRejectedValueOnce(
      new Error("buffer failed")
    )
    convertToBlob.mockResolvedValueOnce(blob)
    await expect(run()).rejects.toThrow("buffer failed")
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(ledger.getUsedBytes()).toBe(0)
  })
})
