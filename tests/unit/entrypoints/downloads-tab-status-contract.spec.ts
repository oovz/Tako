import { describe, expect, it } from 'vitest'

import { projectToQueueView } from '@/entrypoints/background/projection'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import type { DownloadTaskState } from '@/src/types/queue-state'

function makeTask(status: DownloadTaskState['status']): DownloadTaskState {
  const now = Date.now()
  return {
    id: `task-${status}`,
    siteIntegrationId: 'mangadex',
    mangaId: `series-${status}`,
    seriesTitle: `Series ${status}`,
    chapters: [
      {
        id: 'chapter-1',
        url: 'https://example.com/chapter-1',
        title: 'Chapter 1',
        index: 1,
        status: status === 'completed' ? 'completed' : 'queued',
        lastUpdated: now,
      },
    ],
    status,
    created: now,
    completed: status === 'completed' ? now : undefined,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'mangadex'),
  }
}

describe('DownloadsTab status vocabulary contract (behavior-based)', () => {
  it('classifies queued tasks as queued non-terminal queue items', () => {
    const projection = projectToQueueView([
      makeTask('queued'),
      makeTask('downloading'),
      makeTask('completed'),
    ])

    expect(projection.queuedCount).toBe(1)
    expect(projection.activeCount).toBe(1)
    expect(projection.nonTerminalCount).toBe(2)
    expect(projection.queueView.map((task) => task.status)).toContain('queued')
  })

  it('rejects deprecated waiting status from queue projection', () => {
    const legacyQueue = [
      {
        ...makeTask('queued'),
        status: 'waiting',
      },
    ] as unknown as DownloadTaskState[]

    expect(() => projectToQueueView(legacyQueue)).toThrow(/Unhandled queue status: waiting/)
  })

  it('rejects deprecated pending status from queue projection', () => {
    const legacyQueue = [
      {
        ...makeTask('queued'),
        status: 'pending',
      },
    ] as unknown as DownloadTaskState[]

    expect(() => projectToQueueView(legacyQueue)).toThrow(/Unhandled queue status: pending/)
  })
})

