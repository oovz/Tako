/**
 * Each site integration should have dedicated unit and integration coverage for
 * integration-specific features.
 *
 * The per-integration unit tests under tests/unit/site-integrations/ cover
 * integration-specific parsing logic (MangaDex language ISO, Pixiv build ID,
 * ManhuaGUI lz-string, etc.). This integration test covers the COMMON contract
 * that every enabled site integration must satisfy, exercised through the real
 * background adapter registry wiring:
 *
 *   1. Registry wiring: every enabled integration resolves via
 *      getBackgroundSiteAdapterById and exposes a background adapter.
 *   2. Capability declaration: every enabled integration exposes a
 *      canonical background.series resolveSeriesData resolver.
 *      Integrations that extract from page DOM do so through the offscreen
 *      document after the background fetches the HTML.
 *   3. Error handling for network failures: background series resolvers surface
 *      fetch failures (throw or structured error fields) instead of silently
 *      returning empty success.
 *
 * This keeps integration-level coverage on the site adapter registry contract,
 * not only on generic background download flows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { siteIntegrationCatalog } from "@/src/runtime/generated/site-integration-catalog"
import { getBackgroundSiteAdapterById } from "@/src/runtime/background-site-integration-initialization"
import { initializeSiteIntegrationEnablement } from "@/src/runtime/site-integration-initialization"
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

// Adapter lookup now assumes the background runtime's integration phase has
// hydrated user enablement before evaluating default-disabled integrations.
// Mirror that phase boundary here so this registry contract test does not
// accidentally exercise an uninitialized singleton.
await initializeSiteIntegrationEnablement(async () => ({ mangadex: true }))

// Resolve the capability partition at module top level (Vitest supports ESM
// top-level await) so the it.each arrays below are populated at test-
// registration time. beforeAll runs too late for it.each array evaluation.
const resolvedAdapters = await Promise.all(
  enabledDefinitions.map(async (manifest) => {
    const adapter = await getBackgroundSiteAdapterById(manifest.id)
    const series = adapter?.background.series
    const hasResolveSeriesData = typeof series?.resolveSeriesData === "function"
    return {
      id: manifest.id,
      hasSeries: hasResolveSeriesData,
      hasResolveSeriesData,
    }
  })
)
const apiBacked = resolvedAdapters.filter((r) => r.hasSeries).map((r) => r.id)
const resolveBacked = resolvedAdapters
  .filter((r) => r.hasResolveSeriesData)
  .map((r) => r.id)
const domOnly = resolvedAdapters.filter((r) => !r.hasSeries).map((r) => r.id)

describe("site integration common contract (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  // Contract 1: every enabled integration must resolve through the background
  // registry wiring used by background series resolution.
  describe.each(enabledDefinitions.map((m) => [m.id, m]))(
    "%s registry wiring",
    (_id, manifest) => {
      it("resolves a background adapter via getBackgroundSiteAdapterById", async () => {
        const adapter = await getBackgroundSiteAdapterById(manifest.id)
        expect(
          adapter,
          `background adapter for ${manifest.id} must be registered`
        ).toBeDefined()
        expect(adapter!.id).toBe(manifest.id)
        expect(
          adapter!.background,
          `${manifest.id} must expose a background integration object`
        ).toBeDefined()
        expect(typeof adapter!.background.name).toBe("string")
      })
    }
  )

  // Contract 2 + 3: API-backed integrations expose background.series resolution
  // surface network failures.
  describe("API-backed integrations expose series loaders and surface network failures", () => {
    it("at least one integration is API-backed (mangadex, pixiv-comic)", () => {
      expect(apiBacked.length).toBeGreaterThan(0)
      expect(apiBacked).toContain("mangadex")
      expect(apiBacked).toContain("pixiv-comic")
      expect(apiBacked).toContain("shonenjumpplus")
    })

    it.each(resolveBacked.map((id) => [id]))(
      "%s exposes resolveSeriesData",
      async (id) => {
        const adapter = await getBackgroundSiteAdapterById(id)
        expect(typeof adapter!.background.series!.resolveSeriesData).toBe(
          "function"
        )
      }
    )

    it.each(resolveBacked.map((id) => [id]))(
      "%s resolveSeriesData surfaces network failure (no silent empty success)",
      async (id) => {
        const adapter = await getBackgroundSiteAdapterById(id)
        ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("network down")
        )

        const seriesUrl =
          id === "shonenjumpplus"
            ? "https://shonenjumpplus.com/episode/12345"
            : id === "pixiv-comic"
              ? "https://comic.pixiv.net/works/12345"
              : id === "mangadex"
                ? "https://mangadex.org/title/12345678-abcd-1234-abcd-123456789012"
                : id === "manhuagui"
                  ? "https://www.manhuagui.com/comic/28004"
                  : "https://comicnettai.com/book/12345"

        const outcome = await adapter!.background!.series!.resolveSeriesData!({
          seriesUrl,
          rateLimitService,
          siteIntegrationSettingsReader,
        }).then(
          (value) => ({ resolved: true as const, value }),
          (error) => ({ resolved: false as const, error })
        )

        if (outcome.resolved) {
          // The result may contain a structured error; ensure it is not a
          // silent empty-success result.
          expect(
            outcome.value.metadataError || outcome.value.chapterListError,
            "resolved result must surface a network error"
          ).toBeTruthy()
        } else {
          expect(outcome.error).toBeDefined()
        }
      }
    )

    it("no enabled integration is purely DOM-only without a background series resolver", () => {
      // Every shipped integration resolves series data through its background adapter.
      expect(domOnly).toEqual([])
      for (const id of domOnly) {
        expect(apiBacked, `${id} must not also be API-backed`).not.toContain(id)
      }
    })
  })
})
