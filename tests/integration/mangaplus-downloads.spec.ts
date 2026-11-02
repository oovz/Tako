import { afterEach, describe, expect, it, vi } from "vitest"
import { BinaryWriter } from "@bufbuild/protobuf/wire"
import contract from "@/tests/fixtures/site-integrations/mangaplus/contract.json"
import { backgroundSiteAdapter } from "@/src/site-integrations/mangaplus/background-runtime"
import { offscreenSiteAdapter } from "@/src/site-integrations/mangaplus/offscreen-runtime"
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
const controller = new AbortController()
afterEach(() => {
  vi.unstubAllGlobals()
  rateLimitService.cleanupRateLimiters()
})
function response(body: Uint8Array, type: string, url: string, status = 200) {
  const response = new Response(new Uint8Array(body).buffer, {
    status,
    headers: { "content-type": type },
  })
  Object.defineProperty(response, "url", { value: url })
  return response
}
function installFetch() {
  const fetcher = vi.fn(async (raw: string, init?: RequestInit) => {
    const url = new URL(raw)
    if (url.pathname.endsWith("title_detailV4")) {
      expect(new Headers(init?.headers).get("SESSION-TOKEN")).toMatch(
        /^[a-f0-9-]{36}$/
      )
      return response(
        Buffer.from(contract.data.titleResponseBase64, "base64"),
        "application/protobuf",
        raw
      )
    }
    if (url.pathname.endsWith("manga_viewer_v3"))
      return response(
        Buffer.from(contract.data.viewerResponseBase64, "base64"),
        "application/protobuf",
        raw
      )
    expect(new Headers(init?.headers).get("Plus-Vw-Token")).toBe(
      "synthetic-viewer-token"
    )
    const encoded = Uint8Array.from(
      png,
      (byte, index) => byte ^ [1, 2][index % 2]
    )
    return response(encoded, "application/octet-stream", raw)
  })
  vi.stubGlobal("fetch", fetcher)
  return fetcher
}
describe("MANGA Plus website download transport", () => {
  it("discards viewer access when a later image invalidates the chapter plan", async () => {
    const imageUrl = contract.data.imageUrls[0]
    const viewer = new BinaryWriter()
    for (const url of [imageUrl, "https://untrusted.example/page.png"]) {
      const image = new BinaryWriter()
        .tag(1, 2)
        .string(url)
        .tag(2, 0)
        .uint32(1110)
        .tag(3, 0)
        .uint32(1620)
        .tag(5, 2)
        .string("0102")
        .finish()
      const page = new BinaryWriter().tag(1, 2).bytes(image).finish()
      viewer.tag(1, 2).bytes(page)
    }
    viewer.tag(2, 0).uint32(1030661).tag(19, 2).string("synthetic-viewer-token")
    const payload = new BinaryWriter()
      .tag(1, 2)
      .bytes(new BinaryWriter().tag(10, 2).bytes(viewer.finish()).finish())
      .finish()
    const fetcher = vi.fn(async (raw: string) => {
      if (new URL(raw).pathname.endsWith("manga_viewer_v3"))
        return response(payload, "application/protobuf", raw)
      return response(
        Uint8Array.from(png, (byte, index) => byte ^ [1, 2][index % 2]),
        "application/octet-stream",
        raw
      )
    })
    vi.stubGlobal("fetch", fetcher)
    await expect(
      offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "1030661",
          url: "https://mangaplus.shueisha.co.jp/viewer/1030661",
        },
        { runtime }
      )
    ).rejects.toThrow(/untrusted/)
    const callsBeforeImage = fetcher.mock.calls.length
    await expect(
      offscreenSiteAdapter.offscreen.chapter.downloadImage(imageUrl, {
        runtime,
        liveResourceLedger: new OffscreenLiveResourceLedger(),
      })
    ).rejects.toThrow(/expired/)
    expect(fetcher).toHaveBeenCalledTimes(callsBeforeImage)
  })
  it("resolves the public catalog, keeps middle chapters locked and decrypts ordered chapter content", async () => {
    installFetch()
    const series =
      await backgroundSiteAdapter.background.series!.resolveSeriesData({
        seriesUrl: "https://mangaplus.shueisha.co.jp/titles/100467",
        language: "ja",
        rateLimitService,
        siteIntegrationSettingsReader: {
          getAll: async () => ({}),
          getForSite: async () => ({}),
        },
      })
    expect(series.seriesMetadata).toMatchObject({
      title: "Home at the Horizon",
      language: "en",
    })
    const chapters = series.chapterList
    if (!Array.isArray(chapters))
      throw new Error("Expected MANGA Plus chapters")
    expect(chapters).toHaveLength(14)
    expect(chapters[0]).toMatchObject({
      id: "1024395",
      title: "Chapter 1: Chance Meeting",
      locked: false,
    })
    expect(chapters.filter((chapter) => chapter.locked)).toMatchObject([
      { id: "1024563" },
      { id: "1029648" },
    ])
    expect(chapters.at(-1)).toMatchObject({
      id: "1030661",
      title: "Chapter 34: Speaking Up",
      locked: false,
    })
    const plan =
      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "1030661",
          url: "https://mangaplus.shueisha.co.jp/viewer/1030661",
        },
        { runtime, signal: controller.signal }
      )
    expect(plan.imageUrls).toEqual(contract.data.imageUrls)
    expect(plan.imageUrls).toHaveLength(23)
    const ledger = new OffscreenLiveResourceLedger()
    for (const url of plan.imageUrls) {
      const image = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        url,
        { runtime, liveResourceLedger: ledger }
      )
      expect(new Uint8Array(image.data)).toEqual(new Uint8Array(png))
      expect(image.mimeType).toBe("image/png")
      image.liveResourceLease.release()
    }
    await expect(
      offscreenSiteAdapter.offscreen.chapter.downloadImage(plan.imageUrls[0], {
        runtime,
        liveResourceLedger: ledger,
      })
    ).rejects.toThrow(/expired/)
  })
  it("releases viewer access on cancellation and rejects a protocol error even with HTTP success", async () => {
    installFetch()
    const canceled = new AbortController()
    const plan =
      await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "1030661",
          url: "https://mangaplus.shueisha.co.jp/viewer/1030661",
        },
        { runtime, signal: canceled.signal }
      )
    canceled.abort()
    await expect(
      offscreenSiteAdapter.offscreen.chapter.downloadImage(plan.imageUrls[0], {
        runtime,
        liveResourceLedger: new OffscreenLiveResourceLedger(),
      })
    ).rejects.toThrow(/expired/)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(new Uint8Array([18, 2, 8, 3]), "application/protobuf", url)
      )
    )
    await expect(
      offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "1030661",
          url: "https://mangaplus.shueisha.co.jp/viewer/1030661",
        },
        { runtime }
      )
    ).rejects.toThrow(/rejected.*3/)
  })
})
