import { beforeEach, expect, it, vi } from "vitest"
import { createTabContextResolver } from "@/entrypoints/background/tab-context-resolver"
import { backgroundSiteAdapter } from "@/src/site-integrations/mangadex/background-runtime"
import { MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY } from "@/src/site-integrations/mangadex/preferences-schema"
import type { TabContextStateProjectionOptions } from "@/entrypoints/background/tab-context-state-service"

const platform = vi.hoisted(() => ({
  resolveSeries: vi.fn(),
  executeProbe: vi.fn(),
  getAdapter: vi.fn(),
}))
vi.mock("@/src/runtime/resolve-site-integration-series-data", () => ({
  resolveSiteIntegrationSeriesData: platform.resolveSeries,
}))
vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  getBackgroundSiteAdapterById: platform.getAdapter,
}))
vi.mock("@/src/site-integrations/page-probe", () => ({
  executeApprovedPageProbe: platform.executeProbe,
}))
vi.mock("@/src/site-integrations/url-matcher", () => ({
  matchUrl: () => ({ integrationId: "mangadex", role: "series" }),
}))
vi.mock("@/src/runtime/logger", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const seriesId = "10aef6a5-5699-4426-bfce-d31d0304b2c3"
const url = `https://mangadex.org/title/${seriesId}`
const pageProbeData = { dataSaver: false, filteredLanguages: ["ja"] }

beforeEach(() => {
  vi.clearAllMocks()
  platform.executeProbe.mockResolvedValue({ url, data: pageProbeData })
  platform.resolveSeries.mockResolvedValue({
    seriesId,
    seriesMetadata: { title: "Series" },
    chapterList: { chapters: [], volumes: [] },
  })
})

function fixture(cancelAfterRevisionCheck: boolean) {
  const events: string[] = []
  const session: Record<string, unknown> = {}
  const getTab = vi.fn(async () => {
    events.push("tab")
    return { id: 7, windowId: 2, active: true, url }
  })
  vi.stubGlobal("chrome", {
    tabs: { get: getTab },
    storage: {
      session: {
        get: async () => structuredClone(session),
        set: async (values: Record<string, unknown>) => {
          Object.assign(session, structuredClone(values))
        },
      },
    },
  })
  const persist = vi.fn(
    async (input: { seriesId: string; pageProbeData: unknown }) => {
      events.push("persist")
      const background = backgroundSiteAdapter.background
      if (!background.persistPageProbeData)
        throw new Error("MangaDex preference persistence is unavailable")
      await background.persistPageProbeData(input)
    }
  )
  platform.getAdapter.mockResolvedValue({
    background: {
      ...backgroundSiteAdapter.background,
      persistPageProbeData: persist,
    },
  })
  const isRequestIdCurrent = vi.fn(() => {
    events.push("revision")
    const result = Promise.resolve(true)
    if (cancelAfterRevisionCheck)
      void result.then(() =>
        queueMicrotask(() => {
          events.push("cancel")
          resolver.cancelTabContextResolution(7)
        })
      )
    return result
  })
  const resolver = createTabContextResolver({
    tabContextCache: {
      projectLoadingForTab: async () => ({ requestId: 1 }),
      isRequestIdCurrent,
    } as never,
    getTabContextStateService: () =>
      ({
        commitResolvedTabContext: async (
          _payload: unknown,
          _tabId: number,
          request: TabContextStateProjectionOptions
        ) => {
          if (!request.ownerSignal?.aborted) events.push("commit")
          return { success: true }
        },
      }) as never,
    rateLimitService: {} as never,
    siteIntegrationSettingsReader: {
      getAll: async () => ({}),
      getForSite: async () => ({}),
    },
  })
  return { resolver, events, session, persist, getTab, isRequestIdCurrent }
}

it("starts accepted probe persistence in the final ownership continuation before cancellation can supersede it", async () => {
  const { resolver, events, session, persist, getTab, isRequestIdCurrent } =
    fixture(true)
  await resolver.resolveTabContext(7, { windowId: 2 })
  expect(events).toEqual(["tab", "tab", "tab", "revision", "persist", "cancel"])
  expect(persist).toHaveBeenCalledExactlyOnceWith({ seriesId, pageProbeData })
  expect(session[MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY]).toEqual({
    [`mangadex#${seriesId}`]: pageProbeData,
  })
  expect(getTab).toHaveBeenCalledTimes(3)
  expect(isRequestIdCurrent).toHaveBeenCalledExactlyOnceWith(2, 1)
})

it("persists the accepted probe before publishing an uncanceled resolution", async () => {
  const { resolver, events, session } = fixture(false)
  await resolver.resolveTabContext(7, { windowId: 2 })
  expect(events).toEqual(["tab", "tab", "tab", "revision", "persist", "commit"])
  expect(session[MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY]).toEqual({
    [`mangadex#${seriesId}`]: pageProbeData,
  })
})
