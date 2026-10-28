import { afterEach, describe, expect, it, vi } from "vitest"
import { Window } from "happy-dom"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { offscreenSiteAdapter } from "@/src/site-integrations/copymanga/offscreen-runtime"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"
import contractFixture from "@/tests/fixtures/site-integrations/copymanga/contract.json"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { PAGE_PNG } from "@/tests/e2e/fixtures/mock-data/site-integrations/expanded-site-fixture"

const fixture = contractFixture.data

const services: RateLimitService[] = []
const windows: Window[] = []
function setup(host: string) {
  const rateLimitService = new RateLimitService({
    resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
  })
  services.push(rateLimitService)
  const window = new Window()
  windows.push(window)
  window.document.body.innerHTML = `<div class='comicParticulars-title'><h6>一拳超人</h6></div><div class='comicParticulars-left-img'><img data-src='https://sy.mangafunb.fun/cover.jpg'></div><p class='intro'>A hero's story</p><span id='dnt' value='9'></span><script>var ccz='${fixture.key}';</script>`
  return {
    document: window.document as unknown as Document,
    html: window.document.documentElement.outerHTML,
    seriesUrl: `https://${host}/comic/yiquanchaoren`,
    requestId: "series",
    rateLimitService,
  }
}
function response(
  url: string,
  value: unknown,
  type = "application/json"
): Response {
  const result = new Response(
    type === "text/html" ? String(value) : JSON.stringify(value),
    { headers: { "Content-Type": `${type}; charset=utf-8` } }
  )
  Object.defineProperty(result, "url", { value: url })
  return result
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    services.splice(0).map((service) => service.cleanupRateLimiters())
  )
  for (const window of windows.splice(0)) await window.happyDOM.close()
})

describe("Copy adapter workflow", () => {
  it.each([null, "9\r\nx-extra: 1"])(
    "rejects missing or invalid catalog selectors before requesting data (%s)",
    async (selector) => {
      const input = setup("www.copy3000.com")
      const element = input.document.querySelector("#dnt")!
      if (selector === null) element.remove()
      else element.setAttribute("value", selector)
      const fetch = vi.fn()
      vi.stubGlobal("fetch", fetch)
      await expect(
        offscreenSiteAdapter.offscreen.series!.resolveSeriesData(input)
      ).rejects.toBeInstanceOf(ProviderContractError)
      expect(fetch).not.toHaveBeenCalled()
    }
  )
  it("fetches working CDN images without cookies and returns owned bytes", async () => {
    const input = setup("www.copy3000.com")
    const url = "https://sd.mangafunb.fun/d/dianjuren/page.png"
    vi.stubGlobal(
      "fetch",
      vi.fn(async (requestUrl: string, init: RequestInit) => {
        expect(requestUrl).toBe(url)
        expect(init.credentials).toBe("omit")
        return new Response(new Uint8Array(PAGE_PNG).buffer, {
          headers: { "Content-Type": "image/png" },
        })
      })
    )
    const ledger = new OffscreenLiveResourceLedger()
    const image = await offscreenSiteAdapter.offscreen.chapter.downloadImage(
      url,
      {
        runtime: {
          rateLimitService: input.rateLimitService,
          rateLimitSettings: {
            image: { concurrency: 1, delayMs: 0 },
            chapter: { concurrency: 1, delayMs: 0 },
          },
        },
        liveResourceLedger: ledger,
      }
    )
    expect(new Uint8Array(image.data)).toEqual(new Uint8Array(PAGE_PNG))
    expect(ledger.getUsedBytes()).toBe(PAGE_PNG.byteLength)
    image.liveResourceLease.release()
    expect(ledger.getUsedBytes()).toBe(0)
  })
  it.each(["www.copy3000.com", "www.copy4000.com"])(
    "resolves %s catalog and complete encrypted reader pages",
    async (host) => {
      const input = setup(host)
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
          expect(init.credentials).toBe("include")
          if (url.endsWith("/chapters")) {
            expect(new Headers(init.headers).get("dnts")).toBe("9")
            expect(new Headers(init.headers).get("content-type")).toBe(
              "application/x-www-form-urlencoded;charset=UTF-8"
            )
            return response(url, fixture.catalog)
          }
          return response(
            url,
            `<script>var cct='${fixture.key}';var contentKey='${fixture.readerPayload}';</script><img src='https://ads.example/ad.jpg'>`,
            "text/html"
          )
        })
      )
      const state =
        await offscreenSiteAdapter.offscreen.series!.resolveSeriesData(input)
      expect(state.seriesId).toBe("yiquanchaoren")
      expect(state.seriesMetadata?.title).toBe("一拳超人")
      const chapters = Array.isArray(state.chapterList)
        ? state.chapterList
        : state.chapterList!.chapters
      expect(chapters).toHaveLength(490)
      const chapter = chapters.find(
        (item) => item.id === "fd1b3104-c2d4-11f1-b213-fa163e02432f"
      )!
      const plan =
        await offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
          chapter,
          {
            runtime: {
              rateLimitService: input.rateLimitService,
              rateLimitSettings: {
                image: { concurrency: 1, delayMs: 0 },
                chapter: { concurrency: 1, delayMs: 0 },
              },
            },
          }
        )
      expect(plan.imageUrls).toHaveLength(14)
      expect(plan.imageUrls[0]).toContain("1791435778960012.jpg")
      expect(plan.imageUrls.some((url) => url.includes("ads.example"))).toBe(
        false
      )
    }
  )

  it("rejects failed dynamic catalog requests instead of reporting empty success", async () => {
    const input = setup("www.copy3000.com")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(url, { code: 403, message: "access rejected" })
      )
    )
    await expect(
      offscreenSiteAdapter.offscreen.series!.resolveSeriesData(input)
    ).rejects.toThrow("unavailable")
  })

  it("rejects HTTP-success unavailable reader content before image output", async () => {
    const input = setup("www.copy3000.com")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(url, fixture.unavailableReaderHtml, "text/html")
      )
    )
    await expect(
      offscreenSiteAdapter.offscreen.chapter.resolveChapterPlan(
        {
          id: "fd1b3104-c2d4-11f1-b213-fa163e02432f",
          url: "https://www.copy3000.com/comic/yiquanchaoren/chapter/fd1b3104-c2d4-11f1-b213-fa163e02432f",
        },
        {
          runtime: {
            rateLimitService: input.rateLimitService,
            rateLimitSettings: {
              image: { concurrency: 1, delayMs: 0 },
              chapter: { concurrency: 1, delayMs: 0 },
            },
          },
        }
      )
    ).rejects.toBeInstanceOf(ProviderContractError)
  })
})
