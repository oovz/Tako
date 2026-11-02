import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { backgroundSiteAdapter } from "@/src/site-integrations/shonenjumpplus/background-runtime"
import { RateLimitService } from "@/src/runtime/rate-limit"

const request = vi.hoisted(() => vi.fn())
vi.mock("@/src/site-integrations/http-client", () => ({
  integrationHttpClient: { request },
}))
const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const input = {
  seriesUrl: "https://shonenjumpplus.com/episode/123",
  rateLimitService,
  siteIntegrationSettingsReader: {
    getAll: async () => ({}),
    getForSite: async () => ({}),
  },
}
function html(metadata: unknown = {}): string {
  const encoded = JSON.stringify(metadata).replaceAll('"', "&quot;")
  return `<div class="js-readable-products-pagination" data-aggregate-id="456"></div><script id="episode-json" data-value="${encoded}"></script>`
}
function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}
const resolveSeries = backgroundSiteAdapter.background.series!.resolveSeriesData
beforeEach(() => request.mockReset())
afterEach(() => rateLimitService.cleanupRateLimiters())

describe("Shonen Jump+ background resolution", () => {
  it("returns validated metadata and chapters using public requests", async () => {
    const signal = new AbortController().signal
    request
      .mockResolvedValueOnce(
        htmlResponse(
          html({
            readableProduct: {
              series: {
                id: "456",
                title: "  A work  ",
                thumbnailUri: "https://cdn-ak.shonenjumpplus.com/cover.jpg",
              },
            },
          })
        )
      )
      .mockResolvedValueOnce(
        Response.json({ per_page: 2, readable_products_count: 1 })
      )
      .mockResolvedValueOnce(
        Response.json([
          {
            readable_product_id: "123",
            title: "第1話",
            status: { label: "is_free" },
          },
        ])
      )
    const result = await resolveSeries({ ...input, signal, language: "en" })
    expect(result).toMatchObject({
      seriesId: "456",
      seriesMetadata: {
        title: "A work",
        coverUrl: "https://cdn-ak.shonenjumpplus.com/cover.jpg",
        language: "en",
        readingDirection: "rtl",
      },
      chapterList: {
        chapters: [{ id: "123", locked: false }],
        truncated: false,
      },
    })
    expect(request).toHaveBeenCalledTimes(3)
    for (const [requestInput] of request.mock.calls)
      expect(requestInput.init).toMatchObject({ credentials: "omit", signal })
  })

  it("retains metadata when the chapter API fails", async () => {
    request
      .mockResolvedValueOnce(htmlResponse(html()))
      .mockRejectedValueOnce(new Error("API unavailable"))
    await expect(resolveSeries(input)).resolves.toMatchObject({
      seriesId: "456",
      seriesMetadata: { title: "Shonen Jump+ 123", language: "ja" },
      chapterListError: "API unavailable",
    })
  })

  it("reports non-Error chapter failures with the metadata", async () => {
    request
      .mockResolvedValueOnce(htmlResponse(html()))
      .mockRejectedValueOnce("Unavailable")
    await expect(resolveSeries(input)).resolves.toMatchObject({
      chapterListError: "Unavailable",
    })
  })

  it("rejects an untrusted episode before requesting it", async () => {
    await expect(
      resolveSeries({
        ...input,
        seriesUrl: "https://attacker.example/episode/123",
      })
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it("releases rejected HTTP response bodies and preserves the status", async () => {
    const response = new Response("Denied", { status: 403 })
    const cancel = vi.spyOn(response.body!, "cancel")
    request.mockResolvedValueOnce(response)
    await expect(resolveSeries(input)).rejects.toMatchObject({ status: 403 })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("rejects a page without a series identity before requesting chapter data", async () => {
    request.mockResolvedValueOnce(htmlResponse("<h1>Unavailable</h1>"))
    await expect(resolveSeries(input)).rejects.toMatchObject({
      category: "provider_changed",
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
