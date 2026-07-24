import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest"

import { createTabContextCache } from "@/entrypoints/background/tab-cache"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { setUserSiteIntegrationEnablement } from "@/src/site-integrations/registry"

describe("tab context cache", () => {
  const sessionStore: Record<string, unknown> = {}
  let writeSession: Mock<(values: Record<string, unknown>) => Promise<void>>
  let readSession: Mock<(keys: string[]) => Promise<Record<string, unknown>>>
  let removeSession: Mock<(keys: string | string[]) => Promise<void>>
  let queryActiveTabs: Mock<
    () => Promise<Array<{ id?: number; windowId?: number }>>
  >
  let getTab: Mock<
    (
      tabId: number
    ) => Promise<
      { id: number; url: string; windowId: number; active: boolean } | undefined
    >
  >

  beforeEach(() => {
    setUserSiteIntegrationEnablement({ mangadex: true })
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

    queryActiveTabs = vi.fn(async () => [{ id: 11, windowId: 1 }])
    getTab = vi.fn(async (tabId: number) => ({
      id: tabId,
      url: `https://mangadex.org/title/series-${tabId}`,
      windowId: 1,
      active: true,
    }))
  })

  afterEach(() => {
    setUserSiteIntegrationEnablement({})
  })

  it("writes activeTabContext from tab session state on activation", async () => {
    sessionStore.tab_11 = {
      siteIntegrationId: "mangadex",
      mangaId: "abc",
      seriesTitle: "Series",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(11)

    expect(writeSession).toHaveBeenCalledWith({
      [SESSION_STORAGE_KEYS.activeTabContext]: sessionStore.tab_11,
    })
  })

  it("uses tab-specific error when tab state is unavailable", async () => {
    sessionStore.seriesContextError_12 = "Integration parse error"

    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(12)

    expect(writeSession).toHaveBeenCalledWith({
      [SESSION_STORAGE_KEYS.activeTabContext]: {
        error: "Integration parse error",
      },
    })
  })

  it("clears activeTabContext on extension page activation", async () => {
    sessionStore[SESSION_STORAGE_KEYS.activeTabContext] = {
      siteIntegrationId: "mangadex",
      mangaId: "sticky-series",
      seriesTitle: "Sticky Series",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const getTab = vi.fn(async () => ({
      id: 50,
      url: "chrome-extension://test/sidepanel.html",
      windowId: 1,
      active: true,
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

  it("clears activeTabContext when an extension page is still pending behind about:blank", async () => {
    sessionStore[SESSION_STORAGE_KEYS.activeTabContext] = {
      siteIntegrationId: "mangadex",
      mangaId: "sticky-series",
      seriesTitle: "Sticky Series",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const getTab = vi.fn(async () => ({
      id: 51,
      url: "about:blank",
      pendingUrl: "chrome-extension://test/sidepanel.html",
      windowId: 1,
      active: true,
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

  it("does not clobber previously projected activeTabContext during a transient about:blank activation before pendingUrl resolves", async () => {
    sessionStore[SESSION_STORAGE_KEYS.activeTabContext] = {
      siteIntegrationId: "mangadex",
      mangaId: "sticky-series",
      seriesTitle: "Sticky Series",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const getTab = vi.fn(async () => ({
      id: 52,
      url: "about:blank",
      pendingUrl: undefined,
      windowId: 1,
      active: true,
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

  it("does not clobber previously projected activeTabContext when the activated tab URL is not resolved yet", async () => {
    sessionStore[SESSION_STORAGE_KEYS.activeTabContext] = {
      siteIntegrationId: "mangadex",
      mangaId: "sticky-series",
      seriesTitle: "Sticky Series",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const getTab = vi.fn(async () => ({
      id: 51,
      url: undefined,
      pendingUrl: undefined,
      windowId: 1,
      active: true,
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

  it("writes loading activeTabContext when the active tab is supported but no cached context exists", async () => {
    const getTab = vi.fn(async () => ({
      id: 14,
      url: "https://mangadex.org/title/series-14",
      windowId: 1,
      active: true,
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

  it("invalidates stale context and projects loading across a supported URL update", async () => {
    sessionStore.tab_11 = {
      siteIntegrationId: "mangadex",
      mangaId: "before",
      seriesTitle: "Before",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const getTab = vi.fn(async () => ({
      id: 11,
      url: "https://mangadex.org/title/after",
      windowId: 1,
      active: true,
    }))

    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(11)

    await cache.handleTabUpdated(11, {
      url: "https://mangadex.org/title/after",
    })

    expect(removeSession).toHaveBeenCalledWith([
      "tab_11",
      "seriesContextError_11",
      `${SESSION_STORAGE_KEYS.externalTabInitPrefix}11`,
    ])
    expect(sessionStore.tab_11).toBeUndefined()
    expect(sessionStore[SESSION_STORAGE_KEYS.activeTabContext]).toEqual({
      loading: true,
    })
  })

  it("transfers cached context on tab replacement", async () => {
    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })
    cache.setCachedContext(21, {
      siteIntegrationId: "mangadex",
      mangaId: "series-x",
      seriesTitle: "X",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    })

    queryActiveTabs.mockResolvedValueOnce([{ id: 22, windowId: 1 }])

    await cache.handleTabReplaced(22, 21)

    expect(cache.getCachedContext(21)).toBeUndefined()
    const transferred = cache.getCachedContext(22)
    expect(transferred).toBeDefined()
    expect(
      transferred && "mangaId" in transferred ? transferred.mangaId : undefined
    ).toBe("series-x")
  })

  it("allocates unique serialized revisions and rejects an older result", async () => {
    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    const [first, second] = await Promise.all([
      cache.projectLoadingForTab(11, 1),
      cache.projectLoadingForTab(11, 1),
    ])

    expect(first).toEqual({ requestId: 1 })
    expect(second).toEqual({ requestId: 2 })
    expect(await cache.isRequestIdCurrent(1, 1)).toBe(false)
    expect(await cache.isRequestIdCurrent(1, 2)).toBe(true)

    await expect(
      cache.syncActiveTabContext(
        11,
        { error: "stale result" },
        {
          requestId: 1,
          windowId: 1,
        }
      )
    ).resolves.toBe(false)
    await expect(
      cache.syncActiveTabContext(
        11,
        { error: "current result" },
        {
          requestId: 2,
          windowId: 1,
        }
      )
    ).resolves.toBe(true)

    expect(sessionStore[SESSION_STORAGE_KEYS.activeTabContext]).toEqual({
      error: "current result",
    })
  })

  it("supersedes an in-flight resolver when an external context arrives", async () => {
    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    const loading = await cache.projectLoadingForTab(11, 1)
    expect(loading).toEqual({ requestId: 1 })

    await expect(
      cache.syncActiveTabContext(
        11,
        { error: "external context" },
        { windowId: 1, supersedeInFlight: true }
      )
    ).resolves.toBe(true)

    expect(await cache.isRequestIdCurrent(1, 1)).toBe(false)
    expect(sessionStore[SESSION_STORAGE_KEYS.activeTabContext]).toEqual({
      error: "external context",
    })

    await expect(
      cache.syncActiveTabContext(
        11,
        { error: "stale resolver result" },
        { requestId: 1, windowId: 1 }
      )
    ).resolves.toBe(false)
    expect(sessionStore[SESSION_STORAGE_KEYS.activeTabContext]).toEqual({
      error: "external context",
    })
  })

  it("preserves concurrent projections for different windows", async () => {
    const cache = createTabContextCache({
      readSession,
      removeSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await Promise.all([
      cache.projectLoadingForTab(11, 1),
      cache.projectLoadingForTab(22, 2),
    ])

    expect(
      sessionStore[SESSION_STORAGE_KEYS.activeTabContextByWindow]
    ).toMatchObject({
      1: { windowId: 1, activeTabId: 11, revision: 1 },
      2: { windowId: 2, activeTabId: 22, revision: 1 },
    })
  })
})
