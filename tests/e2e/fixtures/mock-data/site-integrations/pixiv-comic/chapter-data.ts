/**
 * @file chapter-data.ts
 * @description Pixiv Comic chapter mock data.
 *
 * Chapter URLs follow: https://comic.pixiv.net/viewer/stories/{episodeId}
 * The `id` field is the numeric episode id used by Pixiv APIs.
 */

import type { SiteIntegrationChapterDataset } from '../../types';

function buildStoryUrl(id: string): string {
  return `https://comic.pixiv.net/viewer/stories/${id}`;
}

export const BASIC_CHAPTERS: SiteIntegrationChapterDataset = {
  id: 'PIXIV_COMIC_BASIC',
  description: 'Basic 5-chapter Pixiv Comic work with sequential numbering',
  chapters: [
    {
      id: '70001',
      url: buildStoryUrl('70001'),
      title: '第1話 出発',
      index: 1,
      chapterNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '70002',
      url: buildStoryUrl('70002'),
      title: '第2話 邂逅',
      index: 2,
      chapterNumber: 2,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '70003',
      url: buildStoryUrl('70003'),
      title: '第3話 嵐の夜',
      index: 3,
      chapterNumber: 3,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '70004',
      url: buildStoryUrl('70004'),
      title: '第4話 選択',
      index: 4,
      chapterNumber: 4,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '70005',
      url: buildStoryUrl('70005'),
      title: '第5話 新たな旅立ち',
      index: 5,
      chapterNumber: 5,
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
};

export const SMALL_SERIES: SiteIntegrationChapterDataset = {
  id: 'PIXIV_COMIC_SMALL',
  description: 'Single-chapter Pixiv Comic work',
  chapters: [
    {
      id: '70101',
      url: buildStoryUrl('70101'),
      title: '第1話',
      index: 1,
      chapterNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
};
