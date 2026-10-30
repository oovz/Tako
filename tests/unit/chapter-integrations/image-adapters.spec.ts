import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { offscreenSiteAdapter as mangago } from "@/src/site-integrations/mangago/offscreen-runtime"
import { offscreenSiteAdapter as shonen } from "@/src/site-integrations/shonenjumpplus/offscreen-runtime"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"

const fetchImage = vi.hoisted(() => vi.fn())
vi.mock("@/src/runtime/fetch-image", () => ({
  fetchImageWithStallDetection: fetchImage,
}))
const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const runtime = {
  rateLimitService,
  rateLimitSettings: {
    image: { concurrency: 1, delayMs: 0 },
    chapter: { concurrency: 1, delayMs: 0 },
  },
}
beforeEach(() => fetchImage.mockReset())
afterEach(() => {
  vi.unstubAllGlobals()
  rateLimitService.cleanupRateLimiters()
})

function imageResult(ledger: OffscreenLiveResourceLedger) {
  const data = new ArrayBuffer(3)
  const liveResourceLease = ledger.reserve(3, "downloaded image")
  return { data, mimeType: "image/jpeg", liveResourceLease }
}

describe("Image adapter ownership", () => {
  it.each([
    {
      name: "Mangago",
      adapter: mangago,
      url: "https://iweb_9.mangapicgallery.com/r/coverlink/cover.jpg",
      filename: "cover.jpg",
    },
    {
      name: "Shonen Jump+",
      adapter: shonen,
      url: "https://cdn-ak.shonenjumpplus.com/cover.jpg",
      filename: "cover.jpg",
    },
    {
      name: "Shonen Jump+ fallback filename",
      adapter: shonen,
      url: "https://cdn-ak.shonenjumpplus.com/",
      filename: "cover.jpg",
    },
  ])(
    "retains the downloaded lease for $name covers",
    async ({ adapter, url, filename }) => {
      const ledger = new OffscreenLiveResourceLedger()
      const fetched = imageResult(ledger)
      fetchImage.mockResolvedValueOnce(fetched)
      const signal = new AbortController().signal
      const onBytesReceived = vi.fn()
      const result = await adapter.offscreen.cover!.downloadImage(url, {
        runtime,
        signal,
        onBytesReceived,
        skipRateLimit: true,
        liveResourceLedger: ledger,
      })
      expect(result).toEqual({ ...fetched, filename })
      expect(fetchImage).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          signal,
          init: { credentials: "omit" },
          skipRateLimit: true,
          onBytesReceived,
          liveResourceLedger: ledger,
        })
      )
      result.liveResourceLease.release()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )

  it.each([mangago, shonen])(
    "rejects untrusted covers before downloading",
    async (adapter) => {
      await expect(
        adapter.offscreen.cover!.downloadImage(
          "https://attacker.example/cover.jpg",
          { runtime, liveResourceLedger: new OffscreenLiveResourceLedger() }
        )
      ).rejects.toThrow()
      expect(fetchImage).not.toHaveBeenCalled()
    }
  )

  it("preserves direct Shonen Jump+ chapter bytes and the filename fallback", async () => {
    const ledger = new OffscreenLiveResourceLedger()
    const fetched = imageResult(ledger)
    fetchImage.mockResolvedValueOnce(fetched)
    const result = await shonen.offscreen.chapter.downloadImage(
      "https://cdn-ak.shonenjumpplus.com/",
      { runtime, liveResourceLedger: ledger }
    )
    expect(result).toEqual({ ...fetched, filename: "image.jpg" })
    result.liveResourceLease.release()
  })

  it("stops a canceled Shonen Jump+ download before allocating bytes", async () => {
    await expect(
      shonen.offscreen.chapter.downloadImage(
        "https://cdn-ak.shonenjumpplus.com/page.jpg",
        {
          runtime,
          signal: AbortSignal.abort(),
          liveResourceLedger: new OffscreenLiveResourceLedger(),
        }
      )
    ).rejects.toThrow()
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it("reconstructs Mangago transport metadata and transfers the final output", async () => {
    const buffer = new ArrayBuffer(24)
    const bytes = new Uint8Array(buffer)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    new DataView(buffer).setUint32(16, 32)
    new DataView(buffer).setUint32(20, 32)
    const ledger = new OffscreenLiveResourceLedger()
    fetchImage.mockResolvedValueOnce({
      data: buffer,
      mimeType: "image/png",
      liveResourceLease: ledger.reserve(buffer.byteLength, "source"),
    })
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 32, height: 32, close: vi.fn() }))
    )
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: vi.fn() }
        }
        async convertToBlob() {
          return new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
        }
      }
    )
    const url = "https://iweb_9.mangapicgallery.com/r/cspiclink/page.jpg"
    const result = await mangago.offscreen.chapter.downloadImage(
      `${url}#mg-grid=2:2,0,3,1`,
      { runtime, liveResourceLedger: ledger }
    )
    expect(fetchImage.mock.calls[0][0]).toBe(url)
    expect(result).toMatchObject({
      filename: "page.png",
      mimeType: "image/png",
    })
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]))
    expect(ledger.getUsedBytes()).toBe(3)
    result.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })
})
