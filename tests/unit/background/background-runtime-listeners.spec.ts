import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const projectionMocks = vi.hoisted(() => ({
  projectToQueueView: vi.fn(() => ({ queueView: [{ id: 'projected-task' }], nonTerminalCount: 1 })),
  updateActionBadge: vi.fn(async () => undefined),
}))

vi.mock('@/entrypoints/background/projection', () => ({
  projectToQueueView: projectionMocks.projectToQueueView,
  updateActionBadge: projectionMocks.updateActionBadge,
}))

import { registerBackgroundRuntimeListeners } from '@/entrypoints/background/background-runtime-listeners'
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'

describe('registerBackgroundRuntimeListeners', () => {
  const storageOnChangedAddListener = vi.fn()
  const tabsOnReplacedAddListener = vi.fn()
  const downloadsOnChangedAddListener = vi.fn()
  const alarmsOnAlarmAddListener = vi.fn()
  const tabsOnRemovedAddListener = vi.fn()
  const storageSessionSet = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('chrome', {
      storage: {
        onChanged: {
          addListener: storageOnChangedAddListener,
        },
        session: {
          set: storageSessionSet,
        },
      },
      tabs: {
        onReplaced: {
          addListener: tabsOnReplacedAddListener,
        },
        onRemoved: {
          addListener: tabsOnRemovedAddListener,
        },
      },
      downloads: {
        onChanged: {
          addListener: downloadsOnChangedAddListener,
        },
      },
      alarms: {
        onAlarm: {
          addListener: alarmsOnAlarmAddListener,
        },
      },
      runtime: {
        onSuspend: {
          addListener: vi.fn(),
        },
      },
    })
  })

  it('normalizes malformed session queue entries before projecting queueView', async () => {
    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized: vi.fn(async () => undefined),
      isStateManagerReady: () => true,
      getStateManager: vi.fn() as never,
      pendingDownloadsStore: {
        hydrate: vi.fn(async () => undefined),
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn(),
        snapshot: vi.fn(() => new Map()),
      },
      requestBlobRevocation: vi.fn(async () => undefined),
      tabContextCache: {
        handleTabRemoved: vi.fn(async () => undefined),
        handleTabReplaced: vi.fn(async () => undefined),
      },
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      livenessAlarmName: 'offscreen-liveness',
    })

    const storageChangeListener = storageOnChangedAddListener.mock.calls[0]?.[0] as (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName,
    ) => void

    storageChangeListener(
      {
        [SESSION_STORAGE_KEYS.globalState]: {
          oldValue: null,
          newValue: {
            downloadQueue: [
              {
                id: 'task-1',
                siteIntegrationId: 'mangadex',
                mangaId: 'series-1',
                seriesTitle: 'Series 1',
                status: 'queued',
                created: 123,
                lastSuccessfulDownloadId: 999,
                chapters: [
                  {
                    url: 'https://example.com/ch-1',
                    title: 'Chapter 1',
                    index: 1,
                    status: 'queued',
                    lastUpdated: 456,
                  },
                ],
              },
              {
                bogus: true,
              },
            ],
          },
        },
      } as unknown as Record<string, chrome.storage.StorageChange>,
      'session',
    )

    await Promise.resolve()
    await Promise.resolve()

    expect(projectionMocks.projectToQueueView).toHaveBeenCalledTimes(1)
    expect(projectionMocks.projectToQueueView).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'task-1',
        lastSuccessfulDownloadId: undefined,
        chapters: [
          expect.objectContaining({
            id: 'https://example.com/ch-1',
          }),
        ],
      }),
    ])
    expect(storageSessionSet).toHaveBeenCalledWith({ queueView: [{ id: 'projected-task' }] })
    expect(projectionMocks.updateActionBadge).toHaveBeenCalledWith(1)
  })

  it('revokes tracked blobs for terminal downloads without waiting for full state initialization', async () => {
    const ensureStateManagerInitialized = vi.fn(async () => {
      throw new Error('state init should not be needed for download cleanup')
    })
    const hydrate = vi.fn(async () => undefined)
    const get = vi.fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce('blob:tracked-download')
    const remove = vi.fn()
    const requestBlobRevocation = vi.fn(async () => undefined)

    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized,
      isStateManagerReady: () => false,
      getStateManager: vi.fn() as never,
      pendingDownloadsStore: {
        hydrate,
        get,
        set: vi.fn(),
        remove,
        clear: vi.fn(),
        snapshot: vi.fn(() => new Map()),
      },
      requestBlobRevocation,
      tabContextCache: {
        handleTabRemoved: vi.fn(async () => undefined),
        handleTabReplaced: vi.fn(async () => undefined),
      },
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      livenessAlarmName: 'offscreen-liveness',
    })

    const downloadListener = downloadsOnChangedAddListener.mock.calls[0]?.[0] as (delta: {
      id?: number
      state?: { current?: string }
    }) => void

    downloadListener({
      id: 101,
      state: { current: 'complete' },
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(ensureStateManagerInitialized).not.toHaveBeenCalled()
    expect(hydrate).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenNthCalledWith(1, 101)
    expect(get).toHaveBeenNthCalledWith(2, 101)
    expect(remove).toHaveBeenCalledWith(101)
    expect(requestBlobRevocation).toHaveBeenCalledWith('blob:tracked-download')
  })

  it('uses the in-memory pending download mapping before hydrating from session backup', async () => {
    const ensureStateManagerInitialized = vi.fn(async () => {
      throw new Error('state init should not be needed for download cleanup')
    })
    const hydrate = vi.fn(async () => undefined)
    const get = vi.fn((downloadId: number) => (downloadId === 202 ? 'blob:in-memory-download' : undefined))
    const remove = vi.fn()
    const requestBlobRevocation = vi.fn(async () => undefined)

    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized,
      isStateManagerReady: () => false,
      getStateManager: vi.fn() as never,
      pendingDownloadsStore: {
        hydrate,
        get,
        set: vi.fn(),
        remove,
        clear: vi.fn(),
        snapshot: vi.fn(() => new Map()),
      },
      requestBlobRevocation,
      tabContextCache: {
        handleTabRemoved: vi.fn(async () => undefined),
        handleTabReplaced: vi.fn(async () => undefined),
      },
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      livenessAlarmName: 'offscreen-liveness',
    })

    const downloadListener = downloadsOnChangedAddListener.mock.calls[0]?.[0] as (delta: {
      id?: number
      state?: { current?: string }
    }) => void

    downloadListener({
      id: 202,
      state: { current: 'complete' },
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(ensureStateManagerInitialized).not.toHaveBeenCalled()
    expect(hydrate).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledWith(202)
    expect(remove).toHaveBeenCalledWith(202)
    expect(requestBlobRevocation).toHaveBeenCalledWith('blob:in-memory-download')
  })
})
