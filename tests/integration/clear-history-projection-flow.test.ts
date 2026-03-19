import { describe, expect, it, vi } from 'vitest'

import { clearAllHistory } from '@/entrypoints/background/download-queue'
import { projectToQueueView } from '@/entrypoints/background/projection'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { DownloadTaskState, GlobalAppState } from '@/src/types/queue-state'

function makeTask(id: string, status: DownloadTaskState['status']): DownloadTaskState {
  const now = Date.now()
  return {
    id,
    siteIntegrationId: 'mangadex',
    mangaId: `series-${id}`,
    seriesTitle: `Series ${id}`,
    chapters: [
      {
        id: `${id}-ch-1`,
        url: `https://example.com/${id}/1`,
        title: 'Chapter 1',
        index: 1,
        status: status === 'queued' ? 'queued' : status === 'downloading' ? 'downloading' : 'completed',
        lastUpdated: now,
      },
    ],
    status,
    created: now,
    completed: status === 'queued' || status === 'downloading' ? undefined : now,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, 'mangadex'),
  }
}

describe('clear history + queue projection flow', () => {
  it('removes terminal tasks and keeps queueView aligned with non-terminal tasks only', async () => {
    const queue: DownloadTaskState[] = [
      makeTask('active', 'downloading'),
      makeTask('queued', 'queued'),
      makeTask('completed', 'completed'),
      makeTask('partial', 'partial_success'),
      makeTask('failed', 'failed'),
      makeTask('canceled', 'canceled'),
    ]

    const globalState: GlobalAppState = {
      downloadQueue: queue,
      settings: {} as GlobalAppState['settings'],
      lastActivity: Date.now(),
    }

    const stateManager = {
      getGlobalState: vi.fn().mockResolvedValue(globalState),
      updateGlobalState: vi.fn().mockResolvedValue(undefined),
    } as unknown as CentralizedStateManager

    const result = await clearAllHistory(stateManager)

    expect(result.success).toBe(true)
    expect(result.removedCount).toBe(4)

    const updatedQueue = vi.mocked(stateManager.updateGlobalState).mock.calls[0]?.[0]
      ?.downloadQueue as DownloadTaskState[]

    expect(updatedQueue.map((task) => task.id)).toEqual(['active', 'queued'])

    const projection = projectToQueueView(updatedQueue)
    expect(projection.activeCount).toBe(1)
    expect(projection.queuedCount).toBe(1)
    expect(projection.nonTerminalCount).toBe(2)
    expect(projection.history).toHaveLength(0)
    expect(projection.queueView.every((task) => task.status === 'downloading' || task.status === 'queued')).toBe(true)
  })
})

