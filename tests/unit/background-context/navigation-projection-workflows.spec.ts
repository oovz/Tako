import { setImmediate as nextTurn } from "node:timers/promises"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  reconcileIntegrationSupportAfterPermissionRemoval,
  registerBackgroundNavigationListeners,
} from "@/entrypoints/background/background-navigation-listeners"
import { createBackgroundTabContextMessageHandlers } from "@/entrypoints/background/background-tab-context-message-handlers"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import { createTabContextCache } from "@/entrypoints/background/tab-cache"
import { createTabContextResolver } from "@/entrypoints/background/tab-context-resolver"
import { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import { createTabUiCoordinator } from "@/entrypoints/background/tab-ui-coordinator"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { parseActiveTabContextByWindow } from "@/src/runtime/tab-state-schemas"
import { setEnablementMap } from "@/src/site-integrations/catalog"

const seriesUrl = (id: number) => `https://comic.pixiv.net/works/${id}`
const unsupportedUrl = "https://example.com/other"

function browserEvent<Args extends unknown[]>() {
  const listeners: Array<(...args: Args) => void> = []
  return {
    addListener: (listener: (...args: Args) => void) =>
      listeners.push(listener),
    fire: (...args: Args) => listeners.forEach((listener) => listener(...args)),
  }
}

function browserTab(
  id: number,
  windowId = 1,
  url: string | undefined = seriesUrl(id),
  active = true
): chrome.tabs.Tab {
  return {
    id,
    windowId,
    url,
    active,
    index: 0,
    lastAccessed: 0,
    pinned: false,
    highlighted: active,
    incognito: false,
    selected: active,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    groupId: -1,
  }
}

function navigationHarness(retainedSession: Record<string, unknown> = {}) {
  const tabs = new Map<number, chrome.tabs.Tab>()
  const session = structuredClone(retainedSession)
  const icons = new Map<number, chrome.action.TabIconDetails["path"]>()
  const updated =
    browserEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>()
  const activated = browserEvent<[chrome.tabs.OnActivatedInfo]>()
  type Navigation = { tabId: number; frameId: number; url: string }
  const domReady = browserEvent<[Navigation]>()
  const history = browserEvent<[Navigation]>()
  const committed = browserEvent<[Navigation]>()
  const readGates: Array<{
    predicate: (keys: string[]) => boolean
    used: boolean
    entered: ReturnType<typeof Promise.withResolvers<void>>
    release: ReturnType<typeof Promise.withResolvers<void>>
  }> = []
  const fetchGates: Array<{
    predicate: (url: string) => boolean
    entered: ReturnType<typeof Promise.withResolvers<void>>
    release: ReturnType<typeof Promise.withResolvers<void>>
  }> = []
  const names = new Map<number, string>()
  const getTab = vi.fn(async (id: number) => {
    const tab = tabs.get(id)
    if (!tab) throw new Error("Tab no longer exists")
    return structuredClone(tab)
  })
  const queryTabs = vi.fn(async (query: chrome.tabs.QueryInfo) =>
    [...tabs.values()]
      .filter(
        (tab) => query.active === undefined || tab.active === query.active
      )
      .map((tab) => structuredClone(tab))
  )
  const sessionGet = vi.fn(async (keys: string | string[]) => {
    const requested = typeof keys === "string" ? [keys] : keys
    const snapshot = Object.fromEntries(
      requested.map((key) => [key, structuredClone(session[key])])
    )
    const gate = readGates.find(
      (gate) => !gate.used && gate.predicate(requested)
    )
    if (gate) {
      gate.used = true
      gate.entered.resolve()
      await gate.release.promise
    }
    return snapshot
  })
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const gate = fetchGates.find((gate) => gate.predicate(url))
    if (gate) {
      gate.entered.resolve()
      await gate.release.promise
    }
    if (init?.signal?.aborted)
      throw new DOMException("Request aborted", "AbortError")
    const work = /\/api\/app\/works\/v5\/(\d+)$/.exec(new URL(url).pathname)
    const episodes = /\/api\/app\/works\/(\d+)\/episodes\/v2$/.exec(
      new URL(url).pathname
    )
    if (!work && !episodes)
      throw new Error(`Unexpected provider endpoint: ${url}`)
    const payload = work
      ? {
          data: {
            official_work: {
              name: names.get(Number(work[1])) ?? `Series ${work[1]}`,
            },
          },
        }
      : { data: { episodes: [] } }
    const response = Response.json(payload)
    Object.defineProperty(response, "url", { value: url })
    return response
  })
  vi.stubGlobal("fetch", fetch)
  vi.stubGlobal("chrome", {
    ...chrome,
    tabs: {
      get: getTab,
      query: queryTabs,
      onUpdated: updated,
      onActivated: activated,
    },
    webNavigation: {
      onDOMContentLoaded: domReady,
      onHistoryStateUpdated: history,
      onCommitted: committed,
    },
    storage: {
      session: {
        get: sessionGet,
        set: async (values: Record<string, unknown>) => {
          Object.assign(session, structuredClone(values))
        },
        remove: async (keys: string | string[]) => {
          for (const key of typeof keys === "string" ? [keys] : keys)
            delete session[key]
        },
        setAccessLevel: async () => undefined,
      },
    },
    action: {
      enable: async () => undefined,
      setTitle: async () => undefined,
      setIcon: async (details: chrome.action.TabIconDetails) => {
        icons.set(details.tabId!, structuredClone(details.path))
      },
    },
    sidePanel: { setOptions: async () => undefined },
  })
  const cache = createTabContextCache()
  const state = new TabContextStateService(cache)
  const rate = new RateLimitService({
    resolveEffectivePolicy: async () => ({ concurrency: 2, delayMs: 0 }),
  })
  const actualResolver = createTabContextResolver({
    getTabContextStateService: () => state,
    tabContextCache: cache,
    rateLimitService: rate,
    siteIntegrationSettingsReader: {
      getAll: async () => ({}),
      getForSite: async () => ({}),
    },
  })
  const resolutions: Array<{ tabId: number; promise: Promise<void> }> = []
  const resolver = {
    ...actualResolver,
    resolveTabContext(
      ...args: Parameters<typeof actualResolver.resolveTabContext>
    ) {
      const promise = actualResolver.resolveTabContext(...args)
      resolutions.push({ tabId: args[0], promise })
      return promise
    },
  }
  const ui = createTabUiCoordinator()
  const projections = () => {
    const raw = session[SESSION_STORAGE_KEYS.activeTabContextByWindow]
    const parsed = parseActiveTabContextByWindow(raw)
    if (raw !== undefined) expect(parsed).toBeDefined()
    return parsed ?? {}
  }
  const flush = async () => {
    await nextTurn()
    await Promise.allSettled(resolutions.map(({ promise }) => promise))
    await nextTurn()
  }
  return {
    tabs,
    session,
    icons,
    updated,
    activated,
    domReady,
    history,
    committed,
    cache,
    state,
    resolver,
    ui,
    fetch,
    names,
    getTab,
    queryTabs,
    sessionGet,
    projections,
    window(windowId = 1) {
      const current = projections()[windowId]
      expect(current).toBeDefined()
      return current!
    },
    flush,
    register() {
      registerBackgroundNavigationListeners({
        ensureIntegrationsReady: async () => undefined,
        getTabContextStateService: () => state,
        tabContextCache: cache,
        tabContextResolver: resolver,
        tabUiCoordinator: ui,
      })
    },
    activate(id: number) {
      const next = tabs.get(id)!
      for (const tab of tabs.values())
        if (tab.windowId === next.windowId) {
          tab.active = tab.id === id
          tab.selected = tab.active
          tab.highlighted = tab.active
        }
      activated.fire({ tabId: id, windowId: next.windowId })
    },
    async closeTab(id: number) {
      tabs.delete(id)
      await state.clearTabState(id)
      await cache.handleTabRemoved(id)
    },
    holdRead(predicate: (keys: string[]) => boolean) {
      const gate = {
        predicate,
        used: false,
        entered: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      }
      readGates.push(gate)
      return gate
    },
    holdFetch(predicate: (url: string) => boolean = () => true) {
      const gate = {
        predicate,
        entered: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      }
      fetchGates.push(gate)
      return gate
    },
    async doneFor(tabId: number) {
      await Promise.allSettled(
        resolutions
          .filter((job) => job.tabId === tabId)
          .map((job) => job.promise)
      )
    },
    async cleanup() {
      for (const gate of [...readGates, ...fetchGates]) gate.release.resolve()
      for (const id of tabs.keys())
        actualResolver.cancelTabContextResolution(id)
      await flush()
      rate.cleanupRateLimiters()
    },
  }
}

