import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __createChromeStorageStoreForTests } from '@/src/ui/shared/hooks/useChromeStorageValue'

describe('DownloadsTab storage subscription contract (behavior-based)', () => {
  const addListener = vi.fn()
  const removeListener = vi.fn()
  const sessionGet = vi.fn()
  let registeredListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: chrome.storage.AreaName) => void) | undefined
  let sessionStore: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    registeredListener = undefined
    sessionStore = {
      downloadQueue: [],
    }

    addListener.mockImplementation((listener: typeof registeredListener) => {
      registeredListener = listener
    })

    sessionGet.mockImplementation(async (key: string | string[]) => {
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((entry) => [entry, sessionStore[entry]]))
      }

      return { [key]: sessionStore[key] }
    })

    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: sessionGet,
        },
        local: {
          get: vi.fn(),
        },
        onChanged: {
          addListener,
          removeListener,
        },
      },
    })
  })

  it('subscribes and removes the same storage listener instance on cleanup', () => {
    const store = __createChromeStorageStoreForTests({
      areaName: 'session',
      key: 'downloadQueue',
      initialValue: [],
      parse: (raw) => (Array.isArray(raw) ? raw : []),
    })

    const unsubscribe = store.subscribe(vi.fn())

    expect(addListener).toHaveBeenCalledTimes(1)
    const listenerFn = addListener.mock.calls[0]?.[0]
    expect(typeof listenerFn).toBe('function')

    unsubscribe()

    expect(removeListener).toHaveBeenCalledTimes(1)
    expect(removeListener).toHaveBeenCalledWith(listenerFn)
  })

  it('emits updates only for the tracked storage area and keys', async () => {
    const store = __createChromeStorageStoreForTests({
      areaName: 'session',
      key: 'downloadQueue',
      initialValue: [],
      parse: (raw) => (Array.isArray(raw) ? raw : []),
    })

    const callback = vi.fn()
    const unsubscribe = store.subscribe(callback)

    await Promise.resolve()
    await Promise.resolve()
    callback.mockClear()

    expect(registeredListener).toBeTypeOf('function')

    sessionStore.downloadQueue = ['task-1']
    registeredListener?.(
      {
        downloadQueue: {
          oldValue: [],
          newValue: ['task-1'],
        },
      } as unknown as Record<string, chrome.storage.StorageChange>,
      'local',
    )
    await Promise.resolve()
    expect(callback).not.toHaveBeenCalled()

    registeredListener?.(
      {
        unrelatedKey: {
          oldValue: 'x',
          newValue: 'y',
        },
      } as unknown as Record<string, chrome.storage.StorageChange>,
      'session',
    )
    await Promise.resolve()
    expect(callback).not.toHaveBeenCalled()

    sessionStore.downloadQueue = ['task-2']
    registeredListener?.(
      {
        downloadQueue: {
          oldValue: ['task-1'],
          newValue: ['task-2'],
        },
      } as unknown as Record<string, chrome.storage.StorageChange>,
      'session',
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(callback).toHaveBeenCalled()
    expect(store.getSnapshot().value).toEqual(['task-2'])

    unsubscribe()
  })

  it('ignores stale async reads that resolve after a newer storage refresh', async () => {
    let resolveInitialRead: ((value: Record<string, unknown>) => void) | undefined
    let resolveRefreshRead: ((value: Record<string, unknown>) => void) | undefined
    let readCount = 0

    sessionGet.mockImplementation((_key: string | string[]) => {
      readCount += 1

      return new Promise<Record<string, unknown>>((resolve) => {
        if (readCount === 1) {
          resolveInitialRead = resolve
          return
        }

        resolveRefreshRead = resolve
      })
    })

    const store = __createChromeStorageStoreForTests({
      areaName: 'session',
      key: 'downloadQueue',
      initialValue: [],
      parse: (raw) => (Array.isArray(raw) ? raw : []),
    })

    const callback = vi.fn()
    const unsubscribe = store.subscribe(callback)

    await Promise.resolve()
    expect(registeredListener).toBeTypeOf('function')

    registeredListener?.(
      {
        downloadQueue: {
          oldValue: [],
          newValue: ['fresh-task'],
        },
      } as unknown as Record<string, chrome.storage.StorageChange>,
      'session',
    )

    resolveRefreshRead?.({ downloadQueue: ['fresh-task'] })
    await Promise.resolve()
    await Promise.resolve()

    expect(store.getSnapshot().value).toEqual(['fresh-task'])

    resolveInitialRead?.({ downloadQueue: [] })
    await Promise.resolve()
    await Promise.resolve()

    expect(store.getSnapshot().value).toEqual(['fresh-task'])
    expect(callback).toHaveBeenCalled()

    unsubscribe()
  })

  it('re-reads once after subscribe so immediate post-mount writes are observed without relying on storage events', async () => {
    vi.useFakeTimers()

    let resolveInitialRead: ((value: Record<string, unknown>) => void) | undefined
    let readCount = 0

    sessionGet.mockImplementation(() => {
      readCount += 1

      if (readCount === 1) {
        return new Promise<Record<string, unknown>>((resolve) => {
          resolveInitialRead = resolve
        })
      }

      return Promise.resolve({ downloadQueue: sessionStore.downloadQueue })
    })

    const store = __createChromeStorageStoreForTests({
      areaName: 'session',
      key: 'downloadQueue',
      initialValue: [],
      parse: (raw) => (Array.isArray(raw) ? raw : []),
    })

    const callback = vi.fn()
    const unsubscribe = store.subscribe(callback)

    sessionStore.downloadQueue = ['late-task']
    await vi.advanceTimersByTimeAsync(0)

    expect(store.getSnapshot().value).toEqual(['late-task'])

    resolveInitialRead?.({ downloadQueue: [] })
    await Promise.resolve()
    await Promise.resolve()

    expect(store.getSnapshot().value).toEqual(['late-task'])

    unsubscribe()
  })
})

