import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  decodeHtmlResponse: vi.fn(),
  resolveSeriesDataViaOffscreen: vi.fn(),
}))

vi.mock("@/src/site-integrations/http-client", () => ({
  integrationHttpClient: {
    request: mocks.fetch,
  },
}))
vi.mock("@/src/shared/html-response-decoder", () => ({
  decodeHtmlResponse: mocks.decodeHtmlResponse,
}))
vi.mock("@/src/runtime/resolve-series-data-offscreen", () => ({
  resolveSeriesDataViaOffscreen: mocks.resolveSeriesDataViaOffscreen,
}))

import { backgroundSiteAdapter } from "@/src/site-integrations/readmanga/background-runtime"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import type { SiteIntegrationSettingsReader } from "@/src/types/site-integrations"

const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_integrationId: string, _scope: string, task: () => Promise<T>) =>
      task()
  ),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService
const siteIntegrationSettingsReader: SiteIntegrationSettingsReader = {
  getAll: vi.fn(async () => ({})),
  getForSite: vi.fn(async () => ({})),
}

describe("Manhuagui live page context", () => {
  const seriesUrl = "https://www.manhuagui.com/comic/21243/"

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 })
    mocks.decodeHtmlResponse.mockResolvedValue({
      html: "<html>server page</html>",
    })
  })

  it("replaces only the fetched chapter list with live, consented chapter DOM", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { s1: 156, s2: 2, s3: 2, s4: 20, s5: 221 },
        }),
        { headers: { "content-type": "text/html; charset=utf-8" } }
      )
    )
    mocks.resolveSeriesDataViaOffscreen
      .mockResolvedValueOnce({
        seriesMetadata: { title: "Adult series", contentRating: "adult" },
        chapterList: { chapters: [], volumes: [] },
      })
      .mockResolvedValueOnce({
        chapterList: {
          chapters: [
            {
              id: "900001",
              title: "Chapter 1",
              url: "https://www.manhuagui.com/comic/21243/900001.html",
            },
          ],
          volumes: [],
        },
      })

    const resolveSeriesData =
      backgroundSiteAdapter.background.series?.resolveSeriesData
    if (!resolveSeriesData) throw new Error("Manhuagui resolver is missing")

    await expect(
      resolveSeriesData({
        seriesUrl,
        pageProbeData: {
          adultGatePresent: false,
          chapterHtml:
            '<div class="chapter"><div class="chapter-list"><a href="/comic/21243/900001.html">Chapter 1</a></div></div>',
        },
        rateLimitService,
        siteIntegrationSettingsReader,
      })
    ).resolves.toMatchObject({
      seriesId: "21243",
      seriesMetadata: {
        title: "Adult series",
        contentRating: "adult",
        communityRating: 3.37,
      },
      chapterList: { chapters: [expect.objectContaining({ id: "900001" })] },
    })

    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        endpointId: "readmanga-community-rating",
        url: "https://www.manhuagui.com/tools/vote.ashx?act=get&bid=21243",
      })
    )
    expect(mocks.resolveSeriesDataViaOffscreen).toHaveBeenNthCalledWith(1, {
      siteIntegrationId: "readmanga",
      seriesUrl,
      html: "<html>server page</html>",
      language: undefined,
      rateLimitService,
      signal: undefined,
    })
    expect(mocks.resolveSeriesDataViaOffscreen).toHaveBeenNthCalledWith(2, {
      siteIntegrationId: "readmanga",
      seriesUrl,
      html: '<div class="chapter"><div class="chapter-list"><a href="/comic/21243/900001.html">Chapter 1</a></div></div>',
      language: undefined,
      rateLimitService,
      signal: undefined,
    })
  })

  it("keeps gated metadata when optional vote counts are invalid", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    mocks.fetch.mockResolvedValueOnce(
      Response.json({
        success: true,
        data: { s1: 0, s2: 0, s3: 0, s4: 0, s5: -1 },
      })
    )
    mocks.resolveSeriesDataViaOffscreen.mockResolvedValueOnce({
      seriesMetadata: { title: "Adult series" },
      chapterList: { chapters: [], volumes: [] },
    })

    const resolveSeriesData =
      backgroundSiteAdapter.background.series?.resolveSeriesData
    if (!resolveSeriesData) throw new Error("Manhuagui resolver is missing")

    await expect(
      resolveSeriesData({
        seriesUrl,
        pageProbeData: {
          adultGatePresent: true,
          chapterHtml:
            '<div id="checkAdult"></div><div class="chapter-list"><a href="/comic/21243/900001.html">Hidden chapter</a></div>',
        },
        rateLimitService,
        siteIntegrationSettingsReader,
      })
    ).resolves.toMatchObject({
      seriesMetadata: { title: "Adult series", communityRating: undefined },
      chapterList: { chapters: [] },
      chapterListNotice: "adult-consent-required",
    })

    expect(mocks.resolveSeriesDataViaOffscreen).toHaveBeenCalledTimes(1)
  })
})
