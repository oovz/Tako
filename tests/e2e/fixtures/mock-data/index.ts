/**
 * @file index.ts
 * @description Main export for all E2E mock data
 * 
 * Site-Specific Architecture:
 * - Site integration mock data organized by site (mangadex)
 * - Shared mock data for site-agnostic features (download tasks, settings)
 * 
 * Usage Examples:
 * ```typescript
 * // Import site-specific data
 * import { Mangadex } from './fixtures/mock-data';
 * 
 * // Use site-integration-specific chapters
 * const chapters = Mangadex.BASIC_CHAPTERS.chapters;
 * const series = Mangadex.BASIC_SERIES.series;
 * 
 * // Use shared data
 * import { PENDING_TASK, CBZ_SETTINGS } from './fixtures/mock-data';
 * ```
 */

// ============================================================================
// Site-Integration-Specific Mock Data (Site-Specific)
// ============================================================================

export * as Mangadex from './site-integrations/mangadex';

// ============================================================================
// Shared mock data utilities and types
// (Download tasks and settings removed - only used by skipped tests)

// ============================================================================
// Types
// ============================================================================

export type {
  SiteIntegrationChapterData,
  SiteIntegrationChapterDataset,
  SiteIntegrationSeriesData,
  SiteIntegrationSeriesDataset,
  HTMLFixtures,
  SiteIntegrationMockData,
  MockMangaPageStateOptions,
  MockSettingsPreset,
  DeepPartial,
  MockDataFactory,
} from './types';
