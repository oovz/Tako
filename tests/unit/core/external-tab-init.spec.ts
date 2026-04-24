import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearExternalTabInitialization,
  consumeRecentExternalTabInitialization,
  getExternalTabInitStorageKey,
  markExternalTabInitialization,
} from '@/src/runtime/external-tab-init'

type SessionStore = Record<string, unknown>

function createMockChromeStorage(initial: SessionStore = {}) {
  const store: SessionStore = { ...initial }

  const get = vi.fn(async (keys?: string | string[] | null) => {
    if (Array.isArray(keys)) {
      const result: SessionStore = {}
      for (const key of keys) {
        if (key in store) result[key] = store[key]
      }
      return result
    }
    if (typeof keys === 'string') {
      return keys in store ? { [keys]: store[keys] } : {}
    }
    return { ...store }
  })

  const set = vi.fn(async (items: SessionStore) => {
    Object.assign(store, items)
  })

  const remove = vi.fn(async (keys: string | string[]) => {
    const list = Array.isArray(keys) ? keys : [keys]
    for (const key of list) delete store[key]
  })

  return { store, api: { get, set, remove } }
}

describe('external-tab-init (sticky-on-fresh)', () => {
  const tabId = 42
  const storageKey = getExternalTabInitStorageKey(tabId)

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes a tabId-scoped storage key that follows the documented prefix', () => {
    expect(storageKey).toBe('externalTabInit_42')
  })

  it('markExternalTabInitialization writes a timestamp under the scoped key', async () => {
    const mock = createMockChromeStorage()
    vi.stubGlobal('chrome', { storage: { session: mock.api } })

    const fixedNow = 1_700_000_000_000
    await markExternalTabInitialization(tabId, fixedNow)

    expect(mock.store[storageKey]).toBe(fixedNow)
    expect(mock.api.set).toHaveBeenCalledWith({ [storageKey]: fixedNow })
  })

  it('consumeRecentExternalTabInitialization returns false when no mark exists', async () => {
    const mock = createMockChromeStorage()
    vi.stubGlobal('chrome', { storage: { session: mock.api } })

    const result = await consumeRecentExternalTabInitialization(tabId)

    expect(result).toBe(false)
    expect(mock.api.remove).not.toHaveBeenCalled()
  })

  it('consumeRecentExternalTabInitialization removes the key and returns false when the mark is stale', async () => {
    const mock = createMockChromeStorage({ [storageKey]: 1_000 })
    vi.stubGlobal('chrome', { storage: { session: mock.api } })

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(60_000)

    const result = await consumeRecentExternalTabInitialization(tabId, 30_000)

    expect(result).toBe(false)
    expect(mock.api.remove).toHaveBeenCalledWith(storageKey)
    expect(mock.store[storageKey]).toBeUndefined()

    nowSpy.mockRestore()
  })

  it('consumeRecentExternalTabInitialization returns true and keeps the mark sticky when fresh', async () => {
    const fixedNow = 1_700_000_000_000
    const mock = createMockChromeStorage({ [storageKey]: fixedNow - 5_000 })
    vi.stubGlobal('chrome', { storage: { session: mock.api } })

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow)

    const first = await consumeRecentExternalTabInitialization(tabId, 30_000)
    expect(first).toBe(true)
    expect(mock.api.remove).not.toHaveBeenCalled()
    expect(mock.store[storageKey]).toBe(fixedNow - 5_000)

    // Re-check: still fresh, still sticky. Without this behavior a second
    // content-script re-injection would see no mark and fire a duplicate
    // INITIALIZE_TAB that clobbers the externally-initialized state.
    const second = await consumeRecentExternalTabInitialization(tabId, 30_000)
    expect(second).toBe(true)
    expect(mock.api.remove).not.toHaveBeenCalled()
    expect(mock.store[storageKey]).toBe(fixedNow - 5_000)

    nowSpy.mockRestore()
  })

  it('cleans up non-numeric legacy values and returns false', async () => {
    const mock = createMockChromeStorage({ [storageKey]: 'not-a-number' })
    vi.stubGlobal('chrome', { storage: { session: mock.api } })

    const result = await consumeRecentExternalTabInitialization(tabId)

    expect(result).toBe(false)
    expect(mock.api.remove).toHaveBeenCalledWith(storageKey)
    expect(mock.store[storageKey]).toBeUndefined()
  })

  it('clearExternalTabInitialization removes the tab mark unconditionally', async () => {
    const mock = createMockChromeStorage({ [storageKey]: Date.now() })
    vi.stubGlobal('chrome', { storage: { session: mock.api } })

    await clearExternalTabInitialization(tabId)

    expect(mock.api.remove).toHaveBeenCalledWith(storageKey)
    expect(mock.store[storageKey]).toBeUndefined()
  })
})
