import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { backgroundSiteAdapter as love } from "@/src/site-integrations/lovemanga/background-runtime"
import { backgroundSiteAdapter as here } from "@/src/site-integrations/mangahere/background-runtime"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { RateLimitService } from "@/src/runtime/rate-limit"

const parseSeries = vi.hoisted(() => vi.fn())
vi.mock("@/src/runtime/resolve-series-data-offscreen", () => ({
  resolveSeriesDataViaOffscreen: parseSeries,
}))

const rateLimitService = new RateLimitService({
  resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
})
const settingsReader = {
  getAll: async () => ({}),
  getForSite: async () => ({}),
}
const providers = [
  {
    integrationId: "lovemanga",
    endpointId: "lovemanga-page",
    label: "Aimanhua",
    resolver: love.background.series!.resolveSeriesData,
    seriesUrl: "https://www.aimanhua.org:443/series/../comic/1",
    canonicalUrl: "https://www.aimanhua.org/comic/1",
  },
  {
    integrationId: "mangahere",
    endpointId: "mangahere-page",
    label: "MangaHere",
    resolver: here.background.series!.resolveSeriesData,
    seriesUrl: "https://newm.mangahere.cc:443/manga/../manga/work/",
    canonicalUrl: "https://newm.mangahere.cc/manga/work/",
  },
]

beforeEach(() => parseSeries.mockReset())
afterEach(() => {
  vi.restoreAllMocks()
  rateLimitService.cleanupRateLimiters()
})

describe.each(providers)("$label series HTML resolution", (provider) => {
  function resolve(seriesUrl = provider.seriesUrl) {
    const signal = new AbortController().signal
    const input = {
      seriesUrl,
      language: "ja",
      signal,
      rateLimitService,
      siteIntegrationSettingsReader: settingsReader,
    }
    return { input, result: provider.resolver(input) }
  }

  it("decodes the normalized page and forwards its caller context to offscreen", async () => {
    const html = "<title>作品</title>"
    const request = vi
      .spyOn(integrationHttpClient, "request")
      .mockResolvedValueOnce(
        new Response(new TextEncoder().encode(html), {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      )
    const parsed = { seriesId: "1", chapterList: [] }
    parseSeries.mockResolvedValueOnce(parsed)
    const { input, result } = resolve()
    expect(await result).toBe(parsed)
    expect(request).toHaveBeenCalledWith({
      integrationId: provider.integrationId,
      endpointId: provider.endpointId,
      url: provider.canonicalUrl,
      scope: "chapter",
      rateLimitService,
      init: { signal: input.signal },
    })
    expect(parseSeries).toHaveBeenCalledWith({
      siteIntegrationId: provider.integrationId,
      seriesUrl: provider.canonicalUrl,
      html,
      language: input.language,
      signal: input.signal,
      rateLimitService,
    })
  })

  it("cancels an unsuccessful page body before reporting its HTTP status", async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), {
      status: 503,
    })
    vi.spyOn(integrationHttpClient, "request").mockResolvedValueOnce(response)
    await expect(resolve().result).rejects.toMatchObject({
      status: 503,
      message: `${provider.label} series request failed (HTTP 503)`,
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(parseSeries).not.toHaveBeenCalled()
  })

  it("rejects an untrusted page before requesting it", async () => {
    const request = vi.spyOn(integrationHttpClient, "request")
    await expect(
      resolve("https://attacker.example/work").result
    ).rejects.toThrow(/origin/)
    expect(request).not.toHaveBeenCalled()
    expect(parseSeries).not.toHaveBeenCalled()
  })
})
