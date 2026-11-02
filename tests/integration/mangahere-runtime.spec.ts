import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { offscreenSiteAdapter } from "@/src/site-integrations/mangahere/offscreen-runtime"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
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
const htmlResponse = (html: string, url: string) => {
  const response = new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
  Object.defineProperty(response, "url", { value: url })
  return response
}
afterEach(() => {
  vi.unstubAllGlobals()
  rateLimitService.cleanupRateLimiters()
})
describe("MangaHere runtime transport", () => {
  it("resolves packed pages through declared endpoints and releases image ownership", async () => {
    const html = readFileSync(
      "tests/fixtures/site-integrations/mangahere/hunter-reader.html",
      "utf8"
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) => htmlResponse(html, value))
    )
    const plan =
      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "hunter_x_hunter/v01/c001",
          url: "https://newm.mangahere.cc/manga/hunter_x_hunter/v01/c001/1.html",
        },
        { runtime }
      )
    expect(plan.imageUrls).toHaveLength(33)
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) => {
        const response = new Response(imageBytes, {
          headers: { "content-type": "image/jpeg" },
        })
        Object.defineProperty(response, "url", { value })
        return response
      })
    )
    const ledger = new OffscreenLiveResourceLedger()
    const image = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
      plan.imageUrls[0],
      { runtime, liveResourceLedger: ledger }
    )
    expect(new Uint8Array(image.data)).toEqual(imageBytes)
    expect(image.liveResourceLease.bytes).toBe(4)
    image.liveResourceLease.release()
    expect(image.liveResourceLease.bytes).toBe(0)
  })
  it("rejects the unsupported legacy host before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "hunter_x_hunter/v01/c001",
          url: "https://m.mangahere.cc/manga/hunter_x_hunter/v01/c001/",
        },
        { runtime }
      )
    ).rejects.toThrow("origin is not allowed")
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("rejects a selected chapter whose identity differs from its reader URL", async () => {
    const html = readFileSync(
      "tests/fixtures/site-integrations/mangahere/hunter-reader.html",
      "utf8"
    )
    const fetchMock = vi.fn(async (value: string) => htmlResponse(html, value))
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "hunter_x_hunter/v01/c002",
          url: "https://newm.mangahere.cc/manga/hunter_x_hunter/v01/c001/1.html",
        },
        { runtime }
      )
    ).rejects.toThrow(/identity/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
