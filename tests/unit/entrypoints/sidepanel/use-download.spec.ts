import { describe, expect, it } from 'vitest'

import {
  buildStartDownloadMessage,
  resolveDownloadSeriesIdentity,
  resolveSelectedChapterStates,
} from '@/entrypoints/sidepanel/hooks/useDownload'
import type { ChapterState } from '@/src/types/tab-state'

function makeChapter(
  partial: Partial<ChapterState> & { url: string; title: string; index: number; chapterLabel?: string },
): ChapterState {
  return {
    id: partial.id ?? partial.url,
    url: partial.url,
    title: partial.title,
    index: partial.index,
    status: partial.status ?? 'queued',
    lastUpdated: partial.lastUpdated ?? Date.now(),
    chapterNumber: partial.chapterNumber,
    volumeLabel: partial.volumeLabel,
    volumeNumber: partial.volumeNumber,
    locked: partial.locked,
    errorMessage: partial.errorMessage,
    totalImages: partial.totalImages,
    imagesFailed: partial.imagesFailed,
    language: partial.language,
    chapterLabel: partial.chapterLabel,
  }
}

describe('resolveSelectedChapterStates', () => {
  const chapters: ChapterState[] = [
    makeChapter({ url: 'u1', title: 'One', index: 1 }),
    makeChapter({ url: 'u2', title: 'Two', index: 2 }),
    makeChapter({ url: 'u3', title: 'Three', index: 3 }),
  ]

  it('returns chapters matching the explicit side-panel selection urls', () => {
    const selected = resolveSelectedChapterStates(chapters, ['u1', 'u3'])
    expect(selected.map((chapter) => chapter.url)).toEqual(['u1', 'u3'])
  })

  it('returns an empty selection when no explicit side-panel urls are provided', () => {
    expect(resolveSelectedChapterStates(chapters, [])).toEqual([])
  })

  it('returns empty selection for empty chapter list', () => {
    expect(resolveSelectedChapterStates([], ['u1'])).toEqual([])
  })

  it('returns only chapters matching the explicit stable chapter ids when urls collide', () => {
    const duplicateUrl = 'https://example.com/chapter/shared'
    const duplicateUrlChapters: ChapterState[] = [
      makeChapter({ id: 'chapter-a', url: duplicateUrl, title: 'One', index: 1 }),
      makeChapter({ id: 'chapter-b', url: duplicateUrl, title: 'Two', index: 2 }),
    ]

    expect(resolveSelectedChapterStates(duplicateUrlChapters, ['chapter-b'])).toEqual([
      duplicateUrlChapters[1],
    ])
  })
})

describe('resolveDownloadSeriesIdentity', () => {
  it('returns site and series ids from a MangaPageState context', () => {
    expect(
      resolveDownloadSeriesIdentity({
        siteIntegrationId: 'mangadex',
        mangaId: 'series-1',
        seriesTitle: 'Series 1',
        chapters: [],
        volumes: [],
        lastUpdated: 1,
      }),
    ).toEqual({
      siteId: 'mangadex',
      seriesId: 'series-1',
    })
  })

  it('returns undefined identifiers when the active context is absent', () => {
    expect(resolveDownloadSeriesIdentity(undefined)).toEqual({
      siteId: undefined,
      seriesId: undefined,
    })
  })
})

describe('buildStartDownloadMessage', () => {
  it('preserves sourceTabId, metadata, raw chapter labels, and per-chapter language in START_DOWNLOAD payloads', () => {
    const message = buildStartDownloadMessage({
      tabId: 321,
      mangaState: {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-1',
        seriesTitle: 'Series 1',
        chapters: [],
        volumes: [],
        metadata: {
          author: 'Author Name',
          coverUrl: 'https://example.com/cover.png',
          publisher: 'Test Publisher',
          readingDirection: 'rtl',
        },
        lastUpdated: 1,
      },
      selectedChapterStates: [
        makeChapter({
          id: 'chapter-1',
          url: 'https://mangadex.org/chapter/1',
          title: 'Chapter 12.5',
          index: 1,
          chapterLabel: 'Ch. 12.5',
          chapterNumber: 12.5,
          volumeLabel: 'Vol. 02',
          volumeNumber: 2,
          language: 'ja',
        }),
      ],
    })

    expect(message).toEqual({
      type: 'START_DOWNLOAD',
      payload: {
        sourceTabId: 321,
        siteIntegrationId: 'mangadex',
        mangaId: 'series-1',
        seriesTitle: 'Series 1',
        chapters: [
          {
            id: 'chapter-1',
            title: 'Chapter 12.5',
            url: 'https://mangadex.org/chapter/1',
            index: 1,
            chapterLabel: 'Ch. 12.5',
            chapterNumber: 12.5,
            volumeLabel: 'Vol. 02',
            volumeNumber: 2,
            language: 'ja',
          },
        ],
        metadata: {
          author: 'Author Name',
          coverUrl: 'https://example.com/cover.png',
          publisher: 'Test Publisher',
          readingDirection: 'rtl',
        },
      },
    })
  })

  it('preserves zero as a valid sourceTabId', () => {
    const message = buildStartDownloadMessage({
      tabId: 0,
      mangaState: {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-1',
        seriesTitle: 'Series 1',
        chapters: [],
        volumes: [],
        lastUpdated: 1,
      },
      selectedChapterStates: [
        makeChapter({
          id: 'chapter-1',
          url: 'https://mangadex.org/chapter/1',
          title: 'Chapter 1',
          index: 1,
        }),
      ],
    })

    expect(message.payload.sourceTabId).toBe(0)
  })

  it('forwards integration-provided numeric chapter fields in START_DOWNLOAD payloads', () => {
    const message = buildStartDownloadMessage({
      tabId: 321,
      mangaState: {
        siteIntegrationId: 'mangadex',
        mangaId: 'series-1',
        seriesTitle: 'Series 1',
        chapters: [],
        volumes: [],
        lastUpdated: 1,
      },
      selectedChapterStates: [
        makeChapter({
          id: 'chapter-1',
          url: 'https://mangadex.org/chapter/1',
          title: 'Chapter 12.5',
          index: 1,
          chapterLabel: 'Ch. 12.5',
          chapterNumber: 12.5,
          volumeLabel: 'Vol. 02',
          volumeNumber: 2,
          language: 'ja',
        }),
      ],
    })

    expect(message.payload.chapters[0]).toEqual({
      id: 'chapter-1',
      title: 'Chapter 12.5',
      url: 'https://mangadex.org/chapter/1',
      index: 1,
      chapterLabel: 'Ch. 12.5',
      chapterNumber: 12.5,
      volumeLabel: 'Vol. 02',
      volumeNumber: 2,
      language: 'ja',
    })
  })
})

