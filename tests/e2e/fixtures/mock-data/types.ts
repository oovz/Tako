/**
 * @file types.ts
 * @description Type definitions for site-specific mock data architecture
 * 
 * This file defines types for organizing mock data by site integration (site-specific)
 * and shared generic data (download tasks, settings).
 */

import type { BrowserContext } from '@playwright/test';
import type { ChapterState } from '@/src/types/tab-state';
import type { ExtensionSettings } from '@/src/storage/settings-types';

// ============================================================================
// Site-Specific Integration Mock Data Types
// ============================================================================

/**
 * Mock chapter data for a specific site integration
 * Uses ChapterState directly with realistic URLs and site-specific metadata
 */
export type SiteIntegrationChapterData = ChapterState;

/**
 * Dataset of chapters for a specific site integration
 */
export interface SiteIntegrationChapterDataset {
  /** Dataset identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Array of chapter states with realistic URLs for this site integration */
  chapters: SiteIntegrationChapterData[];
}

/**
 * Mock series/manga data for a specific site integration
 */
export interface SiteIntegrationSeriesData {
  /** Site integration ID (e.g., 'mangadex') */
  siteId: string;
  /** Series ID as extracted by the site integration content extractor */
  seriesId: string;
  /** Series title */
  seriesTitle: string;
  /** Optional series metadata */
  author?: string;
  artist?: string;
  status?: string;
  description?: string;
  /** Cover image URL (if applicable) */
  coverUrl?: string;
}

/**
 * Dataset of series for a specific site integration
 */
export interface SiteIntegrationSeriesDataset {
  /** Dataset identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Series metadata */
  series: SiteIntegrationSeriesData;
  /** Associated chapter dataset ID (references SiteIntegrationChapterDataset) */
  chapterDatasetId: string;
}

/**
 * HTML fixtures for route mocking (Playwright page.route)
 * Each site integration provides HTML strings matching its actual scraped structure
 */
export interface HTMLFixtures {
  /** Series page HTML (for testing content script extraction) */
  seriesPageHtml: string;
  /** Optional chapter page HTML (for testing chapter scraping) */
  chapterPageHtml?: string;
}

/**
 * Complete mock data package for a site integration
 */
export interface SiteIntegrationMockData {
  /** Site integration ID */
  integrationId: string;
  /** Chapter datasets */
  chapters: Record<string, SiteIntegrationChapterDataset>;
  /** Series datasets */
  series: Record<string, SiteIntegrationSeriesDataset>;
  /** HTML fixtures for route mocking */
  html: HTMLFixtures;
}

// ============================================================================
// Shared Generic Mock Data Types
// ============================================================================

/**
 * Factory options for creating mock MangaPageState
 */
export interface MockMangaPageStateOptions {
  siteId: string;
  seriesId: string;
  seriesTitle: string;
  chapters: ChapterState[];
  author?: string;
  artist?: string;
  status?: string;
  description?: string;
  coverUrl?: string;
}

/**
 * Preset settings configurations
 */
export interface MockSettingsPreset {
  id: string;
  description: string;
  settings: ExtensionSettings;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Utility type for partial overrides
 */
export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

/**
 * Factory function type for creating mock data with overrides
 */
export type MockDataFactory<T> = (overrides?: DeepPartial<T>) => T;

// ============================================================================
// Route Registrar Contract (Per-Integration E2E Mocks)
// ============================================================================

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
  useMocks: boolean;
  allowNetwork: boolean;
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
  options: RouteRegistrarOptions,
) => Promise<void>;
