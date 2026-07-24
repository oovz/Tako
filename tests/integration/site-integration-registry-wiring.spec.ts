/**
 * Each site integration should have dedicated unit and integration coverage for
 * integration-specific features.
 *
 * The per-integration unit tests under tests/unit/site-integrations/ cover
 * integration-specific parsing logic (MangaDex language ISO, Pixiv build ID,
 * ManhuaGUI lz-string, etc.). This integration test covers the COMMON contract
 * that every enabled site integration must satisfy, exercised through the real
 * background adapter registry wiring (the same path the background-message-
 * router uses for FETCH_SERIES_DATA):
 *
 *   1. Registry wiring: every enabled integration resolves via
 *      getBackgroundSiteAdapterById and exposes a background adapter.
 *   2. Capability declaration: every enabled integration exposes a
 *      background.series resolver — either legacy
 *      {fetchChapterList,fetchSeriesMetadata} or the unified resolveSeriesData.
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

import { SITE_INTEGRATION_MANIFESTS } from "@/src/site-integrations/manifest"
import { getBackgroundSiteAdapterById } from "@/src/runtime/background-site-integration-initialization"

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

// Mock the content-script context validator so background adapters can be
// loaded in the node test environment without content-script guards firing.
vi.mock("@/src/types/site-integrations", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/src/types/site-integrations")>()
  return {
    ...original,
    IntegrationContextValidator: {
      validateContentScriptContext: vi.fn(),
      validateBackgroundOrOffscreenContext: vi.fn(),
    },
  }
})

const enabledManifests = SITE_INTEGRATION_MANIFESTS.filter((m) => m.shipped)

// Resolve the capability partition at module top level (Vitest supports ESM
// top-level await) so the it.each arrays below are populated at test-
// registration time. beforeAll runs too late for it.each array evaluation.
const resolvedAdapters = await Promise.all(
  enabledManifests.map(async (manifest) => {
    const adapter = await getBackgroundSiteAdapterById(manifest.id)
    const series = adapter?.background.series
    const hasLegacyFetch =
      typeof series?.fetchChapterList === "function" &&
      typeof series?.fetchSeriesMetadata === "function"
    const hasResolveSeriesData = typeof series?.resolveSeriesData === "function"
    return {
      id: manifest.id,
      hasSeries: hasLegacyFetch || hasResolveSeriesData,
      hasLegacyFetch,
      hasResolveSeriesData,
    }
  })
)
const apiBacked = resolvedAdapters.filter((r) => r.hasSeries).map((r) => r.id)
const legacyApiBacked = resolvedAdapters
  .filter((r) => r.hasLegacyFetch)
  .map((r) => r.id)
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
  // registry wiring used by the background-message-router (FETCH_SERIES_DATA).
  describe.each(enabledManifests.map((m) => [m.id, m]))(
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
  // (legacy fetchChapterList/fetchSeriesMetadata or new resolveSeriesData) and
  // surface network failures. DOM-only integrations intentionally omit
  // background.series (they extract from the page DOM or a one-shot probe).
  describe("API-backed integrations expose series loaders and surface network failures", () => {
    it("at least one integration is API-backed (mangadex, pixiv-comic)", () => {
      expect(apiBacked.length).toBeGreaterThan(0)
      expect(apiBacked).toContain("mangadex")
      expect(apiBacked).toContain("pixiv-comic")
      expect(apiBacked).toContain("shonenjumpplus")
    })

    it.each(legacyApiBacked.map((id) => [id]))(
      "%s exposes fetchChapterList and fetchSeriesMetadata",
      async (id) => {
        const adapter = await getBackgroundSiteAdapterById(id)
        expect(typeof adapter!.background.series!.fetchChapterList).toBe(
          "function"
        )
        expect(typeof adapter!.background.series!.fetchSeriesMetadata).toBe(
          "function"
        )
      }
    )

    it.each(resolveBacked.map((id) => [id]))(
      "%s exposes resolveSeriesData",
      async (id) => {
        const adapter = await getBackgroundSiteAdapterById(id)
        expect(typeof adapter!.background.series!.resolveSeriesData).toBe(
          "function"
        )
      }
    )

    it.each(legacyApiBacked.map((id) => [id]))(
      "%s fetchChapterList throws on network failure (no silent empty success)",
      async (id) => {
        const adapter = await getBackgroundSiteAdapterById(id)
        ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("network down")
        )

        // The contract: a network failure MUST surface as a thrown error (or a
        // structured error result), never a silent empty-success chapters
        // array. We assert it throws; integrations that return a structured
        // error result would also be acceptable but all current integrations
        // throw on fetch rejection.
        await expect(
          adapter!.background.series!.fetchChapterList!("series-1", "en")
        ).rejects.toBeDefined()
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
            : "https://comic.pixiv.net/works/12345"

        const outcome = await adapter!.background!.series!.resolveSeriesData!({
          seriesUrl,
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

    it.each(legacyApiBacked.map((id) => [id]))(
      "%s fetchSeriesMetadata throws on network failure (no silent empty success)",
      async (id) => {
        const adapter = await getBackgroundSiteAdapterById(id)
        ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("network down")
        )

        await expect(
          adapter!.background.series!.fetchSeriesMetadata!("series-1", "en")
        ).rejects.toBeDefined()
      }
    )

    it("no enabled integration is purely DOM-only without a background series resolver", () => {
      // DOM-based integrations (ManhuaGUI, Comic Nettai) now resolve through the
      // offscreen document after the background fetches the series page HTML,
      // so every enabled integration should expose background.series.
      expect(domOnly).toEqual([])
      for (const id of domOnly) {
        expect(apiBacked, `${id} must not also be API-backed`).not.toContain(id)
      }
    })
  })
})
