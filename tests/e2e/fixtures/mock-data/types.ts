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
 * Mocked routes must not reach the network. allowNetwork describes the
 * top-level policy; it does not permit a registrar to bypass its mocks.
 */
export interface RouteRegistrarOptions {
  useMocks: boolean
  allowNetwork: boolean
}

/**
 * Register idempotent, host-scoped routes only when useMocks is true.
 * Registrars must not use catch-all routes or make real network requests.
 */
export type RouteRegistrar = (
  context: BrowserContext,
  options: RouteRegistrarOptions
) => Promise<void>
