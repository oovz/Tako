/**
 * @file chapter-data.ts
 * @description Manhuagui chapter mock data.
 *
 * Chapter URLs follow `/comic/{seriesId}/{chapterId}.html`. The chapter id
 * is a monotonically increasing numeric identifier scoped to the series.
 */

import type { SiteIntegrationChapterDataset } from '../../types';

function buildChapterUrl(seriesId: string, chapterId: string): string {
  return `https://www.manhuagui.com/comic/${seriesId}/${chapterId}.html`;
}

const BASIC_SERIES_ID = '55555';
const ADULT_SERIES_ID = '77777';
const MINIMAL_SERIES_ID = '66666';

export const BASIC_CHAPTERS: SiteIntegrationChapterDataset = {
  id: 'MANHUAGUI_BASIC',
  description: 'Basic 4-chapter Manhuagui series grouped into two volumes',
  chapters: [
    {
      id: '100001',
      url: buildChapterUrl(BASIC_SERIES_ID, '100001'),
      title: '第1话',
      index: 1,
      chapterNumber: 1,
      volumeNumber: 1,
      volumeLabel: '第1卷',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '100002',
      url: buildChapterUrl(BASIC_SERIES_ID, '100002'),
      title: '第2话',
      index: 2,
      chapterNumber: 2,
      volumeNumber: 1,
      volumeLabel: '第1卷',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '100003',
      url: buildChapterUrl(BASIC_SERIES_ID, '100003'),
      title: '第3话',
      index: 3,
      chapterNumber: 3,
      volumeNumber: 2,
      volumeLabel: '第2卷',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '100004',
      url: buildChapterUrl(BASIC_SERIES_ID, '100004'),
      title: '第4话',
      index: 4,
      chapterNumber: 4,
      volumeNumber: 2,
      volumeLabel: '第2卷',
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
};

export const ADULT_CHAPTERS: SiteIntegrationChapterDataset = {
  id: 'MANHUAGUI_ADULT',
  description: 'Adult-gated Manhuagui series chapter list (rendered via __VIEWSTATE decode)',
  chapters: [
    {
      id: '700001',
      url: buildChapterUrl(ADULT_SERIES_ID, '700001'),
      title: '第1话',
      index: 1,
      chapterNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '700002',
      url: buildChapterUrl(ADULT_SERIES_ID, '700002'),
      title: '第2话',
      index: 2,
      chapterNumber: 2,
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
};

export const SMALL_SERIES: SiteIntegrationChapterDataset = {
  id: 'MANHUAGUI_SMALL',
  description: 'Single-chapter Manhuagui series',
  chapters: [
    {
      id: '600001',
      url: buildChapterUrl(MINIMAL_SERIES_ID, '600001'),
      title: '第1话',
      index: 1,
      chapterNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
};
