import type { SiteIntegrationChapterDataset } from '../../types'

export const BASIC_CHAPTERS: SiteIntegrationChapterDataset = {
  id: 'COMICNETTAI_BASIC',
  description: 'Basic 3-chapter Comic Nettai series using PUBLUS viewer URLs',
  chapters: [
    {
      id: '958',
      url: 'https://www.comicnettai.com/publus/viewer.html?cid=mock-cid-958',
      title: '第46話',
      index: 1,
      chapterLabel: '第46話',
      chapterNumber: 46,
      language: 'ja',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '938',
      url: 'https://www.comicnettai.com/publus/viewer.html?cid=mock-cid-938',
      title: '第45話',
      index: 2,
      chapterLabel: '第45話',
      chapterNumber: 45,
      language: 'ja',
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '925',
      url: 'https://www.comicnettai.com/publus/viewer.html?cid=mock-cid-925',
      title: '第44話',
      index: 3,
      chapterLabel: '第44話',
      chapterNumber: 44,
      language: 'ja',
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
}
