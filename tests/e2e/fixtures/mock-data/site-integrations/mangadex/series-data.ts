/**
 * @file series-data.ts
 * @description MangaDex series/manga metadata mock data
 * 
 * Series URLs follow pattern: https://mangadex.test/title/[series-uuid]/[slug]
 */

import type { SiteIntegrationSeriesData, SiteIntegrationSeriesDataset } from '../../types';

// ============================================================================
// Series Datasets
// ============================================================================

/**
 * Basic series data for general testing
 */
export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: 'MANGADEX_BASIC_SERIES',
  description: 'Basic mangadex series with full metadata',
  series: {
    siteId: 'mangadex',
    seriesId: 'db692d58-4b13-4174-ae8c-30c515c0689c',
    seriesTitle: 'Hunter x Hunter',
    author: 'Togashi Yoshihiro',
    artist: 'Togashi Yoshihiro',
    status: 'Ongoing',
    description: 'Hunters are a special breed, dedicated to tracking down treasures, magical beasts, and even other men. But such pursuits require a license, and less than one in a hundred thousand can pass the grueling qualification exam. Those who do pass gain access to restricted areas, amazing stores of information, and the right to call themselves Hunters.',
    coverUrl: 'https://uploads.mangadex.org/covers/db692d58-4b13-4174-ae8c-30c515c0689c/e747cff7-41f4-4014-8d29-b8f105d71e20.jpg',
  },
  chapterDatasetId: 'MANGADEX_BASIC',
};

/**
 * Minimal series data (only required fields)
 */
export const MINIMAL_SERIES: SiteIntegrationSeriesDataset = {
  id: 'MANGADEX_MINIMAL_SERIES',
  description: 'Minimal series with only required fields',
  series: {
    siteId: 'mangadex',
    seriesId: '936f0ba5-ca65-4de4-99b1-528c02a4454d',
    seriesTitle: 'Hunter x Hunter (Official Colored)',
  },
  chapterDatasetId: 'MANGADEX_SMALL',
};

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a custom series with overrides
 */
export function createMangadexSeries(overrides: Partial<SiteIntegrationSeriesData>): SiteIntegrationSeriesData {
  return {
    siteId: overrides.siteId || 'mangadex',
    seriesId: overrides.seriesId || 'db692d58-4b13-4174-ae8c-30c515c0689c',
    seriesTitle: overrides.seriesTitle || 'Hunter x Hunter',
    author: overrides.author,
    artist: overrides.artist,
    status: overrides.status,
    description: overrides.description,
    coverUrl: overrides.coverUrl,
  };
}
