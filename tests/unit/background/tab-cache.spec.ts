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
import { setEnablementMap as setUserSiteIntegrationEnablement } from "@/src/site-integrations/catalog"

describe("tab context cache", () => {
  const sessionStore: Record<string, unknown> = {}

  function getProjectedContext(windowId = 1): unknown {
    return (
      sessionStore[SESSION_STORAGE_KEYS.activeTabContextByWindow] as
        Record<number, { context: unknown }> | undefined
    )?.[windowId]?.context
  }

  function seedWindowContext(
    activeTabId: number,
    context: unknown,
    windowId = 1,
    revision = 1
  ): void {
    sessionStore[SESSION_STORAGE_KEYS.activeTabContextByWindow] = {
      [windowId]: {
        windowId,
        activeTabId,
        context,
        revision,
        timestamp: 1,
      },
    }
  }
  let writeSession: Mock<(values: Record<string, unknown>) => Promise<void>>
  let readSession: Mock<(keys: string[]) => Promise<Record<string, unknown>>>
  let queryActiveTabs: Mock<
    () => Promise<Array<{ id?: number; windowId?: number }>>
  >
  let getTab: Mock<
    (tabId: number) => Promise<
      | {
          id: number
          url: string
          pendingUrl?: string
          windowId: number
          active: boolean
        }
      | undefined
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

  it("writes the per-window context from tab session state on activation", async () => {
    sessionStore.tab_11 = {
      sourceUrl: "https://mangadex.org/title/series-11",
      siteIntegrationId: "mangadex",
      mangaId: "abc",
      seriesTitle: "Series",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(11)

    expect(getProjectedContext()).toEqual(sessionStore.tab_11)
    expect(writeSession).toHaveBeenCalledTimes(1)
  })

  it("uses tab-specific error when tab state is unavailable", async () => {
    queryActiveTabs.mockResolvedValue([{ id: 12, windowId: 1 }])
    sessionStore.seriesContextError_12 = "Integration parse error"

    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(12)

    expect(getProjectedContext()).toEqual({ error: "Integration parse error" })
    expect(writeSession).toHaveBeenCalledTimes(1)
  })

  it("clears the per-window context on extension page activation", async () => {
    queryActiveTabs.mockResolvedValue([{ id: 50, windowId: 1 }])
    seedWindowContext(49, {
      sourceUrl: "https://mangadex.org/title/sticky-series",
      siteIntegrationId: "mangadex",
      mangaId: "sticky-series",
      seriesTitle: "Sticky Series",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    })

    const getTab = vi.fn(async () => ({
      id: 50,
      url: "chrome-extension://test/sidepanel.html",
      windowId: 1,
      active: true,
    }))

    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(50)

    expect(getProjectedContext()).toBeNull()
    expect(writeSession).toHaveBeenCalledTimes(1)
  })

  it("clears the per-window context when an extension page is still pending behind about:blank", async () => {
    queryActiveTabs.mockResolvedValue([{ id: 51, windowId: 1 }])
    seedWindowContext(50, {
      sourceUrl: "https://mangadex.org/title/sticky-series",
      siteIntegrationId: "mangadex",
      mangaId: "sticky-series",
      seriesTitle: "Sticky Series",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    })

    const getTab = vi.fn(async () => ({
      id: 51,
      url: "about:blank",
      pendingUrl: "chrome-extension://test/sidepanel.html",
      windowId: 1,
      active: true,
    }))

    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(51)

    expect(getProjectedContext()).toBeNull()
    expect(writeSession).toHaveBeenCalledTimes(1)
  })

  it("does not clobber the window projection during a transient about:blank activation before pendingUrl resolves", async () => {
    seedWindowContext(52, {
      sourceUrl: "https://mangadex.org/title/sticky-series",
      siteIntegrationId: "mangadex",
      mangaId: "sticky-series",
      seriesTitle: "Sticky Series",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    })

    const getTab = vi.fn(async () => ({
      id: 52,
      url: "about:blank",
      pendingUrl: undefined,
      windowId: 1,
      active: true,
    }))

    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(52)

    expect(writeSession).not.toHaveBeenCalled()
  })

  it("does not clobber the window projection when the activated tab URL is not resolved yet", async () => {
    seedWindowContext(51, {
      sourceUrl: "https://mangadex.org/title/sticky-series",
      siteIntegrationId: "mangadex",
      mangaId: "sticky-series",
      seriesTitle: "Sticky Series",
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    })

    const getTab = vi.fn(async () => ({
      id: 51,
      url: undefined,
      pendingUrl: undefined,
      windowId: 1,
      active: true,
    }))

    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(51)

    expect(writeSession).not.toHaveBeenCalled()
  })

  it("writes a loading per-window context when the active tab is supported but no cached context exists", async () => {
    queryActiveTabs.mockResolvedValue([{ id: 14, windowId: 1 }])
    const getTab = vi.fn(async () => ({
      id: 14,
      url: "https://mangadex.org/title/series-14",
      windowId: 1,
      active: true,
    }))

    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(14)

    expect(getProjectedContext()).toEqual({ loading: true })
    expect(writeSession).toHaveBeenCalledTimes(1)
  })

  it("invalidates stale context and projects loading across a supported URL update", async () => {
    sessionStore.tab_11 = {
      sourceUrl: "https://mangadex.org/title/after",
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
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.handleTabActivated(11)

    await cache.handleTabUpdated(11, {
      url: "https://mangadex.org/title/after",
    })

    // Durable tab/error state is cleared by TabContextStateService; the cache
    // only reprojects the current session snapshot and must not remove keys.
    expect(sessionStore.tab_11).toBeDefined()
    expect(getProjectedContext()).toEqual(sessionStore.tab_11)
  })

  it("transfers cached context on tab replacement", async () => {
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })
    cache.setCachedContext(21, {
      sourceUrl: "https://mangadex.org/title/series-21",
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

  it("shares one serialized revision across duplicate loading projections", async () => {
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    const [first, second] = await Promise.all([
      cache.projectLoadingForTab(11, 1),
      cache.projectLoadingForTab(11, 1),
    ])

    expect(first).toEqual({ requestId: 1 })
    expect(second).toEqual({ requestId: 1 })
    expect(await cache.isRequestIdCurrent(1, 1)).toBe(true)

    await expect(
      cache.syncActiveTabContext(
        11,
        { error: "shared owner result" },
        {
          requestId: 1,
          windowId: 1,
        }
      )
    ).resolves.toBe(true)

    expect(getProjectedContext()).toEqual({ error: "shared owner result" })
  })

  it("advances the revision when a new resolver explicitly supersedes a loading owner", async () => {
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    const first = await cache.projectLoadingForTab(11, 1)
    const replacement = await cache.projectLoadingForTab(11, 1, true)

    expect(first).toEqual({ requestId: 1 })
    expect(replacement).toEqual({ requestId: 2 })
    await expect(cache.isRequestIdCurrent(1, 1)).resolves.toBe(false)
    await expect(cache.isRequestIdCurrent(1, 2)).resolves.toBe(true)
  })

  it("does not publish a superseded owner paused inside its mutation", async () => {
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })
    const loading = await cache.projectLoadingForTab(11, 1)
    if (!loading) throw new Error("Expected a loading projection")
    const owner = new AbortController()
    let releaseMutation: (() => void) | undefined
    const mutationPaused = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })

    const staleCommit = cache.commitTabContextMutation(
      11,
      {
        requestId: loading.requestId,
        windowId: 1,
        ownerSignal: owner.signal,
      },
      async () => {
        await mutationPaused
        return { error: "superseded owner" }
      }
    )
    await vi.waitFor(() => expect(readSession).toHaveBeenCalled())
    owner.abort("superseded")
    const replacement = cache.projectLoadingForTab(11, 1, true)
    releaseMutation?.()

    await expect(staleCommit).resolves.toBe(false)
    await expect(replacement).resolves.toEqual({ requestId: 2 })
    expect(getProjectedContext()).toEqual({ loading: true })
  })

  it("does not let an inactive tab claim a newer loading revision", async () => {
    queryActiveTabs.mockResolvedValue([{ id: 22, windowId: 1 }])
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(cache.projectLoadingForTab(11, 1)).resolves.toBeUndefined()
    expect(
      sessionStore[SESSION_STORAGE_KEYS.activeTabContextByWindow]
    ).toBeUndefined()
  })

  it("does not authorize a series projection after its tab becomes inactive", async () => {
    const state = {
      sourceUrl: "https://mangadex.org/title/series-11",
      siteIntegrationId: "mangadex",
      mangaId: "series-11",
      seriesTitle: "Series 11",
      chapters: [],
      volumes: [],
      lastUpdated: 1,
    }
    sessionStore.tab_11 = state
    sessionStore[SESSION_STORAGE_KEYS.activeTabContextByWindow] = {
      1: {
        windowId: 1,
        activeTabId: 11,
        context: state,
        revision: 7,
        timestamp: 1,
      },
    }
    getTab.mockResolvedValue({
      id: 11,
      url: "https://mangadex.org/title/series-11",
      windowId: 1,
      active: false,
    })
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(cache.getCurrentSeriesContext(11, 1)).resolves.toBeUndefined()
  })

  it("returns the revision-bearing window snapshot instead of mixing tab storage", async () => {
    const sourceUrl = "https://mangadex.org/title/series-11"
    const projectedState = {
      sourceUrl,
      siteIntegrationId: "mangadex",
      mangaId: "projected-series",
      seriesTitle: "Projected Series",
      chapters: [],
      volumes: [],
      lastUpdated: 1,
    }
    sessionStore.tab_11 = {
      ...projectedState,
      mangaId: "newer-unprojected-series",
    }
    sessionStore[SESSION_STORAGE_KEYS.activeTabContextByWindow] = {
      1: {
        windowId: 1,
        activeTabId: 11,
        context: projectedState,
        revision: 7,
        timestamp: 1,
      },
    }
    getTab.mockResolvedValue({
      id: 11,
      url: sourceUrl,
      windowId: 1,
      active: true,
    })
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(cache.getCurrentSeriesContext(11, 1)).resolves.toEqual({
      context: projectedState,
      revision: 7,
      windowId: 1,
    })
  })

  it("treats a missing per-window projection as no download authority", async () => {
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(cache.getCurrentSeriesContext(11, 1)).resolves.toBeUndefined()
  })

  it("treats a malformed projection as no authority and replaces it with loading", async () => {
    sessionStore[SESSION_STORAGE_KEYS.activeTabContextByWindow] = {
      1: {
        windowId: 1,
        activeTabId: 11,
        revision: 7,
        timestamp: 1,
        context: { loading: true },
        unexpected: true,
      },
    }
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(cache.getCurrentSeriesContext(11, 1)).resolves.toBeUndefined()
    await expect(cache.projectLoadingForTab(11, 1)).resolves.toEqual({
      requestId: 1,
    })
    expect(getProjectedContext()).toEqual({ loading: true })
  })

  it("hydrates exact authority from the per-window projection after a cache restart", async () => {
    const sourceUrl = "https://mangadex.org/title/series-11"
    const projectedState = {
      sourceUrl,
      siteIntegrationId: "mangadex",
      mangaId: "series-11",
      seriesTitle: "Series 11",
      chapters: [],
      volumes: [],
      lastUpdated: 1,
    }
    seedWindowContext(11, projectedState, 1, 8)
    getTab.mockResolvedValue({
      id: 11,
      url: sourceUrl,
      windowId: 1,
      active: true,
    })

    const restartedCache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(
      restartedCache.getCurrentSeriesContext(11, 1)
    ).resolves.toEqual({
      context: projectedState,
      revision: 8,
      windowId: 1,
    })
  })

  it("does not authorize a projection owned by another window", async () => {
    seedWindowContext(
      11,
      {
        sourceUrl: "https://mangadex.org/title/series-11",
        siteIntegrationId: "mangadex",
        mangaId: "series-11",
        seriesTitle: "Series 11",
        chapters: [],
        volumes: [],
        lastUpdated: 1,
      },
      2,
      7
    )
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(cache.getCurrentSeriesContext(11, 1)).resolves.toBeUndefined()
  })

  it("does not authorize the committed URL while a different navigation is pending", async () => {
    const sourceUrl = "https://mangadex.org/title/series-11"
    seedWindowContext(
      11,
      {
        sourceUrl,
        siteIntegrationId: "mangadex",
        mangaId: "series-11",
        seriesTitle: "Series 11",
        chapters: [],
        volumes: [],
        lastUpdated: 1,
      },
      1,
      7
    )
    getTab.mockResolvedValue({
      id: 11,
      url: sourceUrl,
      pendingUrl: "https://mangadex.org/title/series-12",
      windowId: 1,
      active: true,
    })
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(cache.getCurrentSeriesContext(11, 1)).resolves.toBeUndefined()
  })

  it("does not authorize a same-URL pending reload", async () => {
    const sourceUrl = "https://mangadex.org/title/series-11"
    seedWindowContext(
      11,
      {
        sourceUrl,
        siteIntegrationId: "mangadex",
        mangaId: "series-11",
        seriesTitle: "Series 11",
        chapters: [],
        volumes: [],
        lastUpdated: 1,
      },
      1,
      7
    )
    getTab.mockResolvedValue({
      id: 11,
      url: sourceUrl,
      pendingUrl: sourceUrl,
      windowId: 1,
      active: true,
    })
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(cache.getCurrentSeriesContext(11, 1)).resolves.toBeUndefined()
  })

  it("does not authorize a projection whose provider does not own the current URL", async () => {
    const sourceUrl = "https://mangadex.org/title/series-11"
    seedWindowContext(
      11,
      {
        sourceUrl,
        siteIntegrationId: "pixiv-comic",
        mangaId: "series-11",
        seriesTitle: "Series 11",
        chapters: [],
        volumes: [],
        lastUpdated: 1,
      },
      1,
      7
    )
    getTab.mockResolvedValue({
      id: 11,
      url: sourceUrl,
      windowId: 1,
      active: true,
    })
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(cache.getCurrentSeriesContext(11, 1)).resolves.toBeUndefined()
  })

  it("rejects a projected series snapshot after the tab URL changes", async () => {
    const state = {
      sourceUrl: "https://mangadex.org/title/series-11",
      siteIntegrationId: "mangadex",
      mangaId: "series-11",
      seriesTitle: "Series 11",
      chapters: [],
      volumes: [],
      lastUpdated: 1,
    }
    sessionStore[SESSION_STORAGE_KEYS.activeTabContextByWindow] = {
      1: {
        windowId: 1,
        activeTabId: 11,
        context: state,
        revision: 7,
        timestamp: 1,
      },
    }
    getTab.mockResolvedValue({
      id: 11,
      url: "https://mangadex.org/title/series-12",
      windowId: 1,
      active: true,
    })
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(cache.getCurrentSeriesContext(11, 1)).resolves.toBeUndefined()
  })

  it("rejects a stale URL-bound mutation before it changes storage", async () => {
    getTab.mockResolvedValue({
      id: 11,
      url: "https://mangadex.org/title/new-series",
      windowId: 1,
      active: true,
    })
    const mutation = vi.fn(async () => null)
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await expect(
      cache.commitTabContextMutation(
        11,
        {
          windowId: 1,
          expectedUrl: "https://mangadex.org/title/old-series",
        },
        mutation
      )
    ).resolves.toBe(false)
    expect(mutation).not.toHaveBeenCalled()
  })

  it("does not commit a projection from a stale active-tab snapshot", async () => {
    queryActiveTabs
      .mockResolvedValueOnce([{ id: 11, windowId: 1 }])
      .mockResolvedValue([{ id: 22, windowId: 1 }])
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    await cache.syncActiveTabContext()

    expect(
      sessionStore[SESSION_STORAGE_KEYS.activeTabContextByWindow]
    ).toBeUndefined()
  })

  it("does not supersede an in-flight loading revision when the tab completes", async () => {
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })

    const loading = await cache.projectLoadingForTab(11, 1)
    expect(loading).toEqual({ requestId: 1 })

    await cache.handleTabUpdated(11, { status: "complete" })

    await expect(cache.isRequestIdCurrent(1, 1)).resolves.toBe(true)
  })

  it("supersedes an in-flight resolver when an external context arrives", async () => {
    const cache = createTabContextCache({
      readSession,
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
    expect(getProjectedContext()).toEqual({ error: "external context" })

    await expect(
      cache.syncActiveTabContext(
        11,
        { error: "stale resolver result" },
        { requestId: 1, windowId: 1 }
      )
    ).resolves.toBe(false)
    expect(getProjectedContext()).toEqual({ error: "external context" })
  })

  it("persists an authoritative inactive tab without replacing the active projection", async () => {
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })
    await cache.projectLoadingForTab(11, 1)
    const inactiveState = {
      sourceUrl: "https://mangadex.org/title/inactive-series",
      siteIntegrationId: "mangadex",
      mangaId: "inactive-series",
      seriesTitle: "Inactive Series",
      chapters: [],
      volumes: [],
      lastUpdated: 1,
    }

    await expect(
      cache.commitTabContextMutation(
        22,
        { windowId: 1, supersedeInFlight: true },
        async () => {
          sessionStore.tab_22 = inactiveState
          return inactiveState
        }
      )
    ).resolves.toBe(true)

    expect(sessionStore.tab_22).toEqual(inactiveState)
    expect(
      sessionStore[SESSION_STORAGE_KEYS.activeTabContextByWindow]
    ).toMatchObject({
      1: { activeTabId: 11, context: { loading: true }, revision: 1 },
    })
  })

  it("does not remove durable state during cache-only navigation projection", async () => {
    const cache = createTabContextCache({
      readSession,
      writeSession,
      queryActiveTabs,
      getTab,
    })
    const loading = await cache.projectLoadingForTab(11, 1)
    if (!loading) throw new Error("Expected a loading projection")
    let releaseMutation: (() => void) | undefined
    const mutationPaused = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })

    const staleCommit = cache.commitTabContextMutation(
      11,
      { windowId: 1, requestId: loading.requestId },
      async () => {
        await mutationPaused
        const staleState = {
          sourceUrl: "https://mangadex.org/title/old-series",
          siteIntegrationId: "mangadex",
          mangaId: "old-series",
          seriesTitle: "Old Series",
          chapters: [],
          volumes: [],
          lastUpdated: 1,
        }
        sessionStore.tab_11 = staleState
        return staleState
      }
    )
    const navigation = cache.handleTabUpdated(11, {
      url: "https://mangadex.org/title/new-series",
    })

    releaseMutation?.()
    await staleCommit
    await navigation

    expect(sessionStore.tab_11).toBeDefined()
  })

  it("preserves concurrent projections for different windows", async () => {
    queryActiveTabs.mockResolvedValue([
      { id: 11, windowId: 1 },
      { id: 22, windowId: 2 },
    ])
    const cache = createTabContextCache({
      readSession,
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
