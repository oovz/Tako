/**
 * @file series-data.ts
 * @description Pixiv Comic series/work metadata mock data.
 *
 * Series URLs follow the pattern: https://comic.pixiv.net/works/{workId}
 */

import type { SiteIntegrationSeriesData, SiteIntegrationSeriesDataset } from '../../types';

export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: 'PIXIV_COMIC_BASIC_SERIES',
  description: 'Basic Pixiv Comic work with full metadata',
  series: {
    siteId: 'pixiv-comic',
    seriesId: '9999001',
    seriesTitle: 'テスト作品',
    author: 'テスト作者',
    description: 'A Pixiv Comic fixture work used by e2e tests.',
    coverUrl: 'https://img-comic.test/works/9999001/cover_main_big.jpg',
  },
  chapterDatasetId: 'PIXIV_COMIC_BASIC',
};

export const MINIMAL_SERIES: SiteIntegrationSeriesDataset = {
  id: 'PIXIV_COMIC_MINIMAL_SERIES',
  description: 'Pixiv Comic work with only required fields',
  series: {
    siteId: 'pixiv-comic',
    seriesId: '9999002',
    seriesTitle: 'Minimal Work',
  },
  chapterDatasetId: 'PIXIV_COMIC_SMALL',
};

export function createPixivComicSeries(
  overrides: Partial<SiteIntegrationSeriesData>,
): SiteIntegrationSeriesData {
  return {
    siteId: overrides.siteId || 'pixiv-comic',
    seriesId: overrides.seriesId || '9999001',
    seriesTitle: overrides.seriesTitle || 'テスト作品',
    author: overrides.author,
    description: overrides.description,
    coverUrl: overrides.coverUrl,
  };
}
