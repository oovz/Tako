import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { siteIntegrationCatalog } from "@/src/runtime/generated/site-integration-catalog"
import { getBackgroundSiteAdapterById } from "@/src/runtime/background-site-integration-initialization"
import { initializeSiteIntegrationEnablement } from "@/src/runtime/site-integration-initialization"
import { resolveSiteIntegrationSeriesData } from "@/src/runtime/resolve-site-integration-series-data"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import type { SiteIntegrationSettingsReader } from "@/src/types/site-integrations"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("@/src/storage/site-integration-enablement-service", () => ({
  siteIntegrationEnablementService: {
    getAll: vi.fn(async () => ({ mangadex: true })),
  },
}))

vi.mock("@/src/storage/site-integration-settings-service", () => ({
  siteIntegrationSettingsService: {
    getAll: vi.fn(async () => ({})),
    getForSite: vi.fn(async () => ({})),
  },
}))

const enabledDefinitions = siteIntegrationCatalog.filter((m) => m.shipped)
const seriesUrls: Readonly<Record<string, string>> = {
  animemangahouse: "https://www.dm5.com/manhua-shanhainizhan1/",
  boylove: "https://boylove.cc/home/book/index/id/34260",
  comictropics: "https://www.comicnettai.com/book/9",
  coolmic: "https://coolmic.me/titles/5101",
  copymanga: "https://www.copy3000.com/comic/dianjuren",
  lovemanga: "https://www.aimanhua.org/comic/416895",
  mangaagain: "https://www.zaimanhua.com/info/doufo.html",
  mangabz: "https://www.mangabz.com/139bz/",
  mangadex: "https://mangadex.org/title/db692d58-4b13-4174-ae8c-30c515c0689c",
  mangago:
    "https://www.mangago.me/read-manga/kenshi_o_mezashite_ny_gaku_shitanoni_mah_tekisei_9999_nandesukedo/",
  mangahere: "https://newm.mangahere.cc/manga/hunter_x_hunter/",
  mangakakalot: "https://www.mangakakalove.com/manga/hunter-x-hunter",
  mangamillion: "https://mangamillion.shueisha.co.jp/en/title/1",
  manganato: "https://www.manganato.gg/manga/hunter-x-hunter",
  mangaplus: "https://mangaplus.shueisha.co.jp/titles/100467",
  mycomic: "https://mycomic.com/cn/comics/35937",
  "pixiv-comic": "https://comic.pixiv.net/works/12345",
  readmanga: "https://www.manhuagui.com/comic/28004/",
  shonenjumpplus: "https://shonenjumpplus.com/episode/3269754496649675702",
}
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

await initializeSiteIntegrationEnablement(async () => ({ mangadex: true }))

describe("site integration registry", () => {
  const contains = vi.fn(
    async (_permissions: chrome.permissions.Permissions) => true
  )
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("chrome", { permissions: { contains } })
    vi.stubGlobal("fetch", vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  describe.each(enabledDefinitions)("$id", (definition) => {
    it("registers a named series resolver", async () => {
      const adapter = await getBackgroundSiteAdapterById(definition.id)
      expect(adapter).toBeDefined()
      expect(typeof adapter!.background.name).toBe("string")
      expect(typeof adapter!.background.series?.resolveSeriesData).toBe(
        "function"
      )
    })

    it("checks the catalog host before fetching and reports HTTP failures", async () => {
      vi.mocked(global.fetch).mockImplementation(async (url) => {
        const response = new Response(null, {
          status: 503,
          statusText: "Service Unavailable",
        })
        Object.defineProperty(response, "url", { value: String(url) })
        return response
      })

      const seriesUrl = seriesUrls[definition.id]
      expect(
        seriesUrl,
        `${definition.id} needs a valid public series route`
      ).toBeDefined()

      const outcome = await resolveSiteIntegrationSeriesData({
        siteIntegrationId: definition.id,
        seriesUrl,
        rateLimitService,
        siteIntegrationSettingsReader,
      }).then(
        (value) => ({ resolved: true as const, value }),
        (error) => ({ resolved: false as const, error })
      )

      expect(
        global.fetch,
        `${definition.id} must reach the network boundary`
      ).toHaveBeenCalled()
      const requestedHosts = new Set(
        vi
          .mocked(global.fetch)
          .mock.calls.map(([url]) => `${new URL(String(url)).origin}/*`)
      )
      expect(contains).toHaveBeenCalledOnce()
      expect(contains).toHaveBeenCalledBefore(vi.mocked(global.fetch))
      const [catalogHost] = contains.mock.calls[0][0].origins ?? []
      expect(requestedHosts).toEqual(new Set([catalogHost]))
      expect(definition.requiredOrigins).toContain(catalogHost)
      if (outcome.resolved) {
        const errors = [
          outcome.value.metadataError,
          outcome.value.chapterListError,
        ].filter(Boolean)
        expect(
          errors,
          "resolved result must report the HTTP failure"
        ).not.toEqual([])
        for (const error of errors) expect(error).toContain("HTTP 503")
      } else {
        expect(outcome.error).toBeInstanceOf(Error)
        expect(outcome.error.message).toContain("HTTP 503")
      }
    })
  })
})
