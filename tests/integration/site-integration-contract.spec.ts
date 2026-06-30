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
 *   2. Capability declaration: API-backed integrations expose
 *      background.series.{fetchChapterList,fetchSeriesMetadata}; DOM-only
 *      integrations (Shonen Jump+, ManhuaGUI, Comic Nettai) intentionally
 *      omit background.series because they extract from the page DOM in the
 *      content script (covered by E2E).
 *   3. Error handling for network failures: API-backed integrations surface
 *      fetch failures (throw) instead of silently returning empty success.
 *
 * This keeps integration-level coverage on the site adapter registry contract,
 * not only on generic background download flows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SITE_INTEGRATION_MANIFESTS } from '@/src/site-integrations/manifest'
import { getBackgroundSiteAdapterById } from '@/src/runtime/background-site-integration-initialization'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('@/src/storage/site-integration-enablement-service', () => ({
  siteIntegrationEnablementService: {
    getAll: vi.fn(async () => ({})),
  },
}))

vi.mock('@/src/storage/site-integration-settings-service', () => ({
  siteIntegrationSettingsService: {
    getAll: vi.fn(async () => ({})),
    getForSite: vi.fn(async () => ({})),
  },
}))

// Mock the content-script context validator so background adapters can be
// loaded in the node test environment without content-script guards firing.
vi.mock('@/src/types/site-integrations', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/src/types/site-integrations')>()
  return {
    ...original,
    IntegrationContextValidator: {
      validateContentScriptContext: vi.fn(),
      validateBackgroundOrOffscreenContext: vi.fn(),
    },
  }
})

const enabledManifests = SITE_INTEGRATION_MANIFESTS.filter((m) => m.enabled !== false)

// Resolve the capability partition at module top level (Vitest supports ESM
// top-level await) so the it.each arrays below are populated at test-
// registration time. beforeAll runs too late for it.each array evaluation.
const resolvedAdapters = await Promise.all(
  enabledManifests.map(async (manifest) => {
    const adapter = await getBackgroundSiteAdapterById(manifest.id)
    return { id: manifest.id, hasSeries: !!adapter?.background.series }
  }),
)
const apiBacked = resolvedAdapters.filter((r) => r.hasSeries).map((r) => r.id)
const domOnly = resolvedAdapters.filter((r) => !r.hasSeries).map((r) => r.id)

describe('site integration common contract (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  // Contract 1: every enabled integration must resolve through the background
  // registry wiring used by the background-message-router (FETCH_SERIES_DATA).
  describe.each(enabledManifests.map((m) => [m.id, m]))('%s registry wiring', (_id, manifest) => {
    it('resolves a background adapter via getBackgroundSiteAdapterById', async () => {
      const adapter = await getBackgroundSiteAdapterById(manifest.id)
      expect(adapter, `background adapter for ${manifest.id} must be registered`).toBeDefined()
      expect(adapter!.id).toBe(manifest.id)
      expect(adapter!.background, `${manifest.id} must expose a background integration object`).toBeDefined()
      expect(typeof adapter!.background.name).toBe('string')
    })
  })

  // Contract 2 + 3: API-backed integrations expose background.series loaders
  // and surface network failures. DOM-only integrations intentionally omit
  // background.series (they extract from the page DOM in the content script).
  describe('API-backed integrations expose series loaders and surface network failures', () => {
    it('at least one integration is API-backed (mangadex, pixiv-comic)', () => {
      expect(apiBacked.length).toBeGreaterThan(0)
      expect(apiBacked).toContain('mangadex')
      expect(apiBacked).toContain('pixiv-comic')
    })

    it.each(apiBacked.map((id) => [id]))(
      '%s exposes fetchChapterList and fetchSeriesMetadata',
      async (id) => {
        const adapter = await getBackgroundSiteAdapterById(id)
        expect(typeof adapter!.background.series!.fetchChapterList).toBe('function')
        expect(typeof adapter!.background.series!.fetchSeriesMetadata).toBe('function')
      },
    )

    it.each(apiBacked.map((id) => [id]))(
      '%s fetchChapterList throws on network failure (no silent empty success)',
      async (id) => {
        const adapter = await getBackgroundSiteAdapterById(id)
        ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))

        // The contract: a network failure MUST surface as a thrown error (or a
        // structured error result), never a silent empty-success chapters
        // array. We assert it throws; integrations that return a structured
        // error result would also be acceptable but all current integrations
        // throw on fetch rejection.
        await expect(
          adapter!.background.series!.fetchChapterList('series-1', 'en'),
        ).rejects.toBeDefined()
      },
    )

    it.each(apiBacked.map((id) => [id]))(
      '%s fetchSeriesMetadata throws on network failure (no silent empty success)',
      async (id) => {
        const adapter = await getBackgroundSiteAdapterById(id)
        ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))

        await expect(
          adapter!.background.series!.fetchSeriesMetadata('series-1', 'en'),
        ).rejects.toBeDefined()
      },
    )

    it('DOM-only integrations intentionally omit background.series (content-script extraction)', () => {
      // Shonen Jump+, ManhuaGUI, and Comic Nettai extract series/chapter data
      // from the page DOM in the content script; they must NOT claim a
      // background series loader. Their DOM extraction is covered by E2E.
      expect(domOnly).toEqual(expect.arrayContaining(['shonenjumpplus', 'manhuagui', 'comicnettai']))
      for (const id of domOnly) {
        expect(apiBacked, `${id} must not also be API-backed`).not.toContain(id)
      }
    })
  })
})
