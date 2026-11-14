import { afterEach, expect, it, vi } from "vitest"
import { createTabContextResolver } from "@/entrypoints/background/tab-context-resolver"
import { createTabContextCache } from "@/entrypoints/background/tab-cache"
import { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { setEnablementMap } from "@/src/site-integrations/catalog"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY as preferenceKey } from "@/src/site-integrations/mangadex/preferences-schema"

vi.mock("@/src/runtime/logger", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const seriesId = "10aef6a5-5699-4426-bfce-d31d0304b2c3"
const sourceUrl = `https://mangadex.org/title/${seriesId}`
const preferences = { dataSaver: false, filteredLanguages: ["ja"] }
const cleanups: Array<() => void> = []

afterEach(() => {
  setEnablementMap({})
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture() {
  setEnablementMap({ mangadex: true })
  const session: Record<string, unknown> = {}
  const tab = { id: 7, active: true, windowId: 2, url: sourceUrl }
  const metadata = Promise.withResolvers<void>()
  const metadataStarted = Promise.withResolvers<void>()
  const feedResponses: Response[] = []
  const getTab = vi.fn(async () => structuredClone(tab))
  const getSession = vi.fn(async (requested: string | string[]) =>
    Object.fromEntries(
      [requested]
        .flat()
        .filter((key) => Object.hasOwn(session, key))
        .map((key) => [key, structuredClone(session[key])])
    )
  )
  const setSession = vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(session, structuredClone(values))
  })
  const executeScript = vi.fn(async () => [
    { result: { url: tab.url, data: preferences } },
  ])
  vi.stubGlobal("chrome", {
    permissions: { contains: async () => true },
    tabs: {
      get: getTab,
      query: async () => (tab.active ? [structuredClone(tab)] : []),
    },
    scripting: { executeScript },
    storage: {
      session: {
        get: getSession,
        set: setSession,
        remove: async (requested: string | string[]) => {
          for (const key of [requested].flat()) delete session[key]
        },
      },
    },
  })
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input)
    let body: unknown
    if (url.pathname.endsWith("/feed")) {
      body = { result: "ok", data: [], total: 0, offset: 0, limit: 500 }
    } else if (url.pathname.startsWith("/statistics/")) {
      body = { statistics: {} }
    } else {
      metadataStarted.resolve()
      await metadata.promise
      body = {
        result: "ok",
        data: {
          id: seriesId,
          type: "manga",
          attributes: { title: { en: "Recovered series" } },
          relationships: [],
        },
      }
    }
    const response = Response.json(body)
    Object.defineProperty(response, "url", { value: input })
    if (url.pathname.endsWith("/feed")) feedResponses.push(response)
    return response
  })
  vi.stubGlobal("fetch", fetch)
  const rateLimitService = new RateLimitService({
    resolveEffectivePolicy: async () => ({ concurrency: 4, delayMs: 0 }),
  })
  cleanups.push(() => rateLimitService.cleanupRateLimiters())
  const cache = createTabContextCache()
  const state = new TabContextStateService(cache)
  const resolver = createTabContextResolver({
    tabContextCache: cache,
    getTabContextStateService: () => state,
    rateLimitService,
    siteIntegrationSettingsReader: {
      getAll: async () => ({}),
      getForSite: async () => ({}),
    },
  })
  async function finishFeed() {
    await metadataStarted.promise
    await vi.waitFor(() => expect(feedResponses[0]?.bodyUsed).toBe(true))
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return {
    session,
    tab,
    metadata,
    getTab,
    getSession,
    setSession,
    executeScript,
    resolver,
    cache,
    state,
    finishFeed,
  }
}

it.each(["canceled", "inactive"] as const)(
  "keeps probe preferences unchanged after the final owner becomes %s",
  async (loss) => {
    const f = fixture()
    const pending = f.resolver.resolveTabContext(7, { windowId: 2 })
    await f.finishFeed()
    const reading = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.getTab.mockImplementationOnce(async () => {
      reading.resolve()
      await release.promise
      return structuredClone(f.tab)
    })
    f.metadata.resolve()
    await reading.promise
    if (loss === "canceled") f.resolver.cancelTabContextResolution(7)
    else f.tab.active = false
    release.resolve()
    await expect(pending).resolves.toBeUndefined()
    expect(f.session[preferenceKey]).toBeUndefined()
    expect(f.session.tab_7).toBeUndefined()
    expect(
      f.setSession.mock.calls.filter(([values]) => preferenceKey in values)
    ).toHaveLength(0)
    expect(f.executeScript).toHaveBeenCalledOnce()
  }
)

it("finishes accepted preference persistence while later cancellation keeps the cleared tab authoritative", async () => {
  const f = fixture()
  const writing = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const get = f.getSession.getMockImplementation()!
  f.getSession.mockImplementation(async (requested) => {
    if ([requested].flat().includes(preferenceKey)) {
      writing.resolve()
      await release.promise
    }
    return get(requested)
  })
  const pending = f.resolver.resolveTabContext(7, { windowId: 2 })
  await f.finishFeed()
  f.metadata.resolve()
  await writing.promise
  f.resolver.cancelTabContextResolution(7)
  await f.state.clearTabState(7, { windowId: 2 })
  release.resolve()
  await expect(pending).resolves.toBeUndefined()
  expect(f.session[preferenceKey]).toEqual({
    [`mangadex#${seriesId}`]: preferences,
  })
  expect(f.session.tab_7).toBeUndefined()
  expect(f.cache.getCachedContext(7)).toBeNull()
})

it("settles coalesced old-window waiters after tab movement and authorizes only a fresh window owner", async () => {
  const f = fixture()
  const first = f.resolver.resolveTabContext(7, { windowId: 2 })
  await f.finishFeed()
  const reading = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const snapshot = structuredClone(f.tab)
  f.getTab.mockImplementationOnce(async () => {
    reading.resolve()
    await release.promise
    return snapshot
  })
  f.metadata.resolve()
  await reading.promise
  f.tab.active = false
  await f.cache.syncActiveTabContext()
  expect(f.session[SESSION_STORAGE_KEYS.activeTabContextByWindow]).toEqual({})
  f.tab.windowId = 3
  f.tab.active = true
  const moved = f.resolver.resolveTabContext(7, { windowId: 3 })
  await new Promise<void>((resolve) => setImmediate(resolve))
  const settled = expect(Promise.all([first, moved])).resolves.toEqual([
    undefined,
    undefined,
  ])
  release.resolve()
  await settled
  expect(f.session[preferenceKey]).toBeUndefined()
  expect(f.session.tab_7).toBeUndefined()

  await f.resolver.resolveTabContext(7, { windowId: 3 })
  await expect(f.cache.getCurrentSeriesContext(7, 3)).resolves.toMatchObject({
    context: { mangaId: seriesId, seriesTitle: "Recovered series", sourceUrl },
  })
  expect(f.session[preferenceKey]).toEqual({
    [`mangadex#${seriesId}`]: preferences,
  })
})
