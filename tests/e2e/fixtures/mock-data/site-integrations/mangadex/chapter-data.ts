/**
 * @file chapter-data.ts
 * @description MangaDex chapter mock data with realistic URLs
 * 
 * Chapter URLs follow pattern: https://mangadex.test/chapter/[chapter-uuid]
 * Series URLs follow pattern: https://mangadex.test/title/[series-uuid]/[slug]
 */

import type { SiteIntegrationChapterData, SiteIntegrationChapterDataset } from '../../types';

// ============================================================================
// Chapter Datasets
// ============================================================================

/**
 * Basic 10-chapter series for general testing
 */
export const BASIC_CHAPTERS: SiteIntegrationChapterDataset = {
  id: 'MANGADEX_BASIC',
  description: 'Basic 10-chapter series with sequential chapters',
  chapters: [
    {
      id: 'afaebc64-83df-4f11-b2b0-5ef4fcc8144c',
      url: 'https://mangadex.test/chapter/afaebc64-83df-4f11-b2b0-5ef4fcc8144c',
      title: 'The Day of Departure',
      index: 1,
      chapterNumber: 1,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '8505488a-2ff1-4023-ad39-0893f1886adf',
      url: 'https://mangadex.test/chapter/8505488a-2ff1-4023-ad39-0893f1886adf',
      title: 'An Encounter In The Storm',
      index: 2,
      chapterNumber: 2,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '77aeb3dc-59da-4aae-854e-709abb43c480',
      url: 'https://mangadex.test/chapter/77aeb3dc-59da-4aae-854e-709abb43c480',
      title: 'The Ultimate Choice',
      index: 3,
      chapterNumber: 3,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: 'd9d564bc-968c-4fd6-9773-ce9d050eb1cb',
      url: 'https://mangadex.test/chapter/d9d564bc-968c-4fd6-9773-ce9d050eb1cb',
      title: 'Wicked Magical Vulpes',
      index: 4,
      chapterNumber: 4,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: 'b3ab1347-5929-4fad-8bba-ca7bbc1f2527',
      url: 'https://mangadex.test/chapter/b3ab1347-5929-4fad-8bba-ca7bbc1f2527',
      title: 'The First Phase Begins: Part 1',
      index: 5,
      chapterNumber: 5,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '3a43a6e9-aac9-49fd-a9ed-87fb0ae24991',
      url: 'https://mangadex.test/chapter/3a43a6e9-aac9-49fd-a9ed-87fb0ae24991',
      title: 'The First Phase Begins: Part 2',
      index: 6,
      chapterNumber: 6,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '01b880ff-470e-4d68-b2d1-943f48ecdac9',
      url: 'https://mangadex.test/chapter/01b880ff-470e-4d68-b2d1-943f48ecdac9',
      title: 'Respective Reason',
      index: 7,
      chapterNumber: 7,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '74425cb0-98ca-4e89-9f33-0d39f3f7b202',
      url: 'https://mangadex.test/chapter/74425cb0-98ca-4e89-9f33-0d39f3f7b202',
      title: 'The Other Enemy',
      index: 8,
      chapterNumber: 8,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: 'a0531e0b-a744-450f-a0f2-195534d75cc0',
      url: 'https://mangadex.test/chapter/a0531e0b-a744-450f-a0f2-195534d75cc0',
      title: 'A Struggle In The Mist',
      index: 9,
      chapterNumber: 9,
      volumeNumber: 2,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: 'cffbcd72-b587-43b3-9876-8ea01f0551ac',
      url: 'https://mangadex.test/chapter/cffbcd72-b587-43b3-9876-8ea01f0551ac',
      title: 'An Unexpected Task',
      index: 10,
      chapterNumber: 10,
      volumeNumber: 2,
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
};

/**
 * Small 5-chapter series for quick tests
 */
export const SMALL_SERIES: SiteIntegrationChapterDataset = {
  id: 'MANGADEX_SMALL',
  description: 'Small 5-chapter series',
  chapters: [
    {
      id: 'afaebc64-83df-4f11-b2b0-5ef4fcc8144c',
      url: 'https://mangadex.test/chapter/afaebc64-83df-4f11-b2b0-5ef4fcc8144c',
      title: 'The Day of Departure',
      index: 1,
      chapterNumber: 1,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '8505488a-2ff1-4023-ad39-0893f1886adf',
      url: 'https://mangadex.test/chapter/8505488a-2ff1-4023-ad39-0893f1886adf',
      title: 'An Encounter In The Storm',
      index: 2,
      chapterNumber: 2,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: '77aeb3dc-59da-4aae-854e-709abb43c480',
      url: 'https://mangadex.test/chapter/77aeb3dc-59da-4aae-854e-709abb43c480',
      title: 'The Ultimate Choice',
      index: 3,
      chapterNumber: 3,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: 'd9d564bc-968c-4fd6-9773-ce9d050eb1cb',
      url: 'https://mangadex.test/chapter/d9d564bc-968c-4fd6-9773-ce9d050eb1cb',
      title: 'Wicked Magical Vulpes',
      index: 4,
      chapterNumber: 4,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
    {
      id: 'b3ab1347-5929-4fad-8bba-ca7bbc1f2527',
      url: 'https://mangadex.test/chapter/b3ab1347-5929-4fad-8bba-ca7bbc1f2527',
      title: 'The First Phase Begins: Part 1',
      index: 5,
      chapterNumber: 5,
      volumeNumber: 1,
      status: 'queued',
      lastUpdated: Date.now(),
    },
  ],
};

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a single chapter with custom overrides
 */
export function createMangadexChapter(overrides: Partial<SiteIntegrationChapterData>): SiteIntegrationChapterData {
  const chapterId = overrides.id || '99999999-9999-9999-9999-999999999999';
  return {
    id: chapterId,
    url: overrides.url || `https://mangadex.test/chapter/${chapterId}`,
    title: overrides.title || 'Test Chapter',
    index: overrides.index ?? 1,
    chapterNumber: overrides.chapterNumber,
    volumeNumber: overrides.volumeNumber,
    volumeLabel: overrides.volumeLabel,
    status: overrides.status || 'queued',
    lastUpdated: overrides.lastUpdated || Date.now(),
    progress: overrides.progress,
    downloadId: overrides.downloadId,
    errorMessage: overrides.errorMessage,
  };
}

/**
 * Create multiple chapters with UUID-like IDs
 */
export function createMangadexChapters(count: number): SiteIntegrationChapterData[] {
  return Array.from({ length: count }, (_, i) => {
    const chNum = i + 1;
    const uuid = `${String(chNum).padStart(8, '0')}-0000-0000-0000-000000000000`;
    return {
      id: uuid,
      url: `https://mangadex.test/chapter/${uuid}`,
      title: `Chapter ${chNum}`,
      index: chNum,
      chapterNumber: chNum,
      status: 'queued' as const,
      lastUpdated: Date.now(),
    };
  });
}
