import { beforeEach, describe, expect, it, vi } from 'vitest'
 
import { createPendingDownloadsStore } from '@/entrypoints/background/pending-downloads'
import { IPC_THROTTLE_MS } from '@/src/constants/timeouts'
 
type SessionStore = Record<string, unknown>
let sessionStore: SessionStore = {}

function installChromeStorageMock() {
  const chromeMock = {
    storage: {
      session: {
        get: vi.fn(async (key: string) => {
          return { [key]: sessionStore[key] }
        }),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(sessionStore, value)
        }),
      },
    },
  } as unknown as typeof chrome

  vi.stubGlobal('chrome', chromeMock)
}

describe('pendingDownloads store', () => {
  beforeEach(() => {
    vi.useRealTimers()
    sessionStore = {}
    installChromeStorageMock()
  })

  it('writes pending downloads to session storage after debounce window', async () => {
    vi.useFakeTimers()
    const store = createPendingDownloadsStore()

    store.set(101, 'blob:one')
    store.set(202, 'blob:two')

    await Promise.resolve()
    expect(sessionStore.pendingDownloads).toBeUndefined()

    await vi.advanceTimersByTimeAsync(IPC_THROTTLE_MS)

    expect(sessionStore.pendingDownloads).toEqual({
      '101': 'blob:one',
      '202': 'blob:two',
    })
  })

  it('removes IDs and persists updated map after debounce window', async () => {
    vi.useFakeTimers()
    const store = createPendingDownloadsStore()

    store.set(101, 'blob:one')
    store.set(202, 'blob:two')
    store.remove(101)

    await Promise.resolve()
    expect(sessionStore.pendingDownloads).toBeUndefined()

    await vi.advanceTimersByTimeAsync(IPC_THROTTLE_MS)

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
})

