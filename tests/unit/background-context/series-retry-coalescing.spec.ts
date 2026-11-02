import { afterEach, expect, it, vi } from "vitest"
import { createTabContextResolver } from "@/entrypoints/background/tab-context-resolver"
import { createTabContextCache } from "@/entrypoints/background/tab-cache"
import { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { setEnablementMap } from "@/src/site-integrations/catalog"

vi.mock("@/src/runtime/logger", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const firstId = "10aef6a5-5699-4426-bfce-d31d0304b2c3"
const secondId = "20aef6a5-5699-4426-bfce-d31d0304b2c3"
const cleanups: Array<() => void> = []
afterEach(() => {
  setEnablementMap({})
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture() {
  setEnablementMap({ mangadex: true })
  const tab = {
    id: 7,
    active: true,
    windowId: 2,
    url: `https://mangadex.org/title/${firstId}`,
  }
  const session: Record<string, unknown> = {}
  const getTab = vi.fn(async () => structuredClone(tab))
  const query = vi.fn(async () => (tab.active ? [structuredClone(tab)] : []))
  vi.stubGlobal("chrome", {
    tabs: { get: getTab, query },
    storage: {
      session: {
        get: async (requested: string | string[]) =>
          Object.fromEntries(
            [requested]
              .flat()
              .filter((key) => Object.hasOwn(session, key))
              .map((key) => [key, structuredClone(session[key])])
          ),
        set: async (values: Record<string, unknown>) => {
          Object.assign(session, structuredClone(values))
        },
        remove: async (requested: string | string[]) => {
          for (const key of [requested].flat()) delete session[key]
        },
      },
    },
  })
  const metadataRequests: Array<{ url: URL; signal?: AbortSignal | null }> = []
  const feedResponses: Response[] = []
  const metadataGate = vi.fn(async (_index: number) => {})
  let failures = false
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input)
    const isMetadata =
      url.pathname.startsWith("/manga/") && !url.pathname.endsWith("/feed")
    if (isMetadata) {
      metadataRequests.push({ url, signal: init.signal })
      await metadataGate(metadataRequests.length)
    }
    let body: unknown = { statistics: {} }
    if (isMetadata)
      body = {
        result: "ok",
        data: {
          id: url.pathname.split("/")[2],
          type: "manga",
          attributes: { title: { en: "Current series" } },
          relationships: [],
        },
      }
    if (url.pathname.endsWith("/feed"))
      body = { result: "ok", data: [], total: 0, offset: 0, limit: 500 }
    const response = Response.json(body, { status: failures ? 503 : 200 })
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
  const beforeResolution = vi.fn(async () => {})
  const resolver = createTabContextResolver({
    tabContextCache: cache,
    getTabContextStateService: () => state,
    beforeResolution,
    rateLimitService,
    siteIntegrationSettingsReader: {
      getAll: async () => ({ mangadex: { autoReadMangaDexSettings: false } }),
      getForSite: async () => ({ autoReadMangaDexSettings: false }),
    },
  })
  return {
    tab,
    session,
    getTab,
    query,
    fetch,
    metadataRequests,
    feedResponses,
    metadataGate,
    cache,
    state,
    resolver,
    beforeResolution,
    fail: (value: boolean) => {
      failures = value
    },
  }
}

it("settles a lost loading claim before requesting provider data", async () => {
  const f = fixture()
  f.query.mockImplementationOnce(async () => {
    f.tab.active = false
    return []
  })
  await expect(
    f.resolver.resolveTabContext(7, { windowId: 2 })
  ).resolves.toBeUndefined()
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.session.tab_7).toBeUndefined()
})

it("shares a failed explicit retry without scheduling another automatic provider fetch", async () => {
  const f = fixture()
  f.fail(true)
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  f.metadataGate.mockImplementationOnce(async () => {
    started.resolve()
    await release.promise
  })
  const first = f.resolver.resolveTabContext(7, {
    windowId: 2,
    retryErrors: true,
  })
  await started.promise
  const second = f.resolver.resolveTabContext(7, {
    windowId: 2,
    retryErrors: true,
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  release.resolve()
  await expect(Promise.all([first, second])).resolves.toEqual([
    undefined,
    undefined,
  ])
  expect(f.metadataRequests).toHaveLength(1)
  expect(f.cache.getCachedContext(7)).toMatchObject({
    error: expect.any(String),
  })
})

it("coalesces a cached error and performs the one explicitly requested fresh fetch", async () => {
  const f = fixture()
  f.fail(true)
  await f.resolver.resolveTabContext(7, { windowId: 2 })
  expect(f.cache.getCachedContext(7)).toMatchObject({
    error: expect.any(String),
  })
  f.fail(false)
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  f.beforeResolution.mockImplementationOnce(async () => {
    entered.resolve()
    await release.promise
  })
  const cached = f.resolver.resolveTabContext(7, {
    windowId: 2,
    allowCached: true,
  })
  await entered.promise
  const fresh = f.resolver.resolveTabContext(7, {
    windowId: 2,
    allowCached: true,
    retryErrors: true,
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  release.resolve()
  await expect(Promise.all([cached, fresh])).resolves.toEqual([
    undefined,
    undefined,
  ])
  expect(f.metadataRequests).toHaveLength(2)
  await expect(f.cache.getCurrentSeriesContext(7, 2)).resolves.toMatchObject({
    context: { mangaId: firstId },
  })
})

it("lets an old automatic URL retry join the current valid owner", async () => {
  const f = fixture()
  const firstMetadata = Promise.withResolvers<void>()
  const nextMetadata = Promise.withResolvers<void>()
  f.metadataGate.mockImplementation(async (index) => {
    if (index === 1) await firstMetadata.promise
    if (index === 2) await nextMetadata.promise
  })
  const first = f.resolver.resolveTabContext(7, {
    windowId: 2,
    supersedeInFlight: true,
  })
  await vi.waitFor(() => expect(f.feedResponses[0]?.bodyUsed).toBe(true))
  await new Promise<void>((resolve) => setImmediate(resolve))
  f.tab.url = `https://mangadex.org/title/${secondId}`
  const retryRead = Promise.withResolvers<void>()
  const releaseRetry = Promise.withResolvers<void>()
  let changedUrlReads = 0
  f.getTab.mockImplementation(async () => {
    const snapshot = structuredClone(f.tab)
    if (++changedUrlReads === 2) {
      retryRead.resolve()
      await releaseRetry.promise
    }
    return snapshot
  })
  firstMetadata.resolve()
  await retryRead.promise
  const current = f.resolver.resolveTabContext(7, {
    windowId: 2,
    supersedeInFlight: true,
  })
  try {
    await vi.waitFor(() => expect(f.metadataRequests).toHaveLength(2))
    releaseRetry.resolve()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.metadataRequests[1].signal?.aborted).toBe(false)
    nextMetadata.resolve()
    await expect(Promise.all([first, current])).resolves.toEqual([
      undefined,
      undefined,
    ])
    expect(f.metadataRequests).toHaveLength(2)
    await expect(f.cache.getCurrentSeriesContext(7, 2)).resolves.toMatchObject({
      context: { mangaId: secondId },
    })
  } finally {
    firstMetadata.resolve()
    nextMetadata.resolve()
    releaseRetry.resolve()
    await Promise.allSettled([first, current])
  }
})

it("settles a refresh under continuing valid URL churn within a finite browser-read budget", async () => {
  const f = fixture()
  const browserBudget = 64
  let reads = 0
  let exhausted = false
  f.getTab.mockImplementation(async () => {
    if (++reads > browserBudget) {
      exhausted = true
      throw new Error("Browser read budget exhausted")
    }
    f.tab.url = `https://mangadex.org/title/11111111-1111-4111-8111-${String(reads).padStart(12, "0")}`
    return structuredClone(f.tab)
  })
  await expect(
    f.resolver.resolveTabContext(7, { windowId: 2 })
  ).resolves.toBeUndefined()
  expect(exhausted).toBe(false)
  expect(f.fetch).not.toHaveBeenCalled()
})
