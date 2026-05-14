import { describe, it, expect } from 'vitest'

import { groupChapters } from '@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers'
import type { ChapterState, VolumeState } from '@/src/types/tab-state'

function makeChapter(partial: Partial<ChapterState> & { url: string; title: string }): ChapterState {
  return {
    id: partial.id ?? partial.url,
    url: partial.url,
    title: partial.title,
    locked: partial.locked,
    index: partial.index ?? 1,
    chapterNumber: partial.chapterNumber,
    volumeNumber: partial.volumeNumber,
    volumeId: partial.volumeId,
    volumeLabel: partial.volumeLabel,
    status: partial.status ?? 'queued',
    errorMessage: partial.errorMessage,
    lastUpdated: partial.lastUpdated ?? Date.now(),
  }
}

describe('groupChapters (Side Panel)', () => {
  it('preserves mixed standalone/volume order while grouping chapters into volumes', () => {
    const chapters: ChapterState[] = [
      makeChapter({
        url: 'inbetween-4',
        title: 'Chapter In-between 4',
        chapterNumber: 4.5,
        status: 'queued',
      }),
      makeChapter({
        url: 'v2-c2',
        title: 'Volume 2 Chapter 2',
        chapterNumber: 2,
        volumeNumber: 2,
        status: 'queued',
      }),
      makeChapter({
        url: 'v2-c1',
        title: 'Volume 2 Chapter1',
        chapterNumber: 1,
        volumeNumber: 2,
        status: 'queued',
      }),
      makeChapter({
        url: 'inbetween-3',
        title: 'Chapter In-between 3',
        chapterNumber: 3.5,
        status: 'queued',
      }),
      makeChapter({
        url: 'v1-c4',
        title: 'Volume 1 Chapter 4',
        chapterNumber: 4,
        volumeNumber: 1,
        status: 'queued',
      }),
      makeChapter({
        url: 'v1-c3',
        title: 'Volume 1 Chapter 3',
        chapterNumber: 3,
        volumeNumber: 1,
        status: 'queued',
      }),
    ]

    const grouped = groupChapters(chapters)

    // Expect 4 top-level items matching UX example:
    // Chapter In-between 4
    // Volume 2
    // Chapter In-between 3
    // Volume 1
    expect(grouped).toHaveLength(4)

    expect('chapters' in grouped[0]).toBe(false)
    if (!('chapters' in grouped[0])) {
      expect(grouped[0].title).toBe('Chapter In-between 4')
    }

    expect('chapters' in grouped[1]).toBe(true)
    if ('chapters' in grouped[1]) {
      expect(grouped[1].number).toBe(2)
      expect(grouped[1].chapters.map(ch => ch.url)).toEqual(['v2-c2', 'v2-c1'])
    }

    expect('chapters' in grouped[2]).toBe(false)
    if (!('chapters' in grouped[2])) {
      expect(grouped[2].title).toBe('Chapter In-between 3')
    }

    expect('chapters' in grouped[3]).toBe(true)
    if ('chapters' in grouped[3]) {
      expect(grouped[3].number).toBe(1)
      expect(grouped[3].chapters.map(ch => ch.url)).toEqual(['v1-c4', 'v1-c3'])
    }
  })

  it('preserves previous collapsed state per volume number', () => {
    const chapters: ChapterState[] = [
      makeChapter({ url: 'v1-c1', title: 'V1C1', chapterNumber: 1, volumeNumber: 1, status: 'queued' }),
      makeChapter({ url: 'v2-c1', title: 'V2C1', chapterNumber: 1, volumeNumber: 2, status: 'queued' }),
    ]

    const initial = groupChapters(chapters)

    const previousItems = initial.map(item => {
      if ('chapters' in item) {
        // Volume 1 collapsed, Volume 2 expanded
        return { ...item, collapsed: item.number === 1 }
      }
      return item
    }) as any

    const grouped = groupChapters(chapters, previousItems)

    const v1 = grouped.find(item => 'chapters' in item && item.number === 1) as any
    const v2 = grouped.find(item => 'chapters' in item && item.number === 2) as any

    expect(v1?.collapsed).toBe(true)
    expect(v2?.collapsed).toBe(false)
  })

  it('uses chapter volume labels as volume group titles when available', () => {
    const chapters: ChapterState[] = [
      makeChapter({
        url: 'extra-1',
        title: 'Extra 1',
        chapterNumber: 1,
        volumeNumber: 2,
        volumeLabel: '番外篇',
        status: 'queued',
      }),
      makeChapter({
        url: 'extra-2',
        title: 'Extra 2',
        chapterNumber: 2,
        volumeNumber: 2,
        volumeLabel: '番外篇',
        status: 'queued',
      }),
    ]

    const grouped = groupChapters(chapters)

    expect(grouped).toHaveLength(1)
    expect('chapters' in grouped[0]).toBe(true)
    if ('chapters' in grouped[0]) {
      expect(grouped[0].title).toBe('番外篇')
    }
  })

  it('groups explicit volumes by volumeId instead of synthetic volume numbers', () => {
    const volumes: VolumeState[] = [
      { id: 'single-issues', title: '单行本', label: '单行本' },
      { id: 'extras', title: '番外篇', label: '番外篇' },
      { id: 'chapters', title: '单话', label: '单话' },
    ]
    const chapters: ChapterState[] = [
      makeChapter({
        url: 'single-1',
        title: '第01卷142p',
        chapterNumber: 1,
        volumeId: 'single-issues',
        volumeLabel: '单行本',
      }),
      makeChapter({
        url: 'extra-1',
        title: '番外篇239p',
        chapterNumber: 239,
        volumeId: 'extras',
        volumeLabel: '番外篇',
      }),
      makeChapter({
        url: 'chapter-1',
        title: '新篇088p',
        chapterNumber: 88,
        volumeId: 'chapters',
        volumeLabel: '单话',
      }),
    ]

    const grouped = groupChapters(chapters, volumes)

    expect(grouped).toHaveLength(3)
    expect(grouped.every((item) => 'chapters' in item)).toBe(true)
    expect(grouped.map((item) => ('chapters' in item ? item.groupId : 'standalone'))).toEqual([
      'single-issues',
      'extras',
      'chapters',
    ])
    expect(grouped.map((item) => ('chapters' in item ? item.title : item.title))).toEqual([
      '单行本',
      '番外篇',
      '单话',
    ])
  })

  it('creates separate volume groups for disjoint runs of the same volume number', () => {
    const chapters: ChapterState[] = [
      makeChapter({
        url: 'standalone-1',
        title: 'Standalone chapter 1',
        chapterNumber: 1,
        status: 'queued',
      }),
      makeChapter({
        url: 'v2-c3',
        title: 'Volume 2 Chapter 3',
        chapterNumber: 3,
        volumeNumber: 2,
        status: 'queued',
      }),
      makeChapter({
        url: 'standalone-2',
        title: 'Standalone chapter 2',
        chapterNumber: 2,
        status: 'queued',
      }),
      makeChapter({
        url: 'v2-c4',
        title: 'Volume 2 Chapter 4',
        chapterNumber: 4,
        volumeNumber: 2,
        status: 'queued',
      }),
      makeChapter({
        url: 'v2-c5',
        title: 'Volume 2 Chapter 5',
        chapterNumber: 5,
        volumeNumber: 2,
        status: 'queued',
      }),
      makeChapter({
        url: 'standalone-3',
        title: 'Standalone chapter 3',
        chapterNumber: 3,
        status: 'queued',
      }),
      makeChapter({
        url: 'v2-c6',
        title: 'Volume 2 Chapter 6',
        chapterNumber: 6,
        volumeNumber: 2,
        status: 'queued',
      }),
    ]

    const grouped = groupChapters(chapters)

    // Expect: S1, V2(C3), S2, V2(C4,C5), S3, V2(C6)
    expect(grouped).toHaveLength(6)

    const asLabel = (item: any): string => {
      if ('chapters' in item) {
        return `V${item.number}(${item.chapters.map((ch: any) => ch.url).join(',')})`
      }
      return item.title
    }

    const labels = grouped.map(asLabel)
    expect(labels).toEqual([
      'Standalone chapter 1',
      'V2(v2-c3)',
      'Standalone chapter 2',
      'V2(v2-c4,v2-c5)',
      'Standalone chapter 3',
      'V2(v2-c6)',
    ])
  })

  it('propagates locked chapter state into grouped sidepanel rows with unselected defaults', () => {
    const chapters: ChapterState[] = [
      makeChapter({
        url: 'locked-1',
        title: 'Locked Chapter',
        chapterNumber: 1,
        locked: true,
      }),
      makeChapter({
        url: 'open-2',
        title: 'Open Chapter',
        chapterNumber: 2,
      }),
    ]

    const grouped = groupChapters(chapters)

    expect(grouped).toHaveLength(2)
    expect('chapters' in grouped[0]).toBe(false)
    expect('chapters' in grouped[1]).toBe(false)

    if (!('chapters' in grouped[0]) && !('chapters' in grouped[1])) {
      expect(grouped[0].locked).toBe(true)
      expect(grouped[0].selected).toBe(false)
      expect(grouped[1].locked).toBe(false)
      expect(grouped[1].selected).toBe(false)
    }
  })

  it('preserves canonical chapter ids when mapping MangaPageState chapters into sidepanel rows', () => {
    const chapters: ChapterState[] = [
      makeChapter({
        id: 'canonical-chapter-1',
        url: 'https://example.com/chapter/1',
        title: 'Chapter 1',
      }),
      makeChapter({
        id: 'canonical-chapter-2',
        url: 'https://example.com/chapter/2',
        title: 'Chapter 2',
        volumeNumber: 1,
      }),
    ]

    const grouped = groupChapters(chapters)
    const flattened = grouped.flatMap((item) => ('chapters' in item ? item.chapters : [item]))

    expect(flattened.map((chapter) => chapter.id)).toEqual([
      'canonical-chapter-1',
      'canonical-chapter-2',
    ])
  })
})

