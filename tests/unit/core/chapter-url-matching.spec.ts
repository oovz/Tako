/**
 * Regression tests for strict chapter ID matching.
 *
 * State mutations are keyed only by canonical chapter IDs. URLs remain metadata
 * for navigation and integration-specific fetches, but they are not lookup keys.
 */

import { describe, it, expect } from 'vitest'

interface ChapterState {
  id: string
  url: string
  title: string
  status: string
}

/**
 * Find chapter index by canonical chapter ID only
 * (Mirror of CentralizedStateManager.findChapterIndex)
 */
function findChapterIndex(chapters: ChapterState[], chapterIdentifier: string): number {
  return chapters.findIndex(ch => ch.id === chapterIdentifier)
}

describe('Chapter ID matching', () => {
  const createChapters = (defs: Partial<ChapterState>[]): ChapterState[] =>
    defs.map((ch, i) => ({
      id: ch.id || `ch-${1000 + i}`,
      url: ch.url || `https://alpha.example/chapter/${1000 + i}`,
      title: ch.title || `Chapter ${i + 1}`,
      status: ch.status || 'queued',
    }))

  it('matches chapters by exact canonical ID', () => {
    const chapters = createChapters([
      { id: 'ch-1001', url: 'https://alpha.example/chapter/1001', title: 'Chapter 1' },
      { id: 'ch-1002', url: 'https://alpha.example/chapter/1002', title: 'Chapter 2' },
    ])

    const index = findChapterIndex(chapters, 'ch-1001')
    expect(index).toBe(0)
  })

  it('does not match by URL when the ID differs', () => {
    const chapters = createChapters([
      { url: 'https://alpha.example/chapter/1001', title: 'Chapter 1', id: 'ch-1001' },
      { url: 'https://alpha.example/chapter/1002', title: 'Chapter 2', id: 'ch-1002' },
    ])

    const index = findChapterIndex(chapters, 'https://alpha.example/chapter/1001')
    expect(index).toBe(-1)
  })

  it('does not match by URL path aliases', () => {
    const chapters = createChapters([
      { id: 'ch-1001', url: 'https://alpha.example/chapter/1001', title: 'Chapter 1' },
      { id: 'ch-1002', url: 'https://alpha.example/chapter/1002', title: 'Chapter 2' },
    ])

    const index = findChapterIndex(chapters, 'https://beta.example/chapter/1001')
    expect(index).toBe(-1)
  })

  it('returns -1 when no chapter has the requested ID', () => {
    const chapters = createChapters([
      { id: 'ch-2001', url: 'https://alpha.example/chapter/2001', title: 'Chapter 1' },
      { id: 'ch-2002', url: 'https://alpha.example/chapter/2002', title: 'Chapter 2' },
    ])

    const index = findChapterIndex(chapters, 'ch-9999')
    expect(index).toBe(-1)
  })
})

describe('Edge cases for chapter matching', () => {
  it('should handle empty chapters array', () => {
    const index = findChapterIndex([], 'ch-1001')
    expect(index).toBe(-1)
  })

  it('should return -1 for arbitrary non-ID input', () => {
    const chapters = [{ id: 'ch-1001', url: 'https://alpha.example/chapter/1001', title: 'Ch1', status: 'queued' }]
    
    const index = findChapterIndex(chapters, 'not-a-valid-url')
    expect(index).toBe(-1)
  })

  it('still matches by ID even if URL metadata is malformed', () => {
    const chapters = [{ id: 'ch-1001', url: 'invalid-url', title: 'Ch1', status: 'queued' }]
    
    const index = findChapterIndex(chapters, 'ch-1001')
    expect(index).toBe(0)
  })
})
