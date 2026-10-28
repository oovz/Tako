import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { offscreenSiteAdapter } from "@/src/site-integrations/lovemanga/offscreen-runtime"
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
const chapter = {
  id: "133632",
  url: "https://www.aimanhua.org/chapter/416895/133632",
}
afterEach(() => {
  vi.unstubAllGlobals()
  rateLimitService.cleanupRateLimiters()
})
describe("Aimanhua runtime transport", () => {
  it("rejects a selected chapter whose identity differs from its reader URL", async () => {
    const html = readFileSync(
      "tests/fixtures/site-integrations/lovemanga/reader.html",
      "utf8"
    )
    const fetch = vi.fn(async (value: string) => {
      const response = new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
      Object.defineProperty(response, "url", { value })
      return response
    })
    vi.stubGlobal("fetch", fetch)
    await expect(
      offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        { ...chapter, id: "221966" },
        { runtime }
      )
    ).rejects.toThrow(/identity/i)
    expect(fetch).not.toHaveBeenCalled()
  })
  it("resolves the encoded page list through the declared reader endpoint", async () => {
    const html = readFileSync(
      "tests/fixtures/site-integrations/lovemanga/reader.html",
      "utf8"
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async (value: string) => {
        const response = new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
        Object.defineProperty(response, "url", { value })
        return response
      })
    )
    const plan =
      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(chapter, {
        runtime,
      })
    expect(plan.imageUrls).toHaveLength(73)
    expect(plan.imageUrls[0]).toContain(
      "/42a02a53c3246551a99d539f2f0f451c.webp"
    )
  })
  it("rejects an access failure instead of an empty successful plan", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Access denied", { status: 403 }))
    )
    await expect(
      offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(chapter, {
        runtime,
      })
    ).rejects.toThrow("403")
  })
})
