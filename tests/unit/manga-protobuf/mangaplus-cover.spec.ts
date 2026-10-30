import { afterEach, describe, expect, it, vi } from "vitest"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { offscreenSiteAdapter } from "@/src/site-integrations/mangaplus/offscreen-runtime"

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
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABoAAAACCAYAAABGz8w4AAAASUlEQVR4nL3NEQKAQAAAsNM0TYMkTdM0PU3TNE3TNE3TNE3TXlJ7RTBeCEV8E1IyckoqahpaIh09AyMTMwsrGzsHJxc3D+Gv6AOqBmUPS959fwAAAABJRU5ErkJggg==",
  "base64"
)
afterEach(() => {
  vi.restoreAllMocks()
  rateLimitService.cleanupRateLimiters()
})

describe("MANGA Plus public cover admission", () => {
  it("downloads an unencrypted cover without viewer access and retains its bytes for the caller", async () => {
    const request = vi
      .spyOn(integrationHttpClient, "request")
      .mockResolvedValue(
        new Response(new Uint8Array(png).buffer, {
          headers: { "content-type": "image/png" },
        })
      )
    const ledger = new OffscreenLiveResourceLedger()
    const result = await offscreenSiteAdapter.offscreen.cover!.downloadImage(
      "https://jumpg-assets3.tokyo-cdn.com/cover.png",
      { runtime, liveResourceLedger: ledger }
    )
    expect(result.mimeType).toBe("image/png")
    expect(result.filename).toBe("cover.png")
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array(png))
    expect(request.mock.calls[0][0].init?.headers).toBeUndefined()
    expect(ledger.getUsedBytes()).toBe(png.byteLength)
    result.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it.each([new Uint8Array([1, 2, 3]), new Uint8Array([0xff, 0xd8, 0xff])])(
    "releases a cover whose signature or dimensions are invalid",
    async (bytes) => {
      vi.spyOn(integrationHttpClient, "request").mockResolvedValue(
        new Response(bytes.buffer, {
          headers: { "content-type": "application/octet-stream" },
        })
      )
      const ledger = new OffscreenLiveResourceLedger()
      await expect(
        offscreenSiteAdapter.offscreen.cover!.downloadImage(
          "https://jumpg-assets3.tokyo-cdn.com/cover.jpg",
          { runtime, liveResourceLedger: ledger }
        )
      ).rejects.toThrow()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )
})
