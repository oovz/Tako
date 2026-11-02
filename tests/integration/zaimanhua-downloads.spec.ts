import { afterEach, describe, expect, it, vi } from "vitest"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { backgroundSiteAdapter } from "@/src/site-integrations/mangaagain/background-runtime"
import { offscreenSiteAdapter } from "@/src/site-integrations/mangaagain/offscreen-runtime"
import contractFixture from "@/tests/fixtures/site-integrations/mangaagain/contract.json"
import { SHONEN_JUMP_PLUS_SCRAMBLED_PNG } from "@/tests/e2e/fixtures/mock-data/site-integrations/shonenjumpplus/scrambled-image-fixture"

const fixture = contractFixture.data

const services: RateLimitService[] = []
function rateService() {
  const service = new RateLimitService({
    resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
  })
  services.push(service)
  return service
}
function response(url: string, value: unknown, status = 200): Response {
  const result = new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
  Object.defineProperty(result, "url", { value: url })
  return result
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    services.splice(0).map((service) => service.cleanupRateLimiters())
  )
})

describe("Zaimanhua adapter workflow", () => {
  it.each(["www.zaimanhua.com", "manhua.zaimanhua.com"])(
    "resolves %s with shared IDs, plans ordered pages and downloads through owned transport",
    async (host) => {
      const rateLimitService = rateService()
      const seen: string[] = []
      vi.stubGlobal(
        "fetch",
        vi.fn(async (raw: string, init: RequestInit) => {
          const url = new URL(raw)
          seen.push(url.pathname)
          if (url.hostname === "images.zaimanhua.com") {
            const result = new Response(
              new Uint8Array(SHONEN_JUMP_PLUS_SCRAMBLED_PNG),
              { headers: { "Content-Type": "image/png" } }
            )
            Object.defineProperty(result, "url", { value: raw })
            return result
          }
          expect(init.credentials).toBe("include")
          expect(new Headers(init.headers).get("Platform")).toBe("pc")
          return response(
            raw,
            url.pathname.includes("/chapter/")
              ? fixture.chapter
              : host === "manhua.zaimanhua.com"
                ? fixture.seriesComic2
                : fixture.series
          )
        })
      )
      const state =
        await backgroundSiteAdapter.background.series!.resolveSeriesData({
          seriesUrl: `https://${host}/info/doufo.html`,
          rateLimitService,
          siteIntegrationSettingsReader: {
            getAll: async () => ({}),
            getForSite: async () => ({}),
          },
        })
      expect(state.seriesId).toBe("83175")
      expect(state.seriesMetadata).toMatchObject({
        title: "斗佛",
        author: "画梦人",
        genres: ["格斗", "神鬼"],
      })
      const chapters = Array.isArray(state.chapterList)
        ? state.chapterList
        : state.chapterList!.chapters
      expect(chapters).toHaveLength(46)
      const chapter = chapters.find((item) => item.id === "195373")!
      const runtime = {
        rateLimitService,
        rateLimitSettings: {
          chapter: { concurrency: 1, delayMs: 0 },
          image: { concurrency: 1, delayMs: 0 },
        },
      }
      const plan =
        await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          chapter,
          { runtime }
        )
      expect(plan.imageUrls).toEqual(fixture.chapter.data.chapterInfo.page_url)
      expect(plan.imageUrls).toHaveLength(7)
      const ledger = new OffscreenLiveResourceLedger()
      const image = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
        plan.imageUrls[0],
        { runtime, liveResourceLedger: ledger }
      )
      expect(image.data.byteLength).toBe(SHONEN_JUMP_PLUS_SCRAMBLED_PNG.length)
      image.liveResourceLease.release()
      expect(seen).toContain(
        `/api/v1/${host === "www.zaimanhua.com" ? "comic1" : "comic2"}/chapter/detail`
      )
    }
  )

  it("surfaces rejected access and missing pages through the adapter", async () => {
    const rateLimitService = rateService()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(url, { errno: 401, errmsg: "session expired" })
      )
    )
    await expect(
      backgroundSiteAdapter.background.series!.resolveSeriesData({
        seriesUrl: "https://www.zaimanhua.com/info/doufo.html",
        rateLimitService,
        siteIntegrationSettingsReader: {
          getAll: async () => ({}),
          getForSite: async () => ({}),
        },
      })
    ).rejects.toThrow("unavailable")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(url, {
          ...fixture.chapter,
          data: {
            chapterInfo: { ...fixture.chapter.data.chapterInfo, page_url: [] },
          },
        })
      )
    )
    await expect(
      offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "195373",
          url: "https://www.zaimanhua.com/view/doufo/83175/195373",
        },
        {
          runtime: {
            rateLimitService,
            rateLimitSettings: {
              image: { concurrency: 1, delayMs: 0 },
              chapter: { concurrency: 1, delayMs: 0 },
            },
          },
        }
      )
    ).rejects.toThrow()
  })
})
