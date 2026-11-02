import { afterEach, describe, expect, it, vi } from "vitest"
import { downloadComicNettaiCoverImage } from "@/src/site-integrations/comictropics/chapter-api"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { RateLimitService } from "@/src/runtime/rate-limit"

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
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII=",
    "base64"
  )
)

afterEach(() => {
  vi.unstubAllGlobals()
  rateLimitService.cleanupRateLimiters()
})

describe("Comic Nettai cover download", () => {
  it("downloads the trusted cover with omitted credentials and transfers ownership to its caller", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(png, {
          status: 200,
          headers: { "content-type": "image/png" },
        })
    )
    vi.stubGlobal("fetch", fetch)
    const ledger = new OffscreenLiveResourceLedger()
    const result = await downloadComicNettaiCoverImage(
      "https://cdn.comicnettai.com/covers/9.png",
      { runtime, liveResourceLedger: ledger }
    )
    expect(fetch).toHaveBeenCalledWith(
      "https://cdn.comicnettai.com/covers/9.png",
      expect.objectContaining({ credentials: "omit" })
    )
    expect(result.filename).toBe("9.png")
    expect(result.mimeType).toBe("image/png")
    expect(new Uint8Array(result.data)).toEqual(png)
    expect(ledger.getUsedBytes()).toBe(png.byteLength)
    result.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("rejects a cover outside the provider CDN before issuing a request", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const ledger = new OffscreenLiveResourceLedger()
    await expect(
      downloadComicNettaiCoverImage("https://attacker.example/cover.png", {
        runtime,
        liveResourceLedger: ledger,
      })
    ).rejects.toThrow("trusted Comic Nettai CDN")
    expect(fetch).not.toHaveBeenCalled()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("starts no cover request when the caller is already canceled", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const controller = new AbortController()
    controller.abort()
    await expect(
      downloadComicNettaiCoverImage(
        "https://cdn.comicnettai.com/covers/9.png",
        {
          runtime,
          signal: controller.signal,
          liveResourceLedger: new OffscreenLiveResourceLedger(),
        }
      )
    ).rejects.toThrow("aborted")
    expect(fetch).not.toHaveBeenCalled()
  })
})
