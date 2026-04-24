/**
 * @file series-data.ts
 * @description Manhuagui series metadata mock data.
 *
 * Series URLs follow: https://www.manhuagui.com/comic/{seriesId}/
 * Chapter URLs follow: https://www.manhuagui.com/comic/{seriesId}/{chapterId}.html
 */

import type { SiteIntegrationSeriesData, SiteIntegrationSeriesDataset } from '../../types';

export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: 'MANHUAGUI_BASIC_SERIES',
  description: 'Basic Manhuagui series with full metadata (no adult gate)',
  series: {
    siteId: 'manhuagui',
    seriesId: '55555',
    seriesTitle: 'テスト漫画',
    author: '测试作者',
    description: 'A Manhuagui fixture series used by e2e tests.',
    coverUrl: 'https://cf.mhgui.test/cpic/b/55555.jpg',
    status: '连载中',
  },
  chapterDatasetId: 'MANHUAGUI_BASIC',
};

export const ADULT_SERIES: SiteIntegrationSeriesDataset = {
  id: 'MANHUAGUI_ADULT_SERIES',
  description: 'Adult-gated Manhuagui series (chapter list is lz-string-compressed in #__VIEWSTATE)',
  series: {
    siteId: 'manhuagui',
    seriesId: '77777',
    seriesTitle: 'Gated Series',
    author: '测试作者',
    description: 'Adult-gated Manhuagui fixture.',
    coverUrl: 'https://cf.mhgui.test/cpic/b/77777.jpg',
    status: '已完结',
  },
  chapterDatasetId: 'MANHUAGUI_ADULT',
};

export const MINIMAL_SERIES: SiteIntegrationSeriesDataset = {
  id: 'MANHUAGUI_MINIMAL_SERIES',
  description: 'Manhuagui series with a single chapter',
  series: {
    siteId: 'manhuagui',
    seriesId: '66666',
    seriesTitle: 'Minimal Series',
    status: '连载中',
  },
  chapterDatasetId: 'MANHUAGUI_SMALL',
};

export function createManhuaguiSeries(
  overrides: Partial<SiteIntegrationSeriesData>,
): SiteIntegrationSeriesData {
  return {
    siteId: overrides.siteId || 'manhuagui',
    seriesId: overrides.seriesId || BASIC_SERIES.series.seriesId,
    seriesTitle: overrides.seriesTitle || 'テスト漫画',
    author: overrides.author,
    description: overrides.description,
    coverUrl: overrides.coverUrl,
    status: overrides.status,
  };
}
