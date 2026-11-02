import { afterEach, describe, expect, it, vi } from "vitest"
import contract from "@/tests/fixtures/site-integrations/comictropics/contract.json"
import { buildPublusImageUrlsFromConfig } from "@/src/site-integrations/comictropics/publus-config"
import {
  appendPublusImageMetadata,
  descramblePublusImage,
  parsePublusImageTransportUrl,
} from "@/src/site-integrations/comictropics/publus-image"
import {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLimitError,
} from "@/src/runtime/offscreen-live-resource-ledger"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"

function admittedMetadata(tileWidth: number, tileHeight: number) {
  const config = structuredClone(contract.data.publusConfig)
  const page =
    config["item/xhtml/p-000.xhtml"].FileLinkInfo.PageLinkInfoList[0].Page
  page.BlockWidth = tileWidth
  page.BlockHeight = tileHeight
  const [url] = buildPublusImageUrlsFromConfig(
    "https://cdn.comicnettai.com/9_hash/epub/book_contents/c958/",
    config
  )
  if (!url) throw new Error("Configuration did not produce an image")
  const { metadata } = parsePublusImageTransportUrl(url)
  if (!metadata)
    throw new Error("Configuration did not admit reconstruction metadata")
  return metadata
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

function renderer(width: number, height: number, stopOnDraw = false) {
  const drawStop = new Error("bounded drawing sentinel")
  const drawImage = vi.fn(() => {
    if (stopOnDraw) throw drawStop
  })
  const close = vi.fn()
  const createBitmap = vi.fn(async () => ({ width, height, close }))
  const createCanvas = vi.fn()
  const convertToBlob = vi.fn(
    async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
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
  return {
    drawImage,
    drawStop,
    close,
    createBitmap,
    createCanvas,
    convertToBlob,
  }
}

function reconstruct(
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
  ledger: OffscreenLiveResourceLedger,
  signal?: AbortSignal
) {
  const source = pngHeader(width, height)
  return descramblePublusImage(
    source,
    "image/png",
    admittedMetadata(tileWidth, tileHeight),
    signal,
    ledger,
    ledger.reserve(source.byteLength, "source")
  )
}

afterEach(() => vi.unstubAllGlobals())

describe("PUBLUS derived grid bounds", () => {
  it.each([
    {
      axis: "columns",
      width: 32,
      height: 2048,
      tileWidth: 1 / 2048,
      tileHeight: 2048,
    },
    {
      axis: "rows",
      width: 2048,
      height: 32,
      tileWidth: 2048,
      tileHeight: 1 / 2048,
    },
  ])(
    "rejects 16-bit $axis overflow before allocating or drawing the reconstruction",
    async ({ width, height, tileWidth, tileHeight }) => {
      // Exactly 65,536 cells along one axis: the original packed count becomes zero.
      // The drawing sentinel bounds the old consumer after its first draw; this
      // never invokes the potentially multi-billion-cell two-axis configuration.
      const canvas = renderer(width, height, true)
      const ledger = new OffscreenLiveResourceLedger()
      await expect(
        reconstruct(width, height, tileWidth, tileHeight, ledger)
      ).rejects.toBeInstanceOf(ProviderContractError)
      expect(canvas.createCanvas).not.toHaveBeenCalled()
      expect(canvas.drawImage).not.toHaveBeenCalled()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )

  it("rejects an in-range grid that amplifies work beyond source pixels", async () => {
    const canvas = renderer(32, 32, true)
    const ledger = new OffscreenLiveResourceLedger()
    await expect(reconstruct(32, 32, 0.5, 1, ledger)).rejects.toBeInstanceOf(
      ProviderContractError
    )
    expect(canvas.createCanvas).not.toHaveBeenCalled()
    expect(canvas.drawImage).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("continues to reconstruct bounded fractional tile dimensions", async () => {
    const canvas = renderer(32, 32)
    const ledger = new OffscreenLiveResourceLedger()
    let drawUsage = 0
    canvas.drawImage.mockImplementation(() => {
      drawUsage = ledger.getUsedBytes()
    })
    const result = await reconstruct(32, 32, 0.5, 2, ledger)
    expect(canvas.drawImage).toHaveBeenCalledTimes(1024)
    expect(drawUsage).toBeGreaterThan(24 + 32 * 32 * 8)
    expect(canvas.close).toHaveBeenCalledOnce()
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]))
    expect(ledger.getUsedBytes()).toBe(result.data.byteLength)
    result.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })
  it("preserves cancellation before starting an invalid grid reconstruction", async () => {
    const canvas = renderer(32, 2048, true)
    const ledger = new OffscreenLiveResourceLedger()
    const controller = new AbortController()
    const reason = new Error("chapter canceled")
    controller.abort(reason)
    await expect(
      reconstruct(32, 2048, 1 / 2048, 2048, ledger, controller.signal)
    ).rejects.toBe(reason)
    expect(canvas.createBitmap).not.toHaveBeenCalled()
    expect(canvas.createCanvas).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("reconstructs the single-cell grid and both remainder edges", async () => {
    const canvas = renderer(32, 32)
    const ledger = new OffscreenLiveResourceLedger()
    const result = await reconstruct(32, 32, 20, 20, ledger)
    expect(canvas.drawImage).toHaveBeenCalledTimes(4)
    expect(canvas.close).toHaveBeenCalledOnce()
    result.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })
  it("rejects a plan that exceeds the live-resource budget before decoding or creating a canvas", async () => {
    const canvas = renderer(32, 32, true)
    // Pixel surfaces fit, but the admitted 1,024-cell plan must also fit.
    const ledger = new OffscreenLiveResourceLedger(32 * 32 * 8 + 1024)
    await expect(reconstruct(32, 32, 0.5, 2, ledger)).rejects.toBeInstanceOf(
      OffscreenLiveResourceLimitError
    )
    expect(canvas.createBitmap).not.toHaveBeenCalled()
    expect(canvas.createCanvas).not.toHaveBeenCalled()
    expect(canvas.drawImage).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("preserves the drawing failure and releases the retained plan with other resources", async () => {
    const canvas = renderer(32, 32, true)
    const ledger = new OffscreenLiveResourceLedger()
    await expect(reconstruct(32, 32, 20, 20, ledger)).rejects.toBe(
      canvas.drawStop
    )
    expect(canvas.drawImage).toHaveBeenCalledOnce()
    expect(canvas.close).toHaveBeenCalledOnce()
    expect(canvas.convertToBlob).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })
  it("keeps admitted wider numeric seeds from changing the validated single-cell layout", async () => {
    const original = admittedMetadata(32, 32)
    const transport = appendPublusImageMetadata(
      "https://cdn.comicnettai.com/page.jpeg",
      {
        ...original,
        seed1: original.seed1 + 4294967296,
        seed2: original.seed2 + 4294967296,
      }
    )
    const { metadata } = parsePublusImageTransportUrl(transport)
    if (!metadata)
      throw new Error("Wider finite seed metadata was not admitted")
    const canvas = renderer(32, 32)
    const ledger = new OffscreenLiveResourceLedger()
    const source = pngHeader(32, 32)
    const result = await descramblePublusImage(
      source,
      "image/png",
      metadata,
      undefined,
      ledger,
      ledger.reserve(source.byteLength, "source")
    )
    try {
      expect(canvas.drawImage).toHaveBeenCalledOnce()
      expect(canvas.drawImage).toHaveBeenCalledWith(
        expect.anything(),
        0,
        0,
        32,
        32,
        0,
        0,
        32,
        32
      )
    } finally {
      result.liveResourceLease.release()
    }
    expect(ledger.getUsedBytes()).toBe(0)
  })
})