describe("navigation and window projection workflows", () => {
  const harnesses: ReturnType<typeof navigationHarness>[] = []
  function harness(session?: Record<string, unknown>) {
    const h = navigationHarness(session)
    harnesses.push(h)
    return h
  }

  beforeEach(() => {
    setEnablementMap({ "pixiv-comic": true })
  })
  afterEach(async () => {
    for (const h of harnesses.splice(0)) await h.cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setEnablementMap({})
  })

  it("initializes current supported action availability and real provider context", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    await h.ui.updateActionForTab(101, seriesUrl(101))
    const supportedIcon = structuredClone(h.icons.get(101))
    await h.ui.updateActionForTab(101, unsupportedUrl)
    expect(h.icons.get(101)).not.toEqual(supportedIcon)
    h.register()
    await h.flush()
    expect(h.icons.get(101)).toEqual(supportedIcon)
    expect(h.window().context).toMatchObject({
      mangaId: "101",
      seriesTitle: "Series 101",
    })
  })

  it("keeps child-frame navigation from replacing the top-level projection or availability", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    h.register()
    await h.flush()
    const before = structuredClone(h.window())
    const icon = structuredClone(h.icons.get(101))
    const gate = h.holdFetch()
    h.domReady.fire({ tabId: 101, frameId: 8, url: seriesUrl(101) })
    h.history.fire({ tabId: 101, frameId: 8, url: unsupportedUrl })
    try {
      await nextTurn()
      expect(h.window()).toEqual(before)
      expect(h.icons.get(101)).toEqual(icon)
    } finally {
      gate.release.resolve()
    }
    await h.flush()
  })

  it("allows supported complete and URL-loading events to resolve current data", async () => {
    const h = harness()
    h.register()
    await h.flush()
    h.tabs.set(101, browserTab(101))
    h.updated.fire(
      101,
      { status: "complete" },
      structuredClone(h.tabs.get(101)!)
    )
    await h.flush()
    expect(h.window().context).toMatchObject({ mangaId: "101" })
    h.names.set(101, "Updated series")
    h.updated.fire(
      101,
      { status: "loading" },
      structuredClone(h.tabs.get(101)!)
    )
    await h.flush()
    h.updated.fire(
      101,
      { status: "complete" },
      structuredClone(h.tabs.get(101)!)
    )
    await h.flush()
    expect(h.window().context).toMatchObject({
      mangaId: "101",
      seriesTitle: "Updated series",
    })
  })

  it("serializes three tab updates while an older projection read is pending", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    h.register()
    await h.flush()
    expect(h.window().context).toMatchObject({ mangaId: "101" })
    const gate = h.holdRead((keys) =>
      keys.includes(SESSION_STORAGE_KEYS.activeTabContextByWindow)
    )
    h.updated.fire(101, { status: "complete" }, browserTab(101))
    h.tabs.get(101)!.url = seriesUrl(202)
    h.updated.fire(
      101,
      { url: seriesUrl(202), status: "loading" },
      structuredClone(h.tabs.get(101)!)
    )
    await gate.entered.promise
    h.updated.fire(
      101,
      { status: "complete" },
      structuredClone(h.tabs.get(101)!)
    )
    await nextTurn()
    gate.release.resolve()
    await h.flush()
    expect(h.window()).toMatchObject({
      activeTabId: 101,
      context: { mangaId: "202", sourceUrl: seriesUrl(202) },
    })
  })

  it("preserves an existing loading owner during a transient blank URL", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    h.register()
    await h.flush()
    expect(h.window().context).toMatchObject({ mangaId: "101" })
    h.names.set(101, "Fresh series")
    const gate = h.holdFetch()
    h.domReady.fire({ tabId: 101, frameId: 0, url: seriesUrl(101) })
    await gate.entered.promise
    const loading = structuredClone(h.window())
    expect(loading.context).toEqual({ loading: true })
    h.tabs.get(101)!.url = "about:blank"
    h.tabs.set(103, browserTab(103, 1, unsupportedUrl, false))
    try {
      await h.closeTab(103)
      expect(h.window()).toEqual(loading)
    } finally {
      h.tabs.get(101)!.url = seriesUrl(101)
      gate.release.resolve()
    }
    await h.flush()
    expect(h.window().context).toMatchObject({
      seriesTitle: "Fresh series",
    })
  })

  it("retains the prior projection until a new active tab exposes its first URL", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    h.register()
    await h.flush()
    const before = structuredClone(h.window())
    Object.assign(h.tabs.get(101)!, {
      active: false,
      selected: false,
      highlighted: false,
    })
    h.tabs.set(102, browserTab(102, 1, ""))
    h.tabs.set(103, browserTab(103, 1, unsupportedUrl, false))
    await h.closeTab(103)
    expect(h.window()).toEqual(before)
  })

  it.each(["about:blank", unsupportedUrl])(
    "clears a previous series when a different unsupported tab becomes active (%s)",
    async (url) => {
      const h = harness()
      h.tabs.set(101, browserTab(101))
      h.register()
      await h.flush()
      Object.assign(h.tabs.get(101)!, {
        active: false,
        selected: false,
        highlighted: false,
      })
      h.tabs.set(102, browserTab(102, 1, url))
      await h.cache.handleTabActivated(102, 1)
      expect(h.window()).toMatchObject({
        activeTabId: 102,
        context: null,
      })
    }
  )

  it("leaves another window's current owner unchanged during a URL update", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    h.tabs.set(202, browserTab(202, 2))
    h.register()
    await h.flush()
    const other = structuredClone(h.window(2))
    h.updated.fire(
      101,
      { url: seriesUrl(101), status: "complete" },
      structuredClone(h.tabs.get(101)!)
    )
    await h.flush()
    expect(h.window(2)).toEqual(other)
    expect(h.window().context).toMatchObject({ mangaId: "101" })
  })

  it("uses active browser tabs and preserves a duplicate loading claim", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    h.tabs.set(102, browserTab(102, 1, seriesUrl(102), false))
    h.register()
    await h.flush()
    h.tabs.set(103, browserTab(103, 1, unsupportedUrl, false))
    await h.closeTab(103)
    expect(h.window()).toMatchObject({
      activeTabId: 101,
      context: { mangaId: "101" },
    })
    const first = await h.cache.projectLoadingForTab(101, 1)
    expect(first).toBeDefined()
    const second = await h.cache.projectLoadingForTab(101, 1)
    expect(second).toEqual(first)
    expect(await h.cache.isRequestIdCurrent(1, first!.requestId)).toBe(true)
  })

  it("clears projection ownership when the last tab is removed", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    h.register()
    await h.flush()
    h.tabs.clear()
    await h.cache.handleTabRemoved(101)
    expect(h.projections()).toEqual({})
  })

  it("rejects a moved-tab refresh without starting work in its new window", async () => {
    const h = harness()
    h.register()
    await h.flush()
    h.tabs.set(101, browserTab(101, 2))
    const handlers = createBackgroundTabContextMessageHandlers({
      tabContextResolver: { resolveTabContext: h.resolver.resolveTabContext },
    } as BackgroundRuntimeHandlerDependencies)
    const response = await handlers.REQUEST_TAB_CONTEXT_REFRESH(
      {
        target: "background",
        type: "REQUEST_TAB_CONTEXT_REFRESH",
        payload: { tabId: 101, windowId: 1 },
      },
      {}
    )
    expect(h.projections()[2]).toBeUndefined()
    expect(response.success).toBe(false)
  })

  it("fails closed when the current source URL cannot be rechecked", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    h.register()
    await h.flush()
    const before = structuredClone(h.window())
    h.getTab.mockRejectedValueOnce(new Error("Tab read failed"))
    expect(
      await h.state.clearTabState(101, {
        windowId: 1,
        expectedUrl: seriesUrl(101),
        supersedeInFlight: true,
      })
    ).toBe(false)
    expect(h.window()).toEqual(before)
    expect(await h.state.getTabState(101)).toMatchObject({ mangaId: "101" })
  })

  it("keeps a current window mutation authorized by its actual tab window", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    h.register()
    await h.flush()
    expect(
      await h.state.clearTabState(101, {
        windowId: 1,
        expectedUrl: seriesUrl(101),
      })
    ).toBe(true)
    expect(h.window().context).toBeNull()
  })

  it("does not clear another tab's window projection after an uncommitted tab moves", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    h.register()
    await h.flush()
    const before = structuredClone(h.window())
    const uncommitted = browserTab(102, 1, "")
    uncommitted.pendingUrl = seriesUrl(102)
    h.tabs.set(102, uncommitted)
    h.activate(102)
    h.updated.fire(102, { status: "loading" }, structuredClone(uncommitted))
    h.tabs.get(102)!.windowId = 2
    Object.assign(h.tabs.get(101)!, {
      active: true,
      selected: true,
      highlighted: true,
    })
    await h.flush()
    expect(h.window()).toEqual(before)
    expect(await h.state.getTabState(101)).toMatchObject({ mangaId: "101" })
  })

  it("preserves a cold provider claim when an unrelated tab closes", async () => {
    const h = harness()
    h.register()
    await h.flush()
    h.tabs.set(101, browserTab(101))
    h.tabs.set(103, browserTab(103, 1, unsupportedUrl, false))
    const gate = h.holdFetch()
    h.activate(101)
    await nextTurn()
    expect(h.window()).toMatchObject({
      activeTabId: 101,
      context: { loading: true },
    })
    await gate.entered.promise
    const loading = structuredClone(h.window())
    try {
      await h.closeTab(103)
      expect(h.window()).toEqual(loading)
    } finally {
      gate.release.resolve()
    }
    await h.flush()
    expect(h.window().context).toMatchObject({
      mangaId: "101",
      seriesTitle: "Series 101",
    })
  })

  it("bounds cached tab identities after many authoritative unsupported pages", async () => {
    const h = harness()
    h.register()
    await h.flush()
    for (let id = 1; id <= 500; id++) {
      const tab = browserTab(id, 1, unsupportedUrl, id === 500)
      h.tabs.set(id, tab)
    }
    for (const tab of h.tabs.values()) {
      h.updated.fire(
        tab.id!,
        { url: unsupportedUrl, status: "complete" },
        structuredClone(tab)
      )
    }
    await h.flush()
    expect(h.cache.getCachedContext(1)).toBeUndefined()
    expect(h.cache.getCachedContext(500)).toBeNull()
  })

  it("does not retain a cold cache miss after the first result loses activation ownership", async () => {
    const h = harness()
    h.register()
    await h.flush()
    h.tabs.set(101, browserTab(101))
    h.tabs.set(102, browserTab(102, 1, unsupportedUrl, false))
    const gate = h.holdFetch()
    h.activate(101)
    await nextTurn()
    expect(h.window()).toMatchObject({
      activeTabId: 101,
      context: { loading: true },
    })
    await gate.entered.promise
    h.activate(102)
    gate.release.resolve()
    await h.flush()
    expect(await h.state.getTabState(101)).toBeNull()
    h.activate(101)
    await h.flush()
    expect(h.window().context).toMatchObject({
      mangaId: "101",
      seriesTitle: "Series 101",
    })
  })

  it("keeps the current loading claim when a cold cached result finishes for an inactive tab", async () => {
    const warm = harness()
    warm.tabs.set(101, browserTab(101))
    warm.tabs.set(102, browserTab(102, 1, seriesUrl(102), false))
    warm.register()
    await warm.flush()
    expect(warm.window().context).toMatchObject({ mangaId: "101" })
    warm.activate(102)
    await warm.flush()
    expect(warm.window().context).toMatchObject({ mangaId: "102" })

    const h = harness(warm.session)
    h.tabs.set(101, browserTab(101))
    h.tabs.set(102, browserTab(102, 1, seriesUrl(102), false))
    const read = h.holdRead((keys) => keys.includes("tab_101"))
    h.register()
    await read.entered.promise
    const fetch = h.holdFetch((url) => url.includes("/102"))
    h.names.set(102, "Fresh second series")
    Object.assign(h.tabs.get(101)!, {
      active: false,
      selected: false,
      highlighted: false,
    })
    Object.assign(h.tabs.get(102)!, {
      active: true,
      selected: true,
      highlighted: true,
    })
    // Permission reconciliation can observe the newly active tab before the
    // old startup cache read replies. It deliberately refreshes ready data.
    const refresh = reconcileIntegrationSupportAfterPermissionRemoval({
      refreshIntegrations: async () => undefined,
      ensureRuntimeReady: async () => undefined,
      tabUiCoordinator: h.ui,
      tabContextResolver: h.resolver,
    })
    await fetch.entered.promise
    const current = structuredClone(h.window())
    expect(current).toMatchObject({
      activeTabId: 102,
      context: { loading: true },
    })
    read.release.resolve()
    try {
      await h.doneFor(101)
      await nextTurn()
      expect(h.window()).toEqual(current)
    } finally {
      fetch.release.resolve()
      await refresh
    }
    await h.flush()
    expect(h.window().context).toMatchObject({
      mangaId: "102",
      seriesTitle: "Fresh second series",
    })
  })

  it("does not project a provider loader after browser tab lookup fails", async () => {
    const h = harness()
    h.tabs.set(101, browserTab(101))
    h.getTab.mockRejectedValue(new Error("Tab lookup unavailable"))
    await h.cache.handleTabActivated(101, 1)
    expect(h.window()).toMatchObject({ activeTabId: 101, context: null })
  })

  it("restores an opaque network failure without treating the cold cache as absence", async () => {
    const warm = harness()
    const respond = warm.fetch.getMockImplementation()!
    warm.fetch.mockImplementation(async (input, init) => {
      // Fetch failures expose an opaque message, with no UI wording contract.
      if (new URL(String(input)).pathname.endsWith("/works/v5/101"))
        throw new TypeError("E")
      return await respond(input, init)
    })
    warm.tabs.set(101, browserTab(101))
    warm.register()
    await warm.flush()
    expect(warm.window().context).toMatchObject({ error: expect.any(String) })
    const h = harness(warm.session)
    h.tabs.set(101, browserTab(101))
    h.register()
    await h.flush()
    expect(h.window().context).toMatchObject({ error: expect.any(String) })
    expect(await h.state.getTabState(101)).toBeNull()
  })
})
