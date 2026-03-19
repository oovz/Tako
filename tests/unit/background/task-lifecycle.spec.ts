import { describe, expect, it } from 'vitest'

import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { normalizeInterruptedChapter, normalizeInterruptedTask } from '@/entrypoints/background/task-lifecycle'
import type { DownloadTaskState } from '@/src/types/queue-state'

describe('task lifecycle helpers', () => {
  it('normalizes queued and downloading chapters into failed chapters with the provided timestamp and message', () => {
    const now = 1234

    expect(
      normalizeInterruptedChapter(
        { id: 'queued', url: 'queued', title: 'Queued', index: 1, status: 'queued', lastUpdated: 1 },
        'Download interrupted',
        now,
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Download interrupted',
        lastUpdated: now,
      }),
    )

    expect(
      normalizeInterruptedChapter(
        { id: 'downloading', url: 'downloading', title: 'Downloading', index: 2, status: 'downloading', lastUpdated: 2 },
        'Download interrupted',
        now,
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Download interrupted',
        lastUpdated: now,
      }),
    )
  })

  it('leaves already-terminal chapters unchanged', () => {
    const chapter = {
      id: 'completed',
      url: 'completed',
      title: 'Completed',
      index: 3,
      status: 'completed' as const,
      lastUpdated: 42,
    }

    expect(normalizeInterruptedChapter(chapter, 'Download interrupted', 999)).toEqual(chapter)
  })

  it('normalizes interrupted tasks to partial_success when any chapters already completed', () => {
    const now = 2000
    const task: DownloadTaskState = {
      id: 'task-partial',
      siteIntegrationId: 'mangadex',
      mangaId: 'series-1',
      seriesTitle: 'Series 1',
      chapters: [
        { id: 'c1', url: 'c1', title: 'c1', index: 1, status: 'completed', lastUpdated: 10 },
        { id: 'c2', url: 'c2', title: 'c2', index: 2, status: 'downloading', lastUpdated: 11 },
        { id: 'c3', url: 'c3', title: 'c3', index: 3, status: 'queued', lastUpdated: 12 },
      ],
      status: 'downloading',
      created: 1000,
      settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'mangadex'),
    }

    const normalized = normalizeInterruptedTask(task, 'Download interrupted', now)

    expect(normalized.status).toBe('partial_success')
    expect(normalized.errorMessage).toBe('Download interrupted')
    expect(normalized.completed).toBe(now)
    expect(normalized.chapters.map((chapter) => chapter.status)).toEqual(['completed', 'failed', 'failed'])
  })

  it('normalizes fully interrupted tasks to failed and preserves an existing completed timestamp', () => {
    const task: DownloadTaskState = {
      id: 'task-failed',
      siteIntegrationId: 'mangadex',
      mangaId: 'series-2',
      seriesTitle: 'Series 2',
      chapters: [
        { id: 'c1', url: 'c1', title: 'c1', index: 1, status: 'queued', lastUpdated: 1 },
        { id: 'c2', url: 'c2', title: 'c2', index: 2, status: 'downloading', lastUpdated: 2 },
      ],
      status: 'downloading',
      created: 100,
      completed: 777,
      settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'mangadex'),
    }

    const normalized = normalizeInterruptedTask(task, 'Extension updated during download', 999)

    expect(normalized.status).toBe('failed')
    expect(normalized.errorMessage).toBe('Extension updated during download')
    expect(normalized.completed).toBe(777)
    expect(normalized.chapters.every((chapter) => chapter.status === 'failed')).toBe(true)
  })
})


