import { describe, expect, it, vi } from 'vitest'

import { retryFailedChapters } from '@/entrypoints/background/download-queue'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import type { DownloadTaskState, GlobalAppState, TaskChapter } from '@/src/types/queue-state'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'

function makeChapter(overrides: Partial<TaskChapter> = {}): TaskChapter {
  return {
    id: overrides.id ?? 'chapter-1',
    url: overrides.url ?? 'https://example.com/chapter-1',
    title: overrides.title ?? 'Chapter 1',
    index: overrides.index ?? 1,
    status: overrides.status ?? 'failed',
    errorMessage: overrides.errorMessage,
    totalImages: overrides.totalImages,
    imagesFailed: overrides.imagesFailed,
    lastUpdated: overrides.lastUpdated ?? Date.now(),
  }
}

function makeTask(overrides: Partial<DownloadTaskState> = {}): DownloadTaskState {
  const siteIntegrationId = overrides.siteIntegrationId ?? 'mangadex'
  return {
    id: overrides.id ?? 'task-1',
    siteIntegrationId,
    mangaId: overrides.mangaId ?? 'mangadex:abc',
    seriesTitle: overrides.seriesTitle ?? 'Test Series',
    chapters: overrides.chapters ?? [makeChapter()],
    status: overrides.status ?? 'partial_success',
    created: overrides.created ?? Date.now() - 1000,
    completed: overrides.completed ?? Date.now(),
    isRetried: overrides.isRetried ?? false,
    isRetryTask: overrides.isRetryTask ?? false,
    lastSuccessfulDownloadId: overrides.lastSuccessfulDownloadId,
    settingsSnapshot: overrides.settingsSnapshot ?? createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
  }
}

function createMockStateManager(downloadQueue: DownloadTaskState[]): CentralizedStateManager {
  const globalState: GlobalAppState = {
    downloadQueue,
    settings: DEFAULT_SETTINGS,
    lastActivity: Date.now(),
  }

  return {
    getGlobalState: vi.fn().mockResolvedValue(globalState),
    addDownloadTask: vi.fn().mockResolvedValue(undefined),
    updateDownloadTask: vi.fn().mockResolvedValue(undefined),
  } as unknown as CentralizedStateManager
}

describe('retryFailedChapters', () => {
  it('creates retry task with canonical queued defaults and clears transient fields', async () => {
    const task = makeTask({
      id: 'task-original',
      status: 'partial_success',
      lastSuccessfulDownloadId: 77,
      chapters: [
        makeChapter({ id: 'ch-1', status: 'completed', totalImages: 12, imagesFailed: 0 }),
        makeChapter({ id: 'ch-2', status: 'failed', errorMessage: 'Network', totalImages: 15, imagesFailed: 1 }),
        makeChapter({ id: 'ch-3', status: 'partial_success', errorMessage: 'Partial', totalImages: 14, imagesFailed: 2 }),
      ],
    })

    const stateManager = createMockStateManager([task])

    const result = await retryFailedChapters(stateManager, task.id)

    expect(result.success).toBe(true)

    const addDownloadTaskMock = vi.mocked(stateManager.addDownloadTask)
    expect(addDownloadTaskMock).toHaveBeenCalledTimes(1)

    const createdTask = addDownloadTaskMock.mock.calls[0][0] as DownloadTaskState
    expect(createdTask.id).toBe(result.newTaskId)
    expect(createdTask.status).toBe('queued')
    expect(createdTask.isRetried).toBe(false)
    expect(createdTask.isRetryTask).toBe(true)
    expect(createdTask.lastSuccessfulDownloadId).toBeUndefined()
    expect(createdTask.settingsSnapshot).toEqual(task.settingsSnapshot)
    expect(createdTask.chapters).toHaveLength(2)

    for (const chapter of createdTask.chapters) {
      expect(chapter.status).toBe('queued')
      expect(chapter.errorMessage).toBeUndefined()
      expect(chapter.totalImages).toBeUndefined()
      expect(chapter.imagesFailed).toBeUndefined()
    }

    expect(vi.mocked(stateManager.updateDownloadTask)).toHaveBeenCalledWith(task.id, { isRetried: true })
  })
})

