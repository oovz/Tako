import { describe, expect, it } from 'vitest'

import { normalizeQueueView } from '@/entrypoints/sidepanel/hooks/useQueueView'

 function makeQueueTask(id: string, status: string, seriesTitle: string, created = 1000) {
   return {
     id,
     seriesKey: `mangadex#${id}`,
     seriesTitle,
     siteIntegration: 'mangadex',
     status,
     chapters: {
       total: 3,
       completed: 1,
       unsuccessful: 0,
     },
     timestamps: {
       created,
     },
   }
 }

describe('useQueueView normalizeQueueView', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeQueueView(undefined)).toEqual([])
    expect(normalizeQueueView({})).toEqual([])
  })

  it('keeps only valid queue task summaries', () => {
    const normalized = normalizeQueueView([
      makeQueueTask('task-1', 'queued', 'Series A'),
      {
        id: 'task-2',
        status: 'downloading',
      },
      'invalid-item',
    ])

    expect(normalized).toEqual([
      makeQueueTask('task-1', 'queued', 'Series A'),
    ])
  })

  it('rejects queue items with unsupported status values', () => {
    const normalized = normalizeQueueView([
      makeQueueTask('task-1', 'waiting', 'Series A'),
      makeQueueTask('task-2', 'failed', 'Series B'),
    ])

    expect(normalized).toEqual([
      makeQueueTask('task-2', 'failed', 'Series B'),
    ])
  })

  it('strips malformed optional summary fields while preserving valid ones', () => {
    const normalized = normalizeQueueView([
      {
        ...makeQueueTask('task-1', 'completed', 'Series A'),
        coverUrl: 123,
        failureReason: ['bad'],
        failureCategory: 'bogus',
        isRetried: 'yes',
        isRetryTask: true,
        lastSuccessfulDownloadId: 'nope',
      },
      {
        ...makeQueueTask('task-2', 'partial_success', 'Series B'),
        coverUrl: 'https://example.com/cover.jpg',
        failureReason: 'Network issue',
        failureCategory: 'network',
        isRetried: false,
        isRetryTask: true,
        lastSuccessfulDownloadId: 42,
      },
    ])

    expect(normalized).toEqual([
      {
        ...makeQueueTask('task-1', 'completed', 'Series A'),
        coverUrl: undefined,
        failureReason: undefined,
        failureCategory: undefined,
        isRetried: undefined,
        isRetryTask: true,
        lastSuccessfulDownloadId: undefined,
      },
      {
        ...makeQueueTask('task-2', 'partial_success', 'Series B'),
        coverUrl: 'https://example.com/cover.jpg',
        failureReason: 'Network issue',
        failureCategory: 'network',
        isRetried: false,
        isRetryTask: true,
        lastSuccessfulDownloadId: 42,
      },
    ])
  })
})
