import { beforeEach, describe, expect, it, vi } from 'vitest'
 
import { createPendingDownloadsStore } from '@/entrypoints/background/pending-downloads'
 
type SessionStore = Record<string, unknown>
let sessionStore: SessionStore = {}
const storageGet = vi.fn()
const storageSet = vi.fn()

async function flushPersistenceChain(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve()
  }
}

async function waitForStorageSetCalls(expectedCalls: number): Promise<void> {
  for (let i = 0; i < 20 && storageSet.mock.calls.length < expectedCalls; i += 1) {
    await flushPersistenceChain()
  }
}

function installChromeStorageMock() {
  const chromeMock = {
    storage: {
      session: {
        get: storageGet,
        set: storageSet,
      },
    },
  } as unknown as typeof chrome

  storageGet.mockImplementation(async (key: string) => {
          return { [key]: sessionStore[key] }
  })
  storageSet.mockImplementation(async (value: Record<string, unknown>) => {
    Object.assign(sessionStore, value)
  })

  vi.stubGlobal('chrome', chromeMock)
}

describe('pendingDownloads store', () => {
  beforeEach(() => {
    storageGet.mockReset()
    storageSet.mockReset()
    sessionStore = {}
    installChromeStorageMock()
  })

  it('writes pending downloads to session storage immediately', async () => {
    const store = createPendingDownloadsStore()

    store.set(101, 'blob:one')
    store.set(202, 'blob:two')

    await waitForStorageSetCalls(2)

    expect(sessionStore.pendingDownloads).toEqual({
      '101': 'blob:one',
      '202': 'blob:two',
    })
  })

  it('removes IDs and persists the updated map immediately', async () => {
    const store = createPendingDownloadsStore()

    store.set(101, 'blob:one')
    store.set(202, 'blob:two')
    store.remove(101)

    await waitForStorageSetCalls(3)

    expect(sessionStore.pendingDownloads).toEqual({
      '202': 'blob:two',
    })
    expect(store.get(101)).toBeUndefined()
    expect(store.get(202)).toBe('blob:two')
  })

  it('hydrates in-memory cache from session backup', async () => {
    sessionStore.pendingDownloads = {
      '900': 'blob:nine',
    }

    const store = createPendingDownloadsStore()

    await store.hydrate()

    expect(store.get(900)).toBe('blob:nine')
  })

  it('replaces stale in-memory entries when hydrating from the current session snapshot', async () => {
    const store = createPendingDownloadsStore()

    store.set(101, 'blob:stale')
    await waitForStorageSetCalls(1)

    sessionStore.pendingDownloads = {
      '202': 'blob:fresh',
    }

    await store.hydrate()

    expect(store.get(101)).toBeUndefined()
    expect(store.get(202)).toBe('blob:fresh')
  })

  it('serializes session persistence writes in mutation order', async () => {
    const pendingWrites: Array<() => void> = []
    storageSet.mockImplementation((value: Record<string, unknown>) => {
      return new Promise<void>((resolve) => {
        pendingWrites.push(() => {
          Object.assign(sessionStore, value)
          resolve()
        })
      })
    })

    const store = createPendingDownloadsStore()

    store.set(101, 'blob:one')
    store.set(202, 'blob:two')

    await flushPersistenceChain()

    expect(storageSet).toHaveBeenCalledTimes(1)
    expect(storageSet.mock.calls[0]?.[0]).toEqual({
      pendingDownloads: {
        '101': 'blob:one',
      },
    })

    pendingWrites.shift()?.()
    await flushPersistenceChain()

    expect(storageSet).toHaveBeenCalledTimes(2)
    expect(storageSet.mock.calls[1]?.[0]).toEqual({
      pendingDownloads: {
        '101': 'blob:one',
        '202': 'blob:two',
      },
    })

    pendingWrites.shift()?.()
    await flushPersistenceChain()

    expect(sessionStore.pendingDownloads).toEqual({
      '101': 'blob:one',
      '202': 'blob:two',
    })
  })
})

