import { describe, expect, it, vi } from 'vitest'

import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { initializeFromStorage } from '@/entrypoints/background/initialize-from-storage'
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import type { DownloadTaskState } from '@/src/types/queue-state'

function makeTask(overrides: Partial<DownloadTaskState>): DownloadTaskState {
  const siteIntegrationId = overrides.siteIntegrationId ?? 'mangadex'
  return {
    id: 'task-1',
    siteIntegrationId,
    mangaId: 'series-1',
    seriesTitle: 'Series 1',
    chapters: [],
    status: 'queued',
    created: 1,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, siteIntegrationId),
    ...overrides,
  }
}

describe('initializeFromStorage', () => {
  it('normalizes zombie downloading task when offscreen is missing and re-projects queueView', async () => {
    const queue: DownloadTaskState[] = [
      makeTask({
        id: 'zombie',
        status: 'downloading',
        chapters: [
          {
            id: 'c1',
            url: 'c1',
            title: 'c1',
            index: 1,
            status: 'completed',
            lastUpdated: 1,
          },
          {
            id: 'c2',
            url: 'c2',
            title: 'c2',
            index: 2,
            status: 'downloading',
            lastUpdated: 1,
          },
          {
            id: 'c3',
            url: 'c3',
            title: 'c3',
            index: 3,
            status: 'queued',
            lastUpdated: 1,
          },
        ],
      }),
      makeTask({ id: 'queued-next', status: 'queued', created: 2 }),
    ]

    const writeQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const writeSession = vi.fn(async (_values: Record<string, unknown>) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const ensureLivenessAlarm = vi.fn(async () => {})
    const resumeQueue = vi.fn(async () => {})

    const result = await initializeFromStorage({
      readQueue: async () => queue,
      writeQueue,
      writeSession,
      applyQueue,
      getOffscreenContexts: async () => [],
      ensureLivenessAlarm,
      resumeQueue,
    })

    expect(result.initFailed).toBe(false)
    expect(writeQueue).toHaveBeenCalledTimes(1)

    const persistedQueue = writeQueue.mock.calls[0]?.[0] as DownloadTaskState[]
    const normalizedZombie = persistedQueue.find((task) => task.id === 'zombie')
    expect(normalizedZombie?.status).toBe('partial_success')
    expect(normalizedZombie?.errorMessage).toBe('Download interrupted')
    expect(normalizedZombie?.chapters.map((chapter) => chapter.status)).toEqual([
      'completed',
      'failed',
      'failed',
    ])

    const queueViewWrite = writeSession.mock.calls.find(
      (call) => call[0] && Object.prototype.hasOwnProperty.call(call[0], 'queueView'),
    )
    expect(queueViewWrite).toBeTruthy()
    expect(queueViewWrite?.[0]).toEqual(
      expect.objectContaining({
        [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
        [SESSION_STORAGE_KEYS.initFailed]: false,
        error: null,
      }),
    )
    expect(applyQueue).toHaveBeenCalledWith(persistedQueue)

    expect(ensureLivenessAlarm).toHaveBeenCalledTimes(1)
    expect(resumeQueue).toHaveBeenCalledTimes(1)
  })

  it('marks initFailed in session when initialization throws', async () => {
    const writeSession = vi.fn(async (_values: Record<string, unknown>) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})

    const result = await initializeFromStorage({
      readQueue: async () => {
        throw new Error('storage corruption')
      },
      writeQueue: async () => {},
      writeSession,
      applyQueue,
      getOffscreenContexts: async () => [],
      ensureLivenessAlarm: async () => {},
      resumeQueue: async () => {},
    })

    expect(result.initFailed).toBe(true)
    expect(result.error).toBe('storage corruption')
    expect(writeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        [SESSION_STORAGE_KEYS.queueView]: [],
        [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
        [SESSION_STORAGE_KEYS.initFailed]: true,
        error: 'storage corruption',
      }),
    )
  })

  it('does not normalize active downloading task when offscreen context is alive (SW restart happy path)', async () => {
    const queue: DownloadTaskState[] = [
      makeTask({
        id: 'active-with-offscreen',
        status: 'downloading',
        chapters: [
          {
            id: 'c1',
            url: 'c1',
            title: 'c1',
            index: 1,
            status: 'downloading',
            lastUpdated: 1,
          },
        ],
      }),
    ]

    const writeQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const writeSession = vi.fn(async (_values: Record<string, unknown>) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const ensureLivenessAlarm = vi.fn(async () => {})
    const resumeQueue = vi.fn(async () => {})

    const result = await initializeFromStorage({
      readQueue: async () => queue,
      writeQueue,
      writeSession,
      applyQueue,
      getOffscreenContexts: async () => [{}],
      ensureLivenessAlarm,
      resumeQueue,
    })

    expect(result.initFailed).toBe(false)
    expect(result.queue[0]?.status).toBe('downloading')
    expect(result.queue[0]?.chapters[0]?.status).toBe('downloading')

    expect(writeQueue).not.toHaveBeenCalled()
    expect(applyQueue).toHaveBeenCalledWith(queue)
    expect(resumeQueue).not.toHaveBeenCalled()
    expect(ensureLivenessAlarm).toHaveBeenCalledTimes(1)
  })

  it('does not resume queued work when offscreen context is alive and another task is already downloading', async () => {
    const queue: DownloadTaskState[] = [
      makeTask({
        id: 'active-with-offscreen',
        status: 'downloading',
        chapters: [
          {
            id: 'c1',
            url: 'c1',
            title: 'c1',
            index: 1,
            status: 'downloading',
            lastUpdated: 1,
          },
        ],
      }),
      makeTask({ id: 'queued-next', status: 'queued', created: 2 }),
    ]

    const writeQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const writeSession = vi.fn(async (_values: Record<string, unknown>) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const ensureLivenessAlarm = vi.fn(async () => {})
    const resumeQueue = vi.fn(async () => {})

    const result = await initializeFromStorage({
      readQueue: async () => queue,
      writeQueue,
      writeSession,
      applyQueue,
      getOffscreenContexts: async () => [{}],
      ensureLivenessAlarm,
      resumeQueue,
    })

    expect(result.initFailed).toBe(false)
    expect(writeQueue).not.toHaveBeenCalled()
    expect(applyQueue).toHaveBeenCalledWith(queue)
    expect(resumeQueue).not.toHaveBeenCalled()
    expect(ensureLivenessAlarm).toHaveBeenCalledTimes(1)
  })

  it('applies the latest persisted queue when storage changes during startup recovery', async () => {
    const seededQueue: DownloadTaskState[] = [
      makeTask({
        id: 'retried-canceled-options',
        status: 'canceled',
        seriesTitle: 'Retried Canceled Options',
        completed: 10,
        isRetried: true,
      }),
      makeTask({
        id: 'retried-failed-options',
        status: 'failed',
        seriesTitle: 'Retried Failed Options',
        completed: 20,
        isRetried: true,
        errorMessage: 'Network error',
      }),
    ]

    const readQueue = vi
      .fn<() => Promise<DownloadTaskState[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(seededQueue)

    const writeQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const writeSession = vi.fn(async (_values: Record<string, unknown>) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const ensureLivenessAlarm = vi.fn(async () => {})
    const resumeQueue = vi.fn(async () => {})

    const result = await initializeFromStorage({
      readQueue,
      writeQueue,
      writeSession,
      applyQueue,
      getOffscreenContexts: async () => [{}],
      ensureLivenessAlarm,
      resumeQueue,
    })

    expect(result.initFailed).toBe(false)
    expect(readQueue).toHaveBeenCalledTimes(2)
    expect(result.queue).toEqual(seededQueue)
    expect(applyQueue).toHaveBeenCalledWith(seededQueue)
    expect(writeQueue).not.toHaveBeenCalled()
    expect(resumeQueue).not.toHaveBeenCalled()
  })
})

