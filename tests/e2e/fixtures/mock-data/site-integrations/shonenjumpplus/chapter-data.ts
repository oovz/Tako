/**
 * @file chapter-data.ts
 * @description Shonen Jump+ chapter mock data.
 *
 * Chapter URLs follow `https://shonenjumpplus.com/episode/{episodeId}`.
 * The episode id is also the chapter id used by the queue.
 */

import type { SiteIntegrationChapterDataset } from '../../types';

function buildEpisodeUrl(id: string): string {
  return `https://shonenjumpplus.com/episode/${id}`;
}

export const BASIC_CHAPTERS: SiteIntegrationChapterDataset = {
  id: 'SHONENJUMPPLUS_BASIC',
  description: 'Basic 4-chapter Shonen Jump+ series',
  chapters: [
    {
      id: '3269754496649675685',
      url: buildEpisodeUrl('3269754496649675685'),
      title: '第1話',
      index: 1,
      chapterNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '3269754496649675686',
      url: buildEpisodeUrl('3269754496649675686'),
      title: '第2話',
      index: 2,
      chapterNumber: 2,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '3269754496649675687',
      url: buildEpisodeUrl('3269754496649675687'),
      title: '第3話',
      index: 3,
      chapterNumber: 3,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '3269754496649675688',
      url: buildEpisodeUrl('3269754496649675688'),
      title: '第4話',
      index: 4,
      chapterNumber: 4,
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
};

export const SMALL_SERIES: SiteIntegrationChapterDataset = {
  id: 'SHONENJUMPPLUS_SMALL',
  description: 'Single-chapter Shonen Jump+ series',
  chapters: [
    {
      id: '3269754496649675702',
      url: buildEpisodeUrl('3269754496649675702'),
      title: '第1話',
      index: 1,
      chapterNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
};
