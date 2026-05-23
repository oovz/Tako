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
const CATEGORY_SERIES_ID = '21243';
const KIMETSU_SERIES_ID = '19430';

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

export const CATEGORY_CHAPTERS: SiteIntegrationChapterDataset = {
  id: 'MANHUAGUI_CATEGORY',
  description: 'Manhuagui reference-style series grouped by category headings instead of numeric volumes',
  chapters: [
    {
      id: '378327',
      url: buildChapterUrl(CATEGORY_SERIES_ID, '378327'),
      title: '第03卷',
      index: 1,
      chapterNumber: 3,
      volumeId: 'manhuagui-volume-1',
      volumeLabel: '单行本',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '378326',
      url: buildChapterUrl(CATEGORY_SERIES_ID, '378326'),
      title: '第02卷',
      index: 2,
      chapterNumber: 2,
      volumeId: 'manhuagui-volume-1',
      volumeLabel: '单行本',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '378325',
      url: buildChapterUrl(CATEGORY_SERIES_ID, '378325'),
      title: '第01卷',
      index: 3,
      chapterNumber: 1,
      volumeId: 'manhuagui-volume-1',
      volumeLabel: '单行本',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '363932',
      url: buildChapterUrl(CATEGORY_SERIES_ID, '363932'),
      title: '番外篇',
      index: 4,
      volumeId: 'manhuagui-volume-2',
      volumeLabel: '番外篇',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '357843',
      url: buildChapterUrl(CATEGORY_SERIES_ID, '357843'),
      title: '第32话',
      index: 5,
      chapterNumber: 32,
      volumeId: 'manhuagui-volume-3',
      volumeLabel: '单话',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '357842',
      url: buildChapterUrl(CATEGORY_SERIES_ID, '357842'),
      title: '第31话',
      index: 6,
      chapterNumber: 31,
      volumeId: 'manhuagui-volume-3',
      volumeLabel: '单话',
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
};

export const KIMETSU_CHAPTERS: SiteIntegrationChapterDataset = {
  id: 'MANHUAGUI_KIMETSU',
  description: 'Manhuagui 19430-style page with category headings, pagination controls, and visible page counts',
  chapters: [
    {
      id: '585094',
      url: buildChapterUrl(KIMETSU_SERIES_ID, '585094'),
      title: '第01卷',
      index: 1,
      chapterNumber: 1,
      volumeId: 'manhuagui-volume-1',
      volumeLabel: '单行本',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '219425',
      url: buildChapterUrl(KIMETSU_SERIES_ID, '219425'),
      title: '第01回',
      index: 2,
      chapterNumber: 1,
      volumeId: 'manhuagui-volume-2',
      volumeLabel: '单话',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '494877',
      url: buildChapterUrl(KIMETSU_SERIES_ID, '494877'),
      title: '20卷附录',
      index: 3,
      chapterNumber: 20,
      volumeId: 'manhuagui-volume-3',
      volumeLabel: '番外篇',
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
};
