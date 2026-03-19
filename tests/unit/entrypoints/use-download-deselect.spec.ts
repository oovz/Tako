import { describe, expect, it } from 'vitest'

import { resolveSelectedChapterStates } from '@/entrypoints/sidepanel/hooks/useDownload'
import type { ChapterState } from '@/src/types/tab-state'

function makeChapter(partial: Partial<ChapterState> & { id: string; url: string; title: string; index: number }): ChapterState {
  return {
    id: partial.id,
    url: partial.url,
    title: partial.title,
    index: partial.index,
    status: partial.status ?? 'queued',
    lastUpdated: partial.lastUpdated ?? Date.now(),
    chapterLabel: partial.chapterLabel,
    chapterNumber: partial.chapterNumber,
    volumeLabel: partial.volumeLabel,
    volumeNumber: partial.volumeNumber,
    locked: partial.locked,
    progress: partial.progress,
    errorMessage: partial.errorMessage,
    downloadId: partial.downloadId,
    totalImages: partial.totalImages,
    imagesFailed: partial.imagesFailed,
    language: partial.language,
  }
}

describe('useDownload explicit selection sourcing', () => {
  it('uses explicit side-panel selections when provided', () => {
    const chapters: ChapterState[] = [
      makeChapter({ id: 'chapter-1', url: 'chapter-1', title: 'Chapter 1', index: 1 }),
      makeChapter({ id: 'chapter-2', url: 'chapter-2', title: 'Chapter 2', index: 2 }),
      makeChapter({ id: 'chapter-3', url: 'chapter-3', title: 'Chapter 3', index: 3 }),
    ]

    const selected = resolveSelectedChapterStates(chapters, ['chapter-1', 'chapter-3'])

    expect(selected.map((chapter) => chapter.url)).toEqual(['chapter-1', 'chapter-3'])
  })

  it('returns an empty list when explicit side-panel selections are absent', () => {
    const chapters: ChapterState[] = [
      makeChapter({ id: 'chapter-1', url: 'chapter-1', title: 'Chapter 1', index: 1 }),
      makeChapter({ id: 'chapter-2', url: 'chapter-2', title: 'Chapter 2', index: 2 }),
    ]

    const selected = resolveSelectedChapterStates(chapters, [])

    expect(selected).toEqual([])
  })
})

