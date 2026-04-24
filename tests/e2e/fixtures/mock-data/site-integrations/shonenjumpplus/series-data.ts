/**
 * @file series-data.ts
 * @description Shonen Jump+ series metadata mock data.
 *
 * Shonen Jump+ series are identified by an **episode id** that appears in
 * the series URL (e.g. `/episode/3269754496649675685`). The content script
 * derives series title from the embedded `<script id="episode-json">` or
 * `.series-header-title` element.
 */

import type { SiteIntegrationSeriesData, SiteIntegrationSeriesDataset } from '../../types';

export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: 'SHONENJUMPPLUS_BASIC_SERIES',
  description: 'Basic Shonen Jump+ series with full metadata',
  series: {
    siteId: 'shonenjumpplus',
    seriesId: '3269754496649675685',
    seriesTitle: 'テスト連載',
    author: 'テスト作者',
    description: 'A Shonen Jump+ fixture series used by e2e tests.',
    coverUrl: 'https://cdn-ak-img.shonenjumpplus.test/covers/3269754496649675685/thumb.jpg',
  },
  chapterDatasetId: 'SHONENJUMPPLUS_BASIC',
};

export const MINIMAL_SERIES: SiteIntegrationSeriesDataset = {
  id: 'SHONENJUMPPLUS_MINIMAL_SERIES',
  description: 'Shonen Jump+ series with a single chapter',
  series: {
    siteId: 'shonenjumpplus',
    seriesId: '3269754496649675702',
    seriesTitle: 'Minimal Series',
  },
  chapterDatasetId: 'SHONENJUMPPLUS_SMALL',
};

/**
 * Aggregate IDs are a separate identifier embedded in the DOM via
 * `.js-readable-products-pagination[data-aggregate-id]`. The chapter-list
 * API endpoints are scoped by aggregate id, not episode id.
 */
export const SERIES_AGGREGATE_IDS: Record<string, string> = {
  [BASIC_SERIES.series.seriesId]: '4401',
  [MINIMAL_SERIES.series.seriesId]: '4402',
};

export function createShonenJumpPlusSeries(
  overrides: Partial<SiteIntegrationSeriesData>,
): SiteIntegrationSeriesData {
  return {
    siteId: overrides.siteId || 'shonenjumpplus',
    seriesId: overrides.seriesId || BASIC_SERIES.series.seriesId,
    seriesTitle: overrides.seriesTitle || 'テスト連載',
    author: overrides.author,
    description: overrides.description,
    coverUrl: overrides.coverUrl,
  };
}
