import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BinaryWriter } from "@bufbuild/protobuf/wire"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { backgroundSiteAdapter } from "@/src/site-integrations/mangaplus/background-runtime"
import { offscreen } from "@/src/site-integrations/mangamillion/offscreen-runtime"

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
const settings = { getAll: async () => ({}), getForSite: async () => ({}) }
function message(field: number, data: Uint8Array): Uint8Array {
  return new BinaryWriter().tag(field, 2).bytes(data).finish()
}
function response(data: Uint8Array): Response {
  return new Response(new Uint8Array(data).buffer, {
    headers: { "content-type": "application/octet-stream" },
  })
}
function chapter(
  id: number,
  options: {
    titleId?: number
    name?: string
    subtitle?: string
    start?: number
    end?: number
    type?: number
  } = {}
): Uint8Array {
  return new BinaryWriter()
    .tag(1, 0)
    .uint32(options.titleId ?? 7)
    .tag(2, 0)
    .uint32(id)
    .tag(3, 2)
    .string(options.name ?? `#${id}`)
    .tag(4, 2)
    .string(options.subtitle ?? "")
    .tag(6, 0)
    .uint32(options.start ?? 0)
    .tag(7, 0)
    .uint32(options.end ?? 0)
    .tag(16, 0)
    .uint32(options.type ?? 0)
    .finish()
}
function plusTitle(chapters: Uint8Array[], titleId = 7): Uint8Array {
  const title = new BinaryWriter()
    .tag(1, 0)
    .uint32(titleId)
    .tag(2, 2)
    .string("Series")
    .tag(3, 2)
    .string("Author")
    .finish()
  const detail = new BinaryWriter().raw(message(1, title))
  for (const entry of chapters) detail.raw(message(38, entry))
  return message(1, message(8, detail.finish()))
}
async function resolvePlus() {
  return backgroundSiteAdapter.background.series!.resolveSeriesData({
    seriesUrl: "https://mangaplus.shueisha.co.jp/titles/7",
    rateLimitService,
    siteIntegrationSettingsReader: settings,
  })
}
function installMillionViewer(viewer: Uint8Array) {
  return vi
    .spyOn(integrationHttpClient, "request")
    .mockImplementation(async (input) => {
      if (input.url.endsWith("/register"))
        return response(
          message(170, new BinaryWriter().tag(1, 2).string("token").finish())
        )
      return response(message(70, viewer))
    })
}
afterEach(() => {
  vi.restoreAllMocks()
  rateLimitService.cleanupRateLimiters()
})

describe("MANGA Plus catalog strategy boundaries", () => {
  it("keeps availability boundaries inclusive, locks future/expired/type-gated chapters and preserves first duplicate order", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000)
    vi.spyOn(integrationHttpClient, "request").mockResolvedValue(
      response(
        plusTitle([
          chapter(1, { start: 1001 }),
          chapter(2, { end: 999 }),
          chapter(3, { start: 1000, end: 1000 }),
          chapter(4, { type: 2 }),
          chapter(3, { subtitle: "Ignored duplicate" }),
          chapter(5, { name: "Special", subtitle: "  Bonus  " }),
        ])
      )
    )
    const result = await resolvePlus()
    expect(result.seriesMetadata).toMatchObject({
      title: "Series",
      author: "Author",
      language: "en",
      publisher: "Shueisha",
    })
    expect(result.seriesMetadata?.coverUrl).toBeUndefined()
    expect(result.chapterList).toEqual([
      expect.objectContaining({ id: "1", locked: true }),
      expect.objectContaining({ id: "2", locked: true }),
      expect.objectContaining({
        id: "3",
        title: "#3",
        chapterNumber: 3,
        locked: false,
      }),
      expect.objectContaining({ id: "4", locked: true }),
      expect.objectContaining({
        id: "5",
        title: "Bonus",
        chapterNumber: undefined,
        locked: false,
      }),
    ])
  })

  it.each([
    ["title", plusTitle([chapter(1)], 8)],
    ["chapter", plusTitle([chapter(1, { titleId: 8 })])],
  ] as const)("rejects a mismatching %s identity", async (_label, payload) => {
    vi.spyOn(integrationHttpClient, "request").mockResolvedValue(
      response(payload)
    )
    await expect(resolvePlus()).rejects.toThrow(/different title|another title/)
  })
})

describe("MangaMillion chapter strategy boundaries", () => {
  it("uses a chapter URL as the identifier fallback, filters missing page URLs and preserves image order without complete AES credentials", async () => {
    const first = "https://img.mangamillion.shueisha.co.jp/1.png"
    const second = "https://img.mangamillion.shueisha.co.jp/2.png"
    const viewer = new BinaryWriter()
      .raw(message(1, new Uint8Array()))
      .raw(message(1, new BinaryWriter().tag(1, 2).string(first).finish()))
      .raw(message(1, new BinaryWriter().tag(1, 2).string(second).finish()))
      .tag(7, 2)
      .string("partial-key")
      .finish()
    const request = installMillionViewer(viewer)
    const plan = await offscreen.chapter.resolveChapterPlan(
      {
        id: "missing",
        url: "https://mangamillion.shueisha.co.jp/ja/title/7/chapter/17",
      },
      { runtime }
    )
    expect(plan.imageUrls).toEqual([first, second])
    const viewerRequest = request.mock.calls.find(([input]) =>
      input.url.includes("/api/viewer")
    )?.[0]
    if (!viewerRequest) throw new Error("Expected a viewer request")
    expect(
      new URL(viewerRequest.url).searchParams.get("translated_chapter_id")
    ).toBe("17")
    expect(
      new URL(viewerRequest.url).searchParams.get("service_language")
    ).toBe("ja")
  })

  it.each([new Uint8Array(), message(1, new Uint8Array())])(
    "rejects an empty usable page set",
    async (viewer) => {
      installMillionViewer(viewer)
      await expect(
        offscreen.chapter.resolveChapterPlan(
          { id: "17", url: "not a series URL" },
          { runtime }
        )
      ).rejects.toThrow(/No pages|No valid image URLs/)
    }
  )

  it("rejects an unusable chapter identity before requesting a viewer", async () => {
    const request = vi.spyOn(integrationHttpClient, "request")
    await expect(
      offscreen.chapter.resolveChapterPlan(
        { id: "missing", url: "not a series URL" },
        { runtime }
      )
    ).rejects.toThrow(/identifier/)
    expect(request).not.toHaveBeenCalled()
  })

  it.each(["cover", "chapter"] as const)(
    "retains plaintext %s output until the caller releases it",
    async (kind) => {
      const png = new Uint8Array(readFileSync("public/icon/16.png"))
      const request = vi
        .spyOn(integrationHttpClient, "request")
        .mockResolvedValue(response(png))
      const ledger = new OffscreenLiveResourceLedger()
      const url = "https://img.mangamillion.shueisha.co.jp/page.png"
      const result = await offscreen[kind]!.downloadImage(
        kind === "chapter" ? `${url}#k=partial-key` : url,
        { runtime, liveResourceLedger: ledger }
      )
      expect(new Uint8Array(result.data)).toEqual(png)
      expect(result.filename).toBe("page.png")
      expect(result.mimeType).toBe("image/png")
      expect(request.mock.calls[0][0].url).toBe(url)
      expect(ledger.getUsedBytes()).toBe(png.byteLength)
      result.liveResourceLease.release()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  )
})
