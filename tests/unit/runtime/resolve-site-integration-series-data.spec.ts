import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getBackgroundSiteAdapterById: vi.fn(),
  resolveSeriesData: vi.fn(),
}))

vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  getBackgroundSiteAdapterById: mocks.getBackgroundSiteAdapterById,
}))

import { resolveSiteIntegrationSeriesData } from "@/src/runtime/resolve-site-integration-series-data"
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

describe("resolveSiteIntegrationSeriesData", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBackgroundSiteAdapterById.mockResolvedValue({
      background: { series: { resolveSeriesData: mocks.resolveSeriesData } },
    })
  })

  it("delegates the canonical resolver with the complete current input", async () => {
    const controller = new AbortController()
    const onPartial = vi.fn()
    const expected = { seriesId: "series-1", chapterList: { chapters: [] } }
    mocks.resolveSeriesData.mockResolvedValue(expected)

    await expect(
      resolveSiteIntegrationSeriesData({
        siteIntegrationId: "custom-site",
        seriesUrl: "https://example.test/series/1",
        seriesId: "series-1",
        language: "en",
        pageProbeData: { edition: "web" },
        signal: controller.signal,
        rateLimitService,
        siteIntegrationSettingsReader,
        onPartial,
      })
    ).resolves.toEqual(expected)

    expect(mocks.resolveSeriesData).toHaveBeenCalledWith({
      seriesUrl: "https://example.test/series/1",
      seriesId: "series-1",
      language: "en",
      pageProbeData: { edition: "web" },
      signal: controller.signal,
      rateLimitService,
      siteIntegrationSettingsReader,
      onPartial,
    })
  })

  it("rejects when no series URL or ID is supplied", async () => {
    await expect(
      resolveSiteIntegrationSeriesData({
        siteIntegrationId: "custom-site",
        rateLimitService,
        siteIntegrationSettingsReader,
      })
    ).rejects.toThrow("requires a seriesUrl or seriesId")
    expect(mocks.resolveSeriesData).not.toHaveBeenCalled()
  })

  it("rejects when the provider has no canonical resolver", async () => {
    mocks.getBackgroundSiteAdapterById.mockResolvedValue({ background: {} })
    await expect(
      resolveSiteIntegrationSeriesData({
        siteIntegrationId: "custom-site",
        seriesId: "series-1",
        rateLimitService,
        siteIntegrationSettingsReader,
      })
    ).rejects.toThrow("does not provide background series loaders")
  })
})
