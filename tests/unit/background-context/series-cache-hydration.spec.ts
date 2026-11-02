import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTabContextCache } from "@/entrypoints/background/tab-cache"
import { createTabContextResolver } from "@/entrypoints/background/tab-context-resolver"
import { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import { RateLimitService } from "@/src/runtime/rate-limit"
import {
  MangaPageStateSchema,
  parseActiveTabContextByWindow,
} from "@/src/runtime/tab-state-schemas"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { setEnablementMap } from "@/src/site-integrations/catalog"

const url = "https://comic.pixiv.net/works/123"

function jsonResponse(endpoint: string, data: unknown, status = 200) {
  const response = new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
  Object.defineProperty(response, "url", { value: endpoint })
  return response
}

describe("canonical series cache hydration", () => {
  let session: Record<string, unknown>
  let activeId: number
  let currentUrl: string
  let cache: ReturnType<typeof createTabContextCache>
  let service: TabContextStateService
  let rates: RateLimitService
  const query = vi.fn()
  const fetchNetwork = vi.fn()

  function resolver() {
    return createTabContextResolver({
      tabContextCache: cache,
      getTabContextStateService: () => service,
      rateLimitService: rates,
      siteIntegrationSettingsReader: {
        getAll: async () => ({}),
        getForSite: async () => ({}),
      },
    })
  }

  function readyState(sourceUrl = url) {
    return MangaPageStateSchema.parse({
      sourceUrl,
      siteIntegrationId: "pixiv-comic",
      mangaId: sourceUrl.split("/").at(-1),
      seriesTitle: "Cached series",
      chapters: [
        {
          id: "101",
          title: "First",
          url: "https://comic.pixiv.net/viewer/stories/101",
          index: 1,
          status: "queued",
          lastUpdated: 1,
        },
      ],
      volumes: [],
      lastUpdated: 1,
    })
  }

  function currentProjection() {
    return parseActiveTabContextByWindow(
      session[SESSION_STORAGE_KEYS.activeTabContextByWindow]
    )?.[2]
  }

  beforeEach(() => {
    session = {}
    activeId = 7
    currentUrl = url
    setEnablementMap({})
    query
      .mockReset()
      .mockImplementation(async () => [
        { id: activeId, windowId: 2, active: true, url: currentUrl },
      ])
    fetchNetwork
      .mockReset()
      .mockImplementation(async (input: string | URL | Request) => {
        const endpoint = String(input)
        if (endpoint.includes("/api/app/works/v5/"))
          return jsonResponse(endpoint, {
            data: { official_work: { name: "Fresh series" } },
          })
        if (endpoint.includes("/episodes/v2"))
          return jsonResponse(endpoint, {
            data: {
              episodes: [
                {
                  state: "readable",
                  episode: {
                    id: 101,
                    numbering_title: "1",
                    sub_title: "First",
                  },
                },
              ],
            },
          })
        throw new Error(`Unexpected provider endpoint: ${endpoint}`)
      })
    vi.stubGlobal("fetch", fetchNetwork)
    vi.stubGlobal("chrome", {
      tabs: {
        query,
        get: async (id: number) => ({
          id,
          active: id === activeId,
          windowId: 2,
          url: currentUrl,
        }),
      },
      storage: {
        session: {
          get: async (keys: string | string[]) =>
            Object.fromEntries(
              [keys]
                .flat()
                .filter((key) => Object.hasOwn(session, key))
                .map((key) => [key, structuredClone(session[key])])
            ),
          set: async (values: Record<string, unknown>) =>
            Object.assign(session, structuredClone(values)),
          remove: async (keys: string | string[]) => {
            for (const key of [keys].flat()) delete session[key]
          },
          setAccessLevel: async () => undefined,
        },
      },
    })
    rates = new RateLimitService({
      resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
    })
    cache = createTabContextCache()
    service = new TabContextStateService(cache)
  })

  afterEach(() => {
    rates.cleanupRateLimiters()
    setEnablementMap({})
    vi.unstubAllGlobals()
  })

  it("restores a valid cold session context without fetching the provider", async () => {
    session.tab_7 = readyState()
    expect(cache.getCachedContext(7)).toBeUndefined()
    await resolver().resolveTabContext(7, { windowId: 2, allowCached: true })
    expect(fetchNetwork).not.toHaveBeenCalled()
    expect(await cache.getCurrentSeriesContext(7, 2)).toMatchObject({
      context: { sourceUrl: url, seriesTitle: "Cached series" },
    })
  })

  it("keeps an absent cold context loading until the real provider resolves it", async () => {
    const delivery = Promise.withResolvers<void>()
    const network = fetchNetwork.getMockImplementation()!
    fetchNetwork.mockImplementation(async (...args) => {
      await delivery.promise
      return network(...args)
    })
    const pending = resolver().resolveTabContext(7, {
      windowId: 2,
      allowCached: true,
    })
    try {
      await vi.waitFor(() => expect(fetchNetwork).toHaveBeenCalled())
      expect(currentProjection()?.context).toEqual({ loading: true })
      expect(await cache.getCurrentSeriesContext(7, 2)).toBeUndefined()
    } finally {
      delivery.resolve()
      await pending
    }
    expect(await cache.getCurrentSeriesContext(7, 2)).toMatchObject({
      context: { seriesTitle: "Fresh series", mangaId: "123" },
    })
  })

  it("reuses a real provider failure as a known negative until an explicit retry", async () => {
    const network = fetchNetwork.getMockImplementation()!
    fetchNetwork.mockImplementation(async (input: string | URL | Request) =>
      jsonResponse(String(input), { error: "Unavailable" }, 503)
    )
    await resolver().resolveTabContext(7, { windowId: 2 })
    expect(cache.getCachedContext(7)).toEqual({ error: expect.any(String) })
    fetchNetwork.mockClear()
    await resolver().resolveTabContext(7, { windowId: 2, allowCached: true })
    expect(fetchNetwork).not.toHaveBeenCalled()
    expect(currentProjection()?.context).toEqual({ error: expect.any(String) })
    fetchNetwork.mockImplementation(network)
    await resolver().resolveTabContext(7, {
      windowId: 2,
      allowCached: true,
      retryErrors: true,
    })
    expect(await cache.getCurrentSeriesContext(7, 2)).toMatchObject({
      context: { mangaId: "123", seriesTitle: "Fresh series" },
    })
  })

  it("replaces stale source-URL cache authority with the freshly fetched series", async () => {
    session.tab_7 = readyState()
    currentUrl = "https://comic.pixiv.net/works/456"
    await resolver().resolveTabContext(7, { windowId: 2, allowCached: true })
    expect(fetchNetwork).toHaveBeenCalledTimes(2)
    expect(await cache.getCurrentSeriesContext(7, 2)).toMatchObject({
      context: {
        sourceUrl: currentUrl,
        mangaId: "456",
        seriesTitle: "Fresh series",
      },
    })
    expect(currentProjection()?.context).toMatchObject({
      sourceUrl: currentUrl,
    })
  })

  it("settles without fetching when the active window refuses its loading claim", async () => {
    query.mockImplementationOnce(async () => {
      activeId = 8
      return [{ id: 8, windowId: 2, active: true, url: currentUrl }]
    })
    await expect(
      resolver().resolveTabContext(7, { windowId: 2 })
    ).resolves.toBeUndefined()
    expect(fetchNetwork).not.toHaveBeenCalled()
    expect(session.tab_7).toBeUndefined()
    expect(currentProjection()).toBeUndefined()
    activeId = 7
    await resolver().resolveTabContext(7, { windowId: 2 })
    expect(await cache.getCurrentSeriesContext(7, 2)).toMatchObject({
      context: { mangaId: "123" },
    })
  })
})
