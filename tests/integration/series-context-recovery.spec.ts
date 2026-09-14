import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTabContextCache } from "@/entrypoints/background/tab-cache"
import { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import { createTabContextResolver } from "@/entrypoints/background/tab-context-resolver"
import { createBackgroundTabContextMessageHandlers } from "@/entrypoints/background/background-tab-context-message-handlers"
import { createSeriesContextRecoveryCoordinator } from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"

const provider = vi.hoisted(() => vi.fn())
vi.mock("@/src/runtime/resolve-site-integration-series-data", () => ({
  resolveSiteIntegrationSeriesData: provider,
}))
vi.mock("@/src/runtime/logger", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const url = "https://comic.pixiv.net/works/123"
const observation = { hydrated: true, tabId: 7, windowId: 2, sourceUrl: url }
const readyResult = {
  seriesId: "123",
  seriesMetadata: { title: "Recovered series" },
  chapterList: {
    chapters: [
      {
        id: "chapter-1",
        title: "Chapter 1",
        url: "https://comic.pixiv.net/episodes/1",
      },
    ],
    volumes: [],
  },
}

describe("sidepanel requested series recovery", () => {
  let session: Record<string, unknown>
  let cache: ReturnType<typeof createTabContextCache>
  let resolver: ReturnType<typeof createTabContextResolver>
  let handler: ReturnType<
    typeof createBackgroundTabContextMessageHandlers
  >["REQUEST_TAB_CONTEXT_REFRESH"]
  let coordinator: ReturnType<typeof createSeriesContextRecoveryCoordinator>

  beforeEach(() => {
    session = {}
    provider
      .mockReset()
      .mockRejectedValueOnce(new Error("Transient provider failure"))
      .mockResolvedValue(readyResult)
    const tab = { id: 7, active: true, windowId: 2, url }
    vi.stubGlobal("chrome", {
      tabs: { get: async () => tab, query: async () => [tab] },
      runtime: {
        id: "tako",
        getURL: (path: string) => `chrome-extension://tako/${path}`,
      },
      storage: {
        session: {
          get: async (keys: string | string[]) =>
            Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys]).map((key) => [
                key,
                structuredClone(session[key]),
              ])
            ),
          set: async (values: Record<string, unknown>) => {
            Object.assign(session, structuredClone(values))
          },
          remove: async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys])
              delete session[key]
          },
        },
      },
    })
    cache = createTabContextCache()
    const stateService = new TabContextStateService(cache)
    resolver = createTabContextResolver({
      tabContextCache: cache,
      getTabContextStateService: () => stateService,
      rateLimitService: {} as never,
      siteIntegrationSettingsReader: {
        getAll: async () => ({}),
        getForSite: async () => ({}),
      },
    })
    handler = createBackgroundTabContextMessageHandlers({
      tabContextResolver: resolver,
    } as never).REQUEST_TAB_CONTEXT_REFRESH
    coordinator = createSeriesContextRecoveryCoordinator({
      requestRefresh: async (target) =>
        handler(
          {
            target: "background",
            type: "REQUEST_TAB_CONTEXT_REFRESH",
            payload: target,
          } as RuntimeMessageRequest<"REQUEST_TAB_CONTEXT_REFRESH">,
          {}
        ),
    })
  })

  function errorObservation() {
    const value = cache.getCachedContext(7)
    if (!value || !("error" in value))
      throw new Error("Expected failed provider context")
    return {
      ...observation,
      activeTabContext: { kind: "error" as const, error: value.error },
    }
  }

  it("calls the provider again after a transient failure and then reuses the ready cache", async () => {
    await resolver.resolveTabContext(7)
    expect(provider).toHaveBeenCalledTimes(1)
    await coordinator.recoverIfNeeded(errorObservation())
    expect(provider).toHaveBeenCalledTimes(2)
    expect(session.tab_7).toMatchObject({
      mangaId: "123",
      seriesTitle: "Recovered series",
    })
    expect(session.seriesContextError_7).toBeUndefined()
    await handler(
      {
        target: "background",
        type: "REQUEST_TAB_CONTEXT_REFRESH",
        payload: { tabId: 7, windowId: 2 },
      },
      {}
    )
    expect(provider).toHaveBeenCalledTimes(2)
  })

  it("bounds automatic error recovery across loading/error projections and permits a user retry", async () => {
    provider.mockReset().mockRejectedValue(new Error("Provider unavailable"))
    await resolver.resolveTabContext(7)
    await coordinator.recoverIfNeeded(errorObservation())
    expect(provider).toHaveBeenCalledTimes(2)
    await coordinator.recoverIfNeeded({
      ...observation,
      activeTabContext: { kind: "loading" },
    })
    await coordinator.recoverIfNeeded(errorObservation())
    expect(provider).toHaveBeenCalledTimes(2)
    provider.mockResolvedValue(readyResult)
    await coordinator.retry(errorObservation())
    expect(provider).toHaveBeenCalledTimes(3)
    expect(session.tab_7).toMatchObject({ seriesTitle: "Recovered series" })
  })

  it("retries after coalescing with an ordinary refresh that reused the cached error", async () => {
    await resolver.resolveTabContext(7)
    const cacheProjectionStarted = Promise.withResolvers<void>()
    const releaseCacheProjection = Promise.withResolvers<void>()
    const sync = cache.syncActiveTabContext.bind(cache)
    vi.spyOn(cache, "syncActiveTabContext").mockImplementationOnce(
      async (...args) => {
        cacheProjectionStarted.resolve()
        await releaseCacheProjection.promise
        return await sync(...args)
      }
    )
    const ordinaryRefresh = resolver.resolveTabContext(7, { allowCached: true })
    await cacheProjectionStarted.promise
    const firstRecovery = coordinator.recoverIfNeeded(errorObservation())
    const concurrentRecovery = handler(
      {
        target: "background",
        type: "REQUEST_TAB_CONTEXT_REFRESH",
        payload: { tabId: 7, windowId: 2 },
      },
      {}
    )
    releaseCacheProjection.resolve()
    await Promise.all([ordinaryRefresh, firstRecovery, concurrentRecovery])
    expect(provider).toHaveBeenCalledTimes(2)
    expect(session.tab_7).toMatchObject({ seriesTitle: "Recovered series" })
  })
})
