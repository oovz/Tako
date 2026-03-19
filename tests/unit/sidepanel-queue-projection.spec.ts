import { describe, it, expect } from 'vitest'

import { projectToQueueView } from '@/entrypoints/background/projection'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import type { DownloadTaskState } from '@/src/types/queue-state'

function makeTask(id: string, status: DownloadTaskState['status'], created: number): DownloadTaskState {
  return {
    id,
    siteIntegrationId: 'test-site',
    mangaId: 'series-1',
    seriesTitle: `Series ${id}`,
    chapters: [],
    status,
    created,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'test-site'),
  } as DownloadTaskState
}

describe('queueView projection contract', () => {
  it('keeps downloading active and queued tasks ordered by creation time', () => {
    const now = Date.now()
    const projection = projectToQueueView([
      makeTask('queued-1', 'queued', now - 3000),
      makeTask('queued-2', 'queued', now - 2000),
      makeTask('downloading-1', 'downloading', now - 1000),
    ])

    expect(projection.activeCount).toBe(1)
    expect(projection.queuedCount).toBe(2)
    expect(projection.queueView.map((task) => task.id)).toEqual([
      'downloading-1',
      'queued-1',
      'queued-2',
    ])
    expect(projection.queueView[1]?.status).toBe('queued')
    expect(projection.queueView[2]?.status).toBe('queued')
  })
})

