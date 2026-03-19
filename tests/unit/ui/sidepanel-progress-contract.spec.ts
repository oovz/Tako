import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

import { ActiveTaskProgress } from '@/entrypoints/sidepanel/components/ActiveTaskProgress'
import type { QueueTaskSummary } from '@/src/types/queue-state'

function makeTask(overrides: Partial<QueueTaskSummary> = {}): QueueTaskSummary {
  return {
    id: 'task-1',
    seriesKey: 'mangadex#manga-1',
    seriesTitle: 'Series 1',
    siteIntegration: 'mangadex',
    status: 'downloading',
    chapters: { total: 4, completed: 1, unsuccessful: 0 },
    timestamps: { created: Date.now() },
    failureReason: undefined,
    failureCategory: undefined,
    isRetried: false,
    isRetryTask: false,
    lastSuccessfulDownloadId: undefined,
    ...overrides,
  }
}

describe('ActiveTaskProgress', () => {
  it('renders chapter/image progress labels for active multi-chapter task', () => {
    const html = renderToStaticMarkup(
      React.createElement(ActiveTaskProgress, {
        task: makeTask(),
        progress: {
          taskId: 'task-1',
          status: 'downloading',
          chapterTitle: 'Chapter 2',
          imagesProcessed: 12,
          totalImages: 40,
          activeChapterCount: 2,
          activeChapters: [
            { chapterId: 'ch-2', chapterTitle: 'Chapter 2', imagesProcessed: 6, totalImages: 20 },
            { chapterId: 'ch-3', chapterTitle: 'Chapter 3', imagesProcessed: 6, totalImages: 20 },
          ],
        },
      }),
    )

    expect(html).toContain('Progress')
    expect(html).toContain('2 chapters downloading')
    expect(html).toContain('12/40 images')
  })

  it('shows single chapter title suffix when totalChapters is one', () => {
    const html = renderToStaticMarkup(
      React.createElement(ActiveTaskProgress, {
        task: makeTask({ chapters: { total: 1, completed: 0, unsuccessful: 0 } }),
        progress: {
          taskId: 'task-1',
          status: 'downloading',
          chapterTitle: 'Chapter One',
          imagesProcessed: 3,
          totalImages: 10,
          activeChapterCount: 1,
          activeChapters: [{ chapterId: 'ch-1', chapterTitle: 'Chapter One', imagesProcessed: 3, totalImages: 10 }],
        },
      }),
    )

    expect(html).toContain('Chapter 1/1 - Chapter One')
    expect(html).toContain('3/10 images')
  })
})

