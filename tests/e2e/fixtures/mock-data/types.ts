import type { BrowserContext } from "@playwright/test"
import type { ChapterState } from "@/src/types/tab-state"

/**
 * Mock chapter data for a specific site integration
 * Uses ChapterState directly with realistic URLs and site-specific metadata
 */
export type SiteIntegrationChapterData = ChapterState

/**
 * Dataset of chapters for a specific site integration
 */
export interface SiteIntegrationChapterDataset {
  /** Dataset identifier */
  id: string
  /** Human-readable description */
  description: string
  /** Array of chapter states with realistic URLs for this site integration */
  chapters: SiteIntegrationChapterData[]
}

/**
 * Mock series/manga data for a specific site integration
 */
export interface SiteIntegrationSeriesData {
  /** Site integration ID (e.g., 'mangadex') */
  siteId: string
  /** Series ID as extracted by the site integration content extractor */
  seriesId: string
  /** Series title */
  seriesTitle: string
  /** Optional series metadata */
  author?: string
  artist?: string
  status?: string
  description?: string
  /** Cover image URL (if applicable) */
  coverUrl?: string
}

/**
 * Dataset of series for a specific site integration
 */
export interface SiteIntegrationSeriesDataset {
  /** Dataset identifier */
  id: string
  /** Human-readable description */
  description: string
  /** Series metadata */
  series: SiteIntegrationSeriesData
  /** Associated chapter dataset ID (references SiteIntegrationChapterDataset) */
  chapterDatasetId: string
}

/**
 * HTML fixtures for route mocking (Playwright page.route)
 * Each site integration provides HTML strings matching its actual scraped structure
 */
export interface HTMLFixtures {
  /** Series page HTML (for testing content script extraction) */
  seriesPageHtml: string
  /** Optional chapter page HTML (for testing chapter scraping) */
  chapterPageHtml?: string
}

/**
 * Options passed to every site-integration route registrar.
 *
 * - `useMocks`: when `true`, the registrar MUST install deterministic routes
 *   for every host it owns and MUST NOT let requests escape to the real
 *   network. When `false`, the registrar is a no-op.
 * - `allowNetwork`: informational — indicates the top-level policy permits
 *   live network calls for unmatched hosts. Registrars should not pass
 *   requests through based on this flag; they should only mock or skip.
 *
 * Additional per-test overrides (response bodies, image bytes) belong on
 * extended option shapes defined by each integration. Keep this type narrow
 * so the top-level dispatcher can pass a single object to every registrar
 * without coupling to integration-specific fields.
 */
export interface RouteRegistrarOptions {
  useMocks: boolean
  allowNetwork: boolean
}

/**
 * Every site integration MUST export a function matching this signature from
 * `tests/e2e/fixtures/mock-data/site-integrations/{id}/routes.ts`. The
 * top-level dispatcher at `tests/e2e/fixtures/routes.ts` invokes every
 * registered registrar in parallel for each test `BrowserContext`.
 *
 * Registrars must:
 * - Be idempotent: the dispatcher may be called once per test.
 * - Register routes only when `options.useMocks === true`.
 * - Scope their `context.route(pattern, handler)` calls to hosts the
 *   integration actually talks to; never match `**` or cross-host globs.
 * - Never await real network I/O.
 */
export type RouteRegistrar = (
  context: BrowserContext,
  options: RouteRegistrarOptions
) => Promise<void>
