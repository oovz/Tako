import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTabContextCache } from '@/entrypoints/background/tab-cache'
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'

describe('tab context cache', () => {
  const sessionStore: Record<string, unknown> = {}
  let writeSession: ReturnType<typeof vi.fn>
  let readSession: ReturnType<typeof vi.fn>
  let removeSession: ReturnType<typeof vi.fn>
  let queryActiveTabs: ReturnType<typeof vi.fn>

  beforeEach(() => {
    Object.keys(sessionStore).forEach((key) => delete sessionStore[key])

    writeSession = vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(sessionStore, values)
    })

    readSession = vi.fn(async (keys: string[]) => {
      const result: Record<string, unknown> = {}
      keys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(sessionStore, key)) {
          result[key] = sessionStore[key]
        }
      })
      return result
    })

    removeSession = vi.fn(async (keys: string | string[]) => {
      const normalizedKeys = Array.isArray(keys) ? keys : [keys]
      normalizedKeys.forEach((key) => {
        delete sessionStore[key]
      })
    })

    queryActiveTabs = vi.fn(async () => [{ id: 11 }])
  })

  it('writes activeTabContext from tab session state on activation', async () => {
    sessionStore.tab_11 = {
      siteIntegrationId: 'mangadex',
      mangaId: 'abc',
      seriesTitle: 'Series',
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const cache = createTabContextCache({ readSession, removeSession, writeSession, queryActiveTabs })

    await cache.handleTabActivated(11)

    expect(writeSession).toHaveBeenCalledWith({
      [SESSION_STORAGE_KEYS.activeTabContext]: sessionStore.tab_11,
    })
  })

  it('uses tab-specific error when tab state is unavailable', async () => {
    sessionStore.seriesContextError_12 = 'Integration parse error'

    const cache = createTabContextCache({ readSession, removeSession, writeSession, queryActiveTabs })

    await cache.handleTabActivated(12)

    expect(writeSession).toHaveBeenCalledWith({
      [SESSION_STORAGE_KEYS.activeTabContext]: { error: 'Integration parse error' },
    })
  })

  it('clears activeTabContext on extension page activation', async () => {
    sessionStore[SESSION_STORAGE_KEYS.activeTabContext] = {
      siteIntegrationId: 'mangadex',
      mangaId: 'sticky-series',
      seriesTitle: 'Sticky Series',
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const getTab = vi.fn(async () => ({
      id: 50,
      url: 'chrome-extension://test/sidepanel.html',
    }))

    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(50)

    expect(writeSession).toHaveBeenCalledWith({
      [SESSION_STORAGE_KEYS.activeTabContext]: null,
    })
  })

  it('clears activeTabContext when an extension page is still pending behind about:blank', async () => {
    sessionStore[SESSION_STORAGE_KEYS.activeTabContext] = {
      siteIntegrationId: 'mangadex',
      mangaId: 'sticky-series',
      seriesTitle: 'Sticky Series',
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const getTab = vi.fn(async () => ({
      id: 51,
      url: 'about:blank',
      pendingUrl: 'chrome-extension://test/sidepanel.html',
    }))

    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(51)

    expect(writeSession).toHaveBeenCalledWith({
      [SESSION_STORAGE_KEYS.activeTabContext]: null,
    })
  })

  it('does not clobber previously projected activeTabContext during a transient about:blank activation before pendingUrl resolves', async () => {
    sessionStore[SESSION_STORAGE_KEYS.activeTabContext] = {
      siteIntegrationId: 'mangadex',
      mangaId: 'sticky-series',
      seriesTitle: 'Sticky Series',
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const getTab = vi.fn(async () => ({
      id: 52,
      url: 'about:blank',
      pendingUrl: undefined,
    }))

    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(52)

    expect(writeSession).not.toHaveBeenCalled()
  })

  it('does not clobber previously projected activeTabContext when the activated tab URL is not resolved yet', async () => {
    sessionStore[SESSION_STORAGE_KEYS.activeTabContext] = {
      siteIntegrationId: 'mangadex',
      mangaId: 'sticky-series',
      seriesTitle: 'Sticky Series',
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const getTab = vi.fn(async () => ({
      id: 51,
      url: undefined,
      pendingUrl: undefined,
    }))

    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(51)

    expect(writeSession).not.toHaveBeenCalled()
  })

  it('writes loading activeTabContext when the active tab is supported but no cached context exists', async () => {
    const getTab = vi.fn(async () => ({
      id: 14,
      url: 'https://mangadex.org/title/series-14',
    }))

    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(14)

    expect(writeSession).toHaveBeenCalledWith({
      [SESSION_STORAGE_KEYS.activeTabContext]: { loading: true },
    })
  })

  it('clears stale tab state on URL update and syncs active tab context to loading', async () => {
    sessionStore.tab_11 = {
      siteIntegrationId: 'mangadex',
      mangaId: 'before',
      seriesTitle: 'Before',
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const getTab = vi.fn(async () => ({
      id: 11,
      url: 'https://mangadex.org/title/after',
    }))

    const cache = createTabContextCache({ readSession, removeSession, writeSession, queryActiveTabs, getTab })

    await cache.handleTabActivated(11)

    sessionStore.tab_11 = {
      siteIntegrationId: 'mangadex',
      mangaId: 'after',
      seriesTitle: 'After',
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    await cache.handleTabUpdated(11, { url: 'https://mangadex.org/title/after' })

    const lastCall = writeSession.mock.calls[writeSession.mock.calls.length - 1]?.[0]
    expect(removeSession).toHaveBeenCalledWith(['tab_11', 'seriesContextError_11'])
    expect(sessionStore.tab_11).toBeUndefined()
    expect(lastCall).toEqual({ [SESSION_STORAGE_KEYS.activeTabContext]: { loading: true } })
  })

  it('transfers cached context on tab replacement', async () => {
    const cache = createTabContextCache({ readSession, removeSession, writeSession, queryActiveTabs })
    cache.setCachedContext(21, {
      siteIntegrationId: 'mangadex',
      mangaId: 'series-x',
      seriesTitle: 'X',
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    })

    queryActiveTabs.mockResolvedValueOnce([{ id: 22 }])

    await cache.handleTabReplaced(22, 21)

    expect(cache.getCachedContext(21)).toBeUndefined()
    expect(cache.getCachedContext(22)).toBeTruthy()
  })
})

