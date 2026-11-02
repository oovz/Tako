import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Window } from "happy-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { offscreenSiteAdaptersById } from "@/src/runtime/generated/site-integration-offscreen-registry"
import { RateLimitService } from "@/src/runtime/rate-limit"
import contract from "@/tests/fixtures/site-integrations/mangago/contract.json"

const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const window = new Window()
const readerHtml = readFileSync(
  resolve("tests/fixtures/site-integrations/mangago/reader.html"),
  "utf8"
)
const input = {
  runtime: {
    rateLimitService,
    rateLimitSettings: {
      image: { concurrency: 1, delayMs: 0 },
      chapter: { concurrency: 1, delayMs: 0 },
    },
  },
}
const chapter = { id: "an:nml_chapter-420", url: contract.data.readerUrl }
afterEach(() => {
  vi.unstubAllGlobals()
  rateLimitService.cleanupRateLimiters()
})

describe("Mangago registered reader workflow", () => {
  it.each(["header", "late-meta"])(
    "uses %s encoding to resolve all required pages in order",
    async (encoding) => {
      vi.stubGlobal("DOMParser", window.DOMParser)
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url.includes("/js/chapter.js")
            ? new Response(contract.data.protocolScript, {
                headers: { "content-type": "application/javascript" },
              })
            : new Response(
                (encoding === "late-meta"
                  ? `<script>${" ".repeat(12_000)}</script><meta charset="utf-8">`
                  : "") + readerHtml,
                {
                  headers: {
                    "content-type":
                      encoding === "header"
                        ? "text/html; charset=utf-8"
                        : "text/html",
                  },
                }
              )
        )
      )
      const plan =
        await offscreenSiteAdaptersById.mangago.offscreen.chapter.resolveChapterPlan(
          chapter,
          input
        )
      expect(plan.imageUrls).toHaveLength(19)
      expect(plan.imageUrls[0]).toBe(contract.data.firstImage)
      expect(plan.imageUrls[18]).toBe(contract.data.lastImage)
    }
  )
  it("reports reader access failures", async () => {
    vi.stubGlobal("DOMParser", window.DOMParser)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Challenge", { status: 403 }))
    )
    await expect(
      offscreenSiteAdaptersById.mangago.offscreen.chapter.resolveChapterPlan(
        chapter,
        input
      )
    ).rejects.toMatchObject({ status: 403 })
  })
  it("rejects a reader whose chapter identity differs before making a privileged request", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    await expect(
      offscreenSiteAdaptersById.mangago.offscreen.chapter.resolveChapterPlan(
        { ...chapter, id: "nbt:other" },
        input
      )
    ).rejects.toThrow("does not match")
    expect(fetch).not.toHaveBeenCalled()
  })
})
