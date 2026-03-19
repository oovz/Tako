import { describe, expect, it } from 'vitest'

import { normalizeActiveTaskProgress } from '@/entrypoints/sidepanel/hooks/useActiveTaskProgress'

describe('useActiveTaskProgress normalizeActiveTaskProgress', () => {
  it('returns null for invalid payload', () => {
    expect(normalizeActiveTaskProgress(undefined)).toBeNull()
    expect(normalizeActiveTaskProgress({ taskId: 'x' })).toBeNull()
  })

  it('returns null for unsupported status values', () => {
    expect(
      normalizeActiveTaskProgress({
        taskId: 'task-1',
        imagesProcessed: 1,
        totalImages: 5,
        status: 'queued',
      }),
    ).toBeNull()
  })

  it('returns normalized payload when required fields are present', () => {
    expect(
      normalizeActiveTaskProgress({
        taskId: 'task-1',
        imagesProcessed: 4,
        totalImages: 20,
        activeChapterCount: 2,
        activeChapters: [
          {
            chapterId: 'ch-1',
            chapterTitle: ' Chapter 1 ',
            imagesProcessed: 1,
            totalImages: 8,
          },
          {
            chapterId: 'ch-2',
            chapterTitle: 'Chapter 2',
            imagesProcessed: 3,
            totalImages: 12,
          },
        ],
        status: 'downloading',
      }),
    ).toEqual({
      taskId: 'task-1',
      chapterId: undefined,
      chapterTitle: undefined,
      imagesProcessed: 4,
      totalImages: 20,
      activeChapterCount: 2,
      activeChapters: [
        {
          chapterId: 'ch-1',
          chapterTitle: 'Chapter 1',
          imagesProcessed: 1,
          totalImages: 8,
          updatedAt: undefined,
        },
        {
          chapterId: 'ch-2',
          chapterTitle: 'Chapter 2',
          imagesProcessed: 3,
          totalImages: 12,
          updatedAt: undefined,
        },
      ],
      status: 'downloading',
    })
  })

  it('normalizes blank chapterTitle to undefined so UI can make deterministic availability checks', () => {
    expect(
      normalizeActiveTaskProgress({
        taskId: 'task-1',
        chapterId: 'ch-1',
        chapterTitle: '   ',
        imagesProcessed: 1,
        totalImages: 5,
        status: 'downloading',
      }),
    ).toEqual({
      taskId: 'task-1',
      chapterId: 'ch-1',
      chapterTitle: undefined,
      imagesProcessed: 1,
      totalImages: 5,
      activeChapterCount: 1,
      activeChapters: [
        {
          chapterId: 'ch-1',
          chapterTitle: undefined,
          imagesProcessed: 1,
          totalImages: 5,
        },
      ],
      status: 'downloading',
    })
  })

  it('prefers normalized activeChapters length over stale activeChapterCount payload', () => {
    expect(
      normalizeActiveTaskProgress({
        taskId: 'task-1',
        imagesProcessed: 6,
        totalImages: 30,
        activeChapterCount: 1,
        activeChapters: [
          { chapterId: 'ch-1', chapterTitle: 'A', imagesProcessed: 2, totalImages: 10 },
          { chapterId: 'ch-2', chapterTitle: 'B', imagesProcessed: 2, totalImages: 10 },
          { chapterId: 'ch-3', chapterTitle: 'C', imagesProcessed: 2, totalImages: 10 },
        ],
        status: 'downloading',
      }),
    ).toEqual(
      expect.objectContaining({
        activeChapterCount: 3,
      }),
    )
  })

  it('aggregates image counts from activeChapters when concurrent chapter snapshots are present', () => {
    expect(
      normalizeActiveTaskProgress({
        taskId: 'task-1',
        imagesProcessed: 1,
        totalImages: 4,
        activeChapterCount: 1,
        activeChapters: [
          { chapterId: 'ch-1', chapterTitle: 'A', imagesProcessed: 2, totalImages: 8 },
          { chapterId: 'ch-2', chapterTitle: 'B', imagesProcessed: 3, totalImages: 12 },
        ],
        status: 'downloading',
      }),
    ).toEqual(
      expect.objectContaining({
        imagesProcessed: 5,
        totalImages: 20,
        activeChapterCount: 2,
      }),
    )
  })
})
