import { afterEach, describe, expect, it, vi } from "vitest"
import { Window } from "happy-dom"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import contract from "@/tests/fixtures/site-integrations/coolmic/contract.json"
import { offscreenSiteAdapter } from "@/src/site-integrations/coolmic/offscreen-runtime"
import { fetchCoolmicTitle } from "@/src/site-integrations/coolmic/api"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABoAAAACCAYAAABGz8w4AAAASUlEQVR4nL3NEQKAQAAAsNM0TYMkTdM0PU3TNE3TNE3TNE3TXlJ7RTBeCEV8E1IyckoqahpaIh09AyMTMwsrGzsHJxc3D+Gv6AOqBmUPS959fwAAAABJRU5ErkJggg==",
  "base64"
)
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
const windows: Window[] = []
const titlePage = readFileSync(
  resolve("tests/fixtures/site-integrations/coolmic/title-page.html"),
  "utf8"
)
afterEach(async () => {
  vi.unstubAllGlobals()
  rateLimitService.cleanupRateLimiters()
  for (const window of windows.splice(0)) await window.happyDOM.close()
})
function response(
  body: string | Uint8Array,
  type: string,
  url: string,
  status = 200
) {
  const result = new Response(
    typeof body === "string" ? body : new Uint8Array(body).buffer,
    {
      status,
      headers: { "content-type": type },
    }
  )
  Object.defineProperty(result, "url", { value: url })
  return result
}
function installFetch(viewer: unknown = contract.data.viewer) {
  const fetcher = vi.fn(async (url: string) => {
    const parsed = new URL(url)
    if (parsed.pathname.startsWith("/titles/"))
      return response(titlePage, "text/html; charset=utf-8", url)
    if (parsed.pathname.includes("/api/"))
      return response(JSON.stringify(viewer), "application/json", url)
    expect(parsed.origin).toBe("https://en-contents.coolmic.me")
    expect(parsed.searchParams.get("Signature")).toBe("synthetic-signature")
    return response(png, "binary/octet-stream", url)
  })
  vi.stubGlobal("fetch", fetcher)
  return fetcher
}
const chapter = { id: "130687", url: "https://coolmic.me/episodes/130687" }
describe("Coolmic website download transport", () => {
  it("resolves the title bootstrap, keeps locked episodes unavailable and downloads authorized ordered images", async () => {
    installFetch()
    const html = await fetchCoolmicTitle("5101", rateLimitService)
    const window = new Window()
    windows.push(window)
    window.document.write(html)
    const series =
      await offscreenSiteAdapter.offscreen.series!.resolveSeriesData({
        requestId: "series",
        seriesUrl: "https://coolmic.me/titles/5101",
        html,
        document: window.document as unknown as Document,
        rateLimitService,
      })
    expect(series.seriesMetadata?.title).toBe("Love Me! P.S. I'm Awesome")
    const chapters = series.chapterList
    if (!Array.isArray(chapters)) throw new Error("Expected Coolmic chapters")
    expect(chapters).toHaveLength(53)
    expect(chapters.filter((entry) => !entry.locked)).toHaveLength(5)
    expect(chapters[0]).toMatchObject({ id: "130687", locked: false })
    expect(chapters[5]).toMatchObject({ id: "130692", locked: true })
    expect(chapters.at(-1)).toMatchObject({
      id: "130739",
      locked: true,
    })
    const plan =
      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(chapter, {
        runtime,
      })
    expect(plan.imageUrls).toEqual(
      contract.data.viewer.image_data.map((image) => image.path)
    )
    expect(plan.imageUrls).toHaveLength(31)
    expect(plan.imageUrls.every((url) => !url.includes("Signature"))).toBe(true)
    for (const url of plan.imageUrls) {
      const image = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        url,
        { runtime, liveResourceLedger: new OffscreenLiveResourceLedger() }
      )
      expect(new Uint8Array(image.data)).toEqual(new Uint8Array(png))
      image.liveResourceLease.release()
    }
  })
  it("rejects HTTP-success unavailable readers and missing required sequence entries", async () => {
    installFetch({ error: "locked" })
    await expect(
      offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(chapter, {
        runtime,
      })
    ).rejects.toThrow(/unavailable/)
    installFetch({
      ...contract.data.viewer,
      image_data: [{ ...contract.data.viewer.image_data[0], num: 1 }],
    })
    await expect(
      offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(chapter, {
        runtime,
      })
    ).rejects.toThrow(/sequence/)
  })
  it("releases CDN credentials on cancellation and keeps signed transport details out of failures", async () => {
    installFetch()
    const abort = new AbortController()
    const plan =
      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(chapter, {
        runtime,
        signal: abort.signal,
      })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("failed URL Signature=synthetic-signature")
      })
    )
    await expect(
      offscreenSiteAdapter.offscreen.chapter.downloadImage(plan.imageUrls[0], {
        runtime,
        liveResourceLedger: new OffscreenLiveResourceLedger(),
      })
    ).rejects.toThrow(/^Coolmic image request failed$/)
    abort.abort()
    await expect(
      offscreenSiteAdapter.offscreen.chapter.downloadImage(plan.imageUrls[0], {
        runtime,
        liveResourceLedger: new OffscreenLiveResourceLedger(),
      })
    ).rejects.toThrow(/expired/)
  })
})
