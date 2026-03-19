/**
 * Unit tests for DownloadsTab UI components
 * 
 * Tests for:
 * - Task status summary label generation
 * - Chapter status badge class mapping
 */

import { describe, it, expect } from 'vitest'
import { chapterStatusBadgeClass, getTaskStatusSummaryLabel } from '@/entrypoints/options/tabs/DownloadsTab'
import type { DownloadTaskState, TaskChapter } from '@/src/types/queue-state'

function makeChapter(overrides: Partial<TaskChapter> = {}): TaskChapter {
  return {
    id: overrides.id ?? 'ch-1',
    url: overrides.url ?? 'https://example.com/chapter/1',
    title: overrides.title ?? 'Chapter 1',
    index: overrides.index ?? 1,
    status: overrides.status ?? 'queued',
    lastUpdated: overrides.lastUpdated ?? Date.now(),
    errorMessage: overrides.errorMessage,
    imagesFailed: overrides.imagesFailed,
    totalImages: overrides.totalImages,
  }
}

function makeTask(status: DownloadTaskState['status'], chapters: TaskChapter[]): Pick<DownloadTaskState, 'status' | 'chapters'> {
  return {
    status,
    chapters,
  }
}

describe('DownloadsTab status summary behavior', () => {
  it('renders plural completed summary when all chapters completed', () => {
    const label = getTaskStatusSummaryLabel(
      makeTask('completed', [makeChapter({ status: 'completed' }), makeChapter({ id: 'ch-2', status: 'completed' })]),
    )

    expect(label).toBe('✅ Completed (2 chapters)')
  })

  it('renders single-chapter completed summary for one chapter', () => {
    const label = getTaskStatusSummaryLabel(makeTask('completed', [makeChapter({ status: 'completed' })]))

    expect(label).toBe('✅ Completed (1 chapter)')
  })

  it('uses completed chapter count in failed/partial summaries', () => {
    const chapters = [
      makeChapter({ status: 'completed' }),
      makeChapter({ id: 'ch-2', status: 'completed' }),
      makeChapter({ id: 'ch-3', status: 'failed' }),
      makeChapter({ id: 'ch-4', status: 'partial_success' }),
    ]

    expect(getTaskStatusSummaryLabel(makeTask('failed', chapters))).toBe('❌ Failed (2 of 4 chapters saved)')
    expect(getTaskStatusSummaryLabel(makeTask('partial_success', chapters))).toBe('⚠ Partial (2 of 4 chapters saved)')
  })

  it('renders queued/downloading/canceled summaries with expected wording', () => {
    const chapters = [
      makeChapter({ status: 'completed' }),
      makeChapter({ id: 'ch-2', status: 'queued' }),
      makeChapter({ id: 'ch-3', status: 'downloading' }),
    ]

    expect(getTaskStatusSummaryLabel(makeTask('queued', chapters))).toBe('3 chapters queued')
    expect(getTaskStatusSummaryLabel(makeTask('downloading', chapters))).toBe('Downloading 1 of 3 chapters')
    expect(getTaskStatusSummaryLabel(makeTask('canceled', chapters))).toBe('⚠ Canceled (1 of 3 chapters saved)')
  })
})

describe('DownloadsTab chapter status badge behavior', () => {
  it('maps chapter statuses to expected badge classes', () => {
    expect(chapterStatusBadgeClass('completed')).toBe('bg-primary/10 text-primary')
    expect(chapterStatusBadgeClass('partial_success')).toBe('bg-amber-500/20 text-amber-700')
    expect(chapterStatusBadgeClass('failed')).toBe('bg-destructive text-destructive-foreground')
    expect(chapterStatusBadgeClass('downloading')).toBe('bg-primary text-primary-foreground')
    expect(chapterStatusBadgeClass('queued')).toBe('bg-muted text-muted-foreground')
  })

  it('falls back to muted style for unknown chapter statuses', () => {
    expect(chapterStatusBadgeClass('unknown-status')).toBe('bg-muted text-muted-foreground')
  })
})
