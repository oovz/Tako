/**
 * Unit tests for download progress features
 * 
 * - Per-image progress display
 * - Open Folder button constraints
 * - Task audit trail storage
 */

import { describe, it, expect } from 'vitest'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { toQueueTaskSummary } from '@/src/runtime/queue-task-summary'
import type { DownloadTaskState } from '@/src/types/queue-state'

 function toRecord(value: unknown): Record<string, unknown> {
   return value as Record<string, unknown>
 }

function makeTask(overrides: Partial<DownloadTaskState> = {}): DownloadTaskState {
  const siteIntegrationId = overrides.siteIntegrationId ?? 'test-site'
  return {
    id: 'task-default',
    siteIntegrationId,
    mangaId: 'series-1',
    seriesTitle: 'Test Series',
    chapters: [],
    status: 'queued',
    created: Date.now(),
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
    ...overrides,
  }
}

describe('Per-image progress display', () => {
  it('should not include currentImageIndex and totalImagesInChapter in QueueTaskSummary', () => {
    const task = makeTask({ id: 'task-1', status: 'downloading' })

    const summary = toQueueTaskSummary(task)
    const record = toRecord(summary)

    expect(record).not.toHaveProperty('currentImageIndex')
    expect(record).not.toHaveProperty('totalImagesInChapter')
  })

  it('should handle missing per-image progress fields gracefully', () => {
    const task = makeTask({ id: 'task-2', status: 'downloading' })

    const summary = toQueueTaskSummary(task)
    const record = toRecord(summary)

    expect(record).not.toHaveProperty('currentImageIndex')
    expect(record).not.toHaveProperty('totalImagesInChapter')
  })
})

describe('Open Folder button constraints', () => {
  it('should include lastSuccessfulDownloadId in QueueTaskSummary for completed tasks', () => {
    const task = makeTask({
      id: 'task-3',
      status: 'completed',
      completed: Date.now(),
      lastSuccessfulDownloadId: 12345,
    })

    const summary = toQueueTaskSummary(task)
    const record = toRecord(summary)

    expect(summary.lastSuccessfulDownloadId).toBe(12345)
    expect(record).not.toHaveProperty('downloadId')
    expect(summary.status).toBe('completed')
  })

  it('should not include lastSuccessfulDownloadId for active/queued tasks', () => {
    const task = makeTask({ id: 'task-4', status: 'downloading' })

    const summary = toQueueTaskSummary(task)

    expect(summary.lastSuccessfulDownloadId).toBeUndefined()
  })
})

describe('Task audit trail storage', () => {
  it('uses chapters as the canonical task audit trail', () => {
    const task = makeTask({
      id: 'task-5',
      chapters: [
        {
          id: 'ch-1',
          url: 'https://example.com/ch1',
          title: 'Chapter 1',
          index: 1,
          status: 'completed',
          lastUpdated: Date.now(),
        },
        {
          id: 'ch-2',
          url: 'https://example.com/ch2',
          title: 'Chapter 2',
          index: 2,
          status: 'failed',
          errorMessage: 'Network timeout',
          lastUpdated: Date.now(),
        },
        {
          id: 'ch-3',
          url: 'https://example.com/ch3',
          title: 'Chapter 3',
          index: 3,
          status: 'partial_success',
          imagesFailed: 2,
          totalImages: 10,
          lastUpdated: Date.now(),
        },
      ],
      status: 'partial_success',
      completed: Date.now(),
    })

    expect(task.chapters).toHaveLength(3)
    expect(task.chapters[0]?.status).toBe('completed')
    expect(task.chapters[1]?.status).toBe('failed')
    expect(task.chapters[1]?.errorMessage).toBe('Network timeout')
    expect(task.chapters[2]?.status).toBe('partial_success')
    expect(task.chapters[2]?.imagesFailed).toBe(2)
  })

  it('does not require a separate chapterOutcomes task field', () => {
    const task = makeTask({
      id: 'task-5b',
      chapters: [
        {
          id: 'ch-1',
          url: 'https://example.com/ch1',
          title: 'Chapter 1',
          index: 1,
          status: 'completed',
          lastUpdated: Date.now(),
        },
      ],
      status: 'completed',
      completed: Date.now(),
    })

    expect(toRecord(task)).not.toHaveProperty('chapterOutcomes')
  })
})

describe('QueueTaskSummary status handling', () => {
  it('should map partial_success status correctly', () => {
    const task = makeTask({
      id: 'task-6',
      chapters: [
        { id: 'ch1', url: 'ch1', title: 'Ch1', index: 0, status: 'completed', lastUpdated: Date.now() },
        { id: 'ch2', url: 'ch2', title: 'Ch2', index: 1, status: 'failed', lastUpdated: Date.now() },
      ],
      status: 'partial_success',
      completed: Date.now(),
      errorMessage: '1 chapter failed',
    })

    const summary = toQueueTaskSummary(task)

    expect(summary.status).toBe('partial_success')
    expect(summary.chapters.completed).toBe(1)
    expect(summary.chapters.unsuccessful).toBe(1)
    expect(summary.failureReason).toBe('1 chapter failed')
  })

  it('should count partial_success chapters as unsuccessful in summary', () => {
    const task = makeTask({
      id: 'task-7',
      chapters: [
        { id: 'ch1', url: 'ch1', title: 'Ch1', index: 0, status: 'completed', lastUpdated: Date.now() },
        { id: 'ch2', url: 'ch2', title: 'Ch2', index: 1, status: 'partial_success', lastUpdated: Date.now() },
        { id: 'ch3', url: 'ch3', title: 'Ch3', index: 2, status: 'failed', lastUpdated: Date.now() },
      ],
      status: 'partial_success',
    })

    const summary = toQueueTaskSummary(task)
    const record = toRecord(summary)

    expect(summary.chapters.completed).toBe(1)
    expect(summary.chapters.unsuccessful).toBe(2)
    expect(record).not.toHaveProperty('failedChapters')
  })
})

