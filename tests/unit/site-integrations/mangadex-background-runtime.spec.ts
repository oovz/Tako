import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  fetchMangadexSeriesMetadata: vi.fn(),
  fetchMangadexChapterList: vi.fn(),
  getForSite: vi.fn(),
}))

vi.mock("@/src/site-integrations/mangadex/series-api", () => ({
  fetchMangadexSeriesMetadata: mocks.fetchMangadexSeriesMetadata,
  fetchMangadexChapterList: mocks.fetchMangadexChapterList,
}))
vi.mock("@/src/storage/site-integration-settings-service", () => ({
  siteIntegrationSettingsService: { getForSite: mocks.getForSite },
}))

import { backgroundSiteAdapter } from "@/src/site-integrations/mangadex/background-runtime"
import type { RateLimitService } from "@/src/runtime/rate-limit"

function resolveMangadexSeriesData() {
  const resolver = backgroundSiteAdapter.background.series?.resolveSeriesData
  if (!resolver) {
    throw new Error("Expected MangaDex to expose a series resolver")
  }
  return resolver
}

const rateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_id: string, _scope: string, task: () => Promise<T>) => task()
  ),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService
const siteIntegrationSettingsReader = {
  getAll: vi.fn(async () => ({})),
  getForSite: mocks.getForSite,
}

describe("MangaDex background series resolution", () => {
  const getSession = vi.fn()
  const setSession = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getForSite.mockResolvedValue({ autoReadMangaDexSettings: true })
    getSession.mockResolvedValue({})
    setSession.mockResolvedValue(undefined)
    vi.stubGlobal("chrome", {
      storage: { session: { get: getSession, set: setSession } },
    })
  })

  it("keeps optional probe policy provider-owned and nonfatal", async () => {
    const shouldExecutePageProbe =
      backgroundSiteAdapter.background.shouldExecutePageProbe
    if (!shouldExecutePageProbe) throw new Error("Missing probe policy")

    mocks.getForSite.mockResolvedValueOnce({ autoReadMangaDexSettings: false })
    await expect(
      shouldExecutePageProbe({ siteIntegrationSettingsReader })
    ).resolves.toBe(false)

    mocks.getForSite.mockRejectedValueOnce(new Error("settings unavailable"))
    await expect(
      shouldExecutePageProbe({ siteIntegrationSettingsReader })
    ).resolves.toBe(false)
  })

  it("persists parsed page-probe preferences only after a successful series ID", async () => {
    const persistPageProbeData =
      backgroundSiteAdapter.background.persistPageProbeData
    if (!persistPageProbeData) throw new Error("Missing probe persistence")

    await persistPageProbeData({
      seriesId: "db692d58-4b13-4174-942a-837e532011a6",
      pageProbeData: { dataSaver: false, filteredLanguages: ["en"] },
    })

    expect(setSession).toHaveBeenCalledWith({
      mangadexUserPreferencesBySeries: {
        "mangadex#db692d58-4b13-4174-942a-837e532011a6": {
          dataSaver: false,
          filteredLanguages: ["en"],
        },
      },
    })
  })

  it("starts metadata and chapter requests together and emits metadata while chapters are pending", async () => {
    let resolveMetadata:
      ((value: { title: string; authors: string[] }) => void) | undefined
    let resolveChapters:
      ((value: { chapters: never[]; volumes: never[] }) => void) | undefined
    mocks.fetchMangadexSeriesMetadata.mockReturnValue(
      new Promise((resolve) => {
        resolveMetadata = resolve
      })
    )
    mocks.fetchMangadexChapterList.mockReturnValue(
      new Promise((resolve) => {
        resolveChapters = resolve
      })
    )
    const onPartial = vi.fn(async () => undefined)

    const resolution = resolveMangadexSeriesData()({
      seriesUrl:
        "https://mangadex.org/title/db692d58-4b13-4174-942a-837e532011a6",
      language: "en",
      onPartial,
      rateLimitService,
      siteIntegrationSettingsReader,
    })

    await vi.waitFor(() => {
      expect(mocks.fetchMangadexSeriesMetadata).toHaveBeenCalledOnce()
      expect(mocks.fetchMangadexChapterList).toHaveBeenCalledOnce()
    })
    expect(mocks.fetchMangadexChapterList).toHaveBeenCalledWith(
      "db692d58-4b13-4174-942a-837e532011a6",
      rateLimitService,
      "en",
      undefined,
      "interactive",
      undefined,
      siteIntegrationSettingsReader
    )

    resolveMetadata?.({ title: "MangaDex Series", authors: [] })
    await vi.waitFor(() => expect(onPartial).toHaveBeenCalledOnce())
    resolveChapters?.({ chapters: [], volumes: [] })

    await expect(resolution).resolves.toMatchObject({
      seriesId: "db692d58-4b13-4174-942a-837e532011a6",
      seriesMetadata: { title: "MangaDex Series", authors: [] },
      chapterList: { chapters: [], volumes: [] },
    })
  })

  it("keeps chapter and metadata failures independent", async () => {
    mocks.fetchMangadexSeriesMetadata.mockRejectedValue(
      new Error("metadata failed")
    )
    mocks.fetchMangadexChapterList.mockResolvedValue({
      chapters: [],
      volumes: [],
    })

    await expect(
      resolveMangadexSeriesData()({
        seriesUrl:
          "https://mangadex.org/title/db692d58-4b13-4174-942a-837e532011a6",
        rateLimitService,
        siteIntegrationSettingsReader,
      })
    ).resolves.toMatchObject({
      chapterList: { chapters: [], volumes: [] },
      metadataError: "metadata failed",
    })

    mocks.fetchMangadexSeriesMetadata.mockResolvedValue({
      title: "MangaDex Series",
      authors: [],
    })
    mocks.fetchMangadexChapterList.mockRejectedValue(
      new Error("chapters failed")
    )

    await expect(
      resolveMangadexSeriesData()({
        seriesUrl:
          "https://mangadex.org/title/db692d58-4b13-4174-942a-837e532011a6",
        rateLimitService,
        siteIntegrationSettingsReader,
      })
    ).resolves.toMatchObject({
      seriesMetadata: { title: "MangaDex Series", authors: [] },
      chapterListError: "chapters failed",
    })
  })
})
