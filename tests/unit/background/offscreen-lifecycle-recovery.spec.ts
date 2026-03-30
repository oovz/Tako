import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { recoverFromLivenessTimeout } from '@/entrypoints/background/offscreen-lifecycle'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'

function createStateManagerMock(activeTasks: Array<{
  id: string
  status: 'downloading' | 'queued' | 'failed' | 'partial_success' | 'completed' | 'canceled'
  chapters: Array<{ id: string; url: string; status: 'queued' | 'downloading' | 'completed' | 'partial_success' | 'failed' }>
}>) {
  return {
    getGlobalState: vi.fn(async () => ({
      downloadQueue: activeTasks.map((activeTask, index) => ({
        ...activeTask,
        tabId: index + 1,
        siteId: `mangadex-${index + 1}`,
        seriesId: `series-${index + 1}`,
        seriesTitle: `Series ${index + 1}`,
        progress: 50,
        created: Date.now() - 10_000,
      })),
    })),
    updateDownloadTaskChapter: vi.fn(async () => {}),
    updateDownloadTask: vi.fn(async () => {}),
  } as unknown as CentralizedStateManager
}

describe('recoverFromLivenessTimeout', () => {
  const storageSessionGet = vi.fn()
  const storageSessionSet = vi.fn(async () => {})
  const closeDocument = vi.fn(async () => {})

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: storageSessionGet,
          set: storageSessionSet,
        },
      },
      offscreen: {
        closeDocument,
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks active task as failed/partial_success, closes offscreen, and triggers recovery callback when stale', async () => {
    const now = Date.now()
    storageSessionGet.mockResolvedValue({
      lastOffscreenActivity: now - 120_000,
    })

    const stateManager = createStateManagerMock([
      {
        id: 'active-task',
        status: 'downloading',
        chapters: [
          { id: 'c1', url: 'https://example.com/c1', status: 'completed' },
          { id: 'c2', url: 'https://example.com/c2', status: 'downloading' },
          { id: 'c3', url: 'https://example.com/c3', status: 'queued' },
        ],
      },
      {
        id: 'active-task-2',
        status: 'downloading',
        chapters: [
          { id: 'd1', url: 'https://example.com/d1', status: 'downloading' },
        ],
      },
    ])

    const pendingDownloadsStore = {
      clear: vi.fn(),
      snapshot: vi.fn(() => new Map<number, string>()),
      hydrate: vi.fn(async () => {}),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    }

    const onRecover = vi.fn(async () => {})

    await recoverFromLivenessTimeout(stateManager, pendingDownloadsStore, onRecover)

    expect(stateManager.updateDownloadTaskChapter).toHaveBeenCalledTimes(3)
    expect(stateManager.updateDownloadTaskChapter).toHaveBeenCalledWith(
      'active-task',
      'c2',
      'failed',
      expect.objectContaining({ errorMessage: 'Download process unresponsive' }),
    )
    expect(stateManager.updateDownloadTaskChapter).toHaveBeenCalledWith(
      'active-task',
      'c3',
      'failed',
      expect.objectContaining({ errorMessage: 'Download process unresponsive' }),
    )
    expect(stateManager.updateDownloadTaskChapter).toHaveBeenCalledWith(
      'active-task-2',
      'd1',
      'failed',
      expect.objectContaining({ errorMessage: 'Download process unresponsive' }),
    )

    expect(stateManager.updateDownloadTask).toHaveBeenCalledWith(
      'active-task',
      expect.objectContaining({
        status: 'partial_success',
        errorMessage: 'Download process unresponsive',
      }),
    )
    expect(stateManager.updateDownloadTask).toHaveBeenCalledWith(
      'active-task-2',
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Download process unresponsive',
      }),
    )

    expect(storageSessionSet).toHaveBeenCalledWith(
      expect.objectContaining({ activeTaskProgress: null }),
    )
    expect(pendingDownloadsStore.clear).toHaveBeenCalledTimes(1)
    expect(closeDocument).toHaveBeenCalledTimes(1)
    expect(onRecover).toHaveBeenCalledTimes(1)
  })

  it('keeps tasks at partial_success when stale recovery finds existing partial_success chapters', async () => {
    const now = Date.now()
    storageSessionGet.mockResolvedValue({
      lastOffscreenActivity: now - 120_000,
    })

    const stateManager = createStateManagerMock([
      {
        id: 'active-task-partial',
        status: 'downloading',
        chapters: [
          { id: 'c1', url: 'https://example.com/c1', status: 'partial_success' },
          { id: 'c2', url: 'https://example.com/c2', status: 'downloading' },
        ],
      },
    ])

    const pendingDownloadsStore = {
      clear: vi.fn(),
      snapshot: vi.fn(() => new Map<number, string>()),
      hydrate: vi.fn(async () => {}),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    }

    const onRecover = vi.fn(async () => {})

    await recoverFromLivenessTimeout(stateManager, pendingDownloadsStore, onRecover)

    expect(stateManager.updateDownloadTask).toHaveBeenCalledWith(
      'active-task-partial',
      expect.objectContaining({
        status: 'partial_success',
        errorMessage: 'Download process unresponsive',
      }),
    )
  })

  it('does nothing when offscreen activity is within timeout threshold', async () => {
    const now = Date.now()
    storageSessionGet.mockResolvedValue({
      lastOffscreenActivity: now - 10_000,
    })

    const stateManager = createStateManagerMock([
      {
        id: 'active-task',
        status: 'downloading',
        chapters: [{ id: 'c1', url: 'https://example.com/c1', status: 'downloading' }],
      },
    ])

    const pendingDownloadsStore = {
      clear: vi.fn(),
      snapshot: vi.fn(() => new Map<number, string>()),
      hydrate: vi.fn(async () => {}),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    }

    const onRecover = vi.fn(async () => {})

    await recoverFromLivenessTimeout(stateManager, pendingDownloadsStore, onRecover)

    expect(stateManager.updateDownloadTaskChapter).not.toHaveBeenCalled()
    expect(stateManager.updateDownloadTask).not.toHaveBeenCalled()
    expect(pendingDownloadsStore.clear).not.toHaveBeenCalled()
    expect(closeDocument).not.toHaveBeenCalled()
    expect(onRecover).not.toHaveBeenCalled()
  })
})

