import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  handleInitializeTab: vi.fn(async () => ({ success: true })),
  resolveSeriesData: vi.fn(),
  executePageProbe: vi.fn(),
  matchUrl: vi.fn(),
  getForSite: vi.fn(),
}))

vi.mock("@/entrypoints/background/action-handlers/tab-state-handlers", () => ({
  handleInitializeTab: mocks.handleInitializeTab,
}))
vi.mock("@/src/runtime/resolve-site-integration-series-data", () => ({
  resolveSiteIntegrationSeriesData: mocks.resolveSeriesData,
}))
vi.mock("@/src/site-integrations/page-probe", () => ({
  executeApprovedPageProbe: mocks.executePageProbe,
}))
vi.mock("@/src/site-integrations/url-matcher", () => ({
  matchUrl: mocks.matchUrl,
}))
vi.mock("@/src/runtime/logger", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/src/storage/site-integration-settings-service", () => ({
  siteIntegrationSettingsService: {
    getForSite: mocks.getForSite,
  },
}))
import { createTabContextResolver } from "@/entrypoints/background/tab-context-resolver"

describe("tab context resolver", () => {
  const getTab = vi.fn()
  const getSession = vi.fn()
  const setSession = vi.fn()

  function createCache() {
    return {
      projectLoadingForTab: vi.fn(async () => ({ requestId: 4 })),
      getCachedContext: vi.fn(),
      syncActiveTabContext: vi.fn(async () => true),
      isRequestIdCurrent: vi.fn(async () => true),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getForSite.mockResolvedValue({ autoReadMangaDexSettings: true })
    getSession.mockResolvedValue({})
    getTab.mockResolvedValue({
      id: 9,
      active: true,
      windowId: 3,
      url: "https://comic.pixiv.net/works/123",
    })
    vi.stubGlobal("chrome", {
      tabs: { get: getTab },
      storage: { session: { get: getSession, set: setSession } },
    })
    mocks.matchUrl.mockReturnValue({
      integrationId: "pixiv-comic",
      role: "series",
    })
    mocks.resolveSeriesData.mockResolvedValue({
      seriesId: "123",
      seriesMetadata: { title: "A series" },
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
    })
  })

  it("projects loading before restoring a cached tab context", async () => {
    const cache = createCache()
    const beforeStateMutation = vi.fn(async () => undefined)
    cache.getCachedContext.mockReturnValue({
      siteIntegrationId: "pixiv-comic",
      mangaId: "123",
      seriesTitle: "Cached",
      chapters: [],
      volumes: [],
      lastUpdated: 1,
    })
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: cache as never,
      beforeStateMutation,
    })

    await resolver.resolveTabContext(9, { allowCached: true })

    expect(cache.projectLoadingForTab).toHaveBeenCalledBefore(
      cache.syncActiveTabContext
    )
    expect(mocks.resolveSeriesData).not.toHaveBeenCalled()
    expect(beforeStateMutation).not.toHaveBeenCalled()
  })

  it("does not treat a cached metadata-only partial as terminal", async () => {
    const cache = createCache()
    cache.getCachedContext.mockReturnValue({
      siteIntegrationId: "pixiv-comic",
      mangaId: "123",
      seriesTitle: "Cached metadata",
      chapters: [],
      volumes: [],
      chaptersLoading: true,
      lastUpdated: 1,
    })
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9, { allowCached: true })

    expect(cache.syncActiveTabContext).not.toHaveBeenCalled()
    expect(mocks.resolveSeriesData).toHaveBeenCalledOnce()
  })

  it("waits for integration metadata before projecting loading", async () => {
    const cache = createCache()
    let releaseResolution: (() => void) | undefined
    const beforeResolution = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseResolution = resolve
        })
    )
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: cache as never,
      beforeResolution,
    })

    const resolution = resolver.resolveTabContext(9)
    await vi.waitFor(() => expect(beforeResolution).toHaveBeenCalledOnce())
    expect(cache.projectLoadingForTab).not.toHaveBeenCalled()
    expect(mocks.matchUrl).not.toHaveBeenCalled()

    releaseResolution?.()
    await resolution

    expect(beforeResolution).toHaveBeenCalledBefore(cache.projectLoadingForTab)
    expect(cache.projectLoadingForTab).toHaveBeenCalledBefore(mocks.matchUrl)
  })

  it("aborts provider resolution when the context deadline expires", async () => {
    let providerSignal: AbortSignal | undefined
    mocks.resolveSeriesData.mockImplementationOnce(
      (input: { signal?: AbortSignal }) => {
        providerSignal = input.signal
        return new Promise((_, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => reject(input.signal?.reason ?? new Error("aborted")),
            { once: true }
          )
        })
      }
    )
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: createCache() as never,
      resolutionTimeoutMs: 5,
    })

    await resolver.resolveTabContext(9)

    expect(providerSignal).toBeInstanceOf(AbortSignal)
    expect(providerSignal?.aborted).toBe(true)
    expect(mocks.handleInitializeTab).toHaveBeenCalledWith(
      {},
      { context: "error", error: expect.any(String) },
      9,
      { requestId: 4, windowId: 3, supersedeInFlight: true }
    )
  })

  it("resolves provider data and commits a request-scoped tab payload", async () => {
    const cache = createCache()
    const stateManager = {} as never
    const beforeStateMutation = vi.fn(async () => undefined)
    const resolver = createTabContextResolver({
      getStateManager: () => stateManager,
      tabContextCache: cache as never,
      beforeStateMutation,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.resolveSeriesData).toHaveBeenCalledWith({
      siteIntegrationId: "pixiv-comic",
      seriesUrl: "https://comic.pixiv.net/works/123",
      mangadexPreferences: undefined,
      signal: expect.any(AbortSignal),
      onPartial: expect.any(Function),
    })
    expect(mocks.handleInitializeTab).toHaveBeenCalledWith(
      stateManager,
      expect.objectContaining({
        context: "ready",
        mangaId: "123",
        seriesTitle: "A series",
      }),
      9,
      { requestId: 4, windowId: 3 }
    )
    expect(beforeStateMutation).toHaveBeenCalledOnce()
    expect(beforeStateMutation).toHaveBeenCalledBefore(
      mocks.handleInitializeTab
    )
  })

  it("waits for state-manager readiness before committing a partial result", async () => {
    const cache = createCache()
    let releaseStateManager: (() => void) | undefined
    let stateManagerReady = false
    const beforeStateMutation = vi.fn(() => {
      if (stateManagerReady) return Promise.resolve()
      return new Promise<void>((resolve) => {
        releaseStateManager = () => {
          stateManagerReady = true
          resolve()
        }
      })
    })
    const stateManager = {
      getTabState: vi.fn(async () => ({
        siteIntegrationId: "pixiv-comic",
        mangaId: "previous-series",
        seriesTitle: "Previous",
        chapters: [
          {
            id: "previous-chapter",
            title: "Previous chapter",
            url: "https://example.com/previous",
            index: 1,
            status: "queued",
            lastUpdated: 1,
          },
        ],
        volumes: [{ id: "previous-volume", title: "Previous volume" }],
        lastUpdated: 1,
      })),
    }
    const getStateManager = vi.fn(() => {
      if (!stateManagerReady) {
        throw new Error("State manager accessed before readiness")
      }
      return stateManager as never
    })
    mocks.resolveSeriesData.mockImplementationOnce(async (input) => {
      const onPartial = (
        input as {
          onPartial: (value: {
            seriesId: string
            seriesMetadata: { title: string }
          }) => Promise<void>
        }
      ).onPartial
      await onPartial({
        seriesId: "123",
        seriesMetadata: { title: "Partial title" },
      })
      return {
        seriesId: "123",
        seriesMetadata: { title: "Final title" },
        chapterList: { chapters: [], volumes: [] },
      }
    })
    const resolver = createTabContextResolver({
      getStateManager,
      tabContextCache: cache as never,
      beforeStateMutation,
    })

    const resolution = resolver.resolveTabContext(9)
    await vi.waitFor(() => expect(beforeStateMutation).toHaveBeenCalledOnce())
    expect(getStateManager).not.toHaveBeenCalled()

    releaseStateManager?.()
    await resolution

    expect(mocks.handleInitializeTab).toHaveBeenNthCalledWith(
      1,
      stateManager,
      expect.objectContaining({
        context: "ready",
        mangaId: "123",
        chapters: [],
        volumes: undefined,
        chaptersLoading: true,
      }),
      9,
      { requestId: 4, windowId: 3 }
    )
    expect(mocks.handleInitializeTab).toHaveBeenLastCalledWith(
      stateManager,
      expect.objectContaining({
        context: "ready",
        mangaId: "123",
        chaptersLoading: undefined,
      }),
      9,
      { requestId: 4, windowId: 3 }
    )
  })

  it("coalesces callers while provider readiness is pending", async () => {
    const cache = createCache()
    let releaseReadiness: (() => void) | undefined
    const readiness = new Promise<void>((resolve) => {
      releaseReadiness = resolve
    })
    const beforeResolution = vi.fn(() => readiness)
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: cache as never,
      beforeResolution,
    })

    const first = resolver.resolveTabContext(9)
    await vi.waitFor(() => expect(beforeResolution).toHaveBeenCalledOnce())
    const second = resolver.resolveTabContext(9)

    releaseReadiness?.()
    await Promise.all([first, second])

    expect(beforeResolution).toHaveBeenCalledOnce()
    expect(cache.projectLoadingForTab).toHaveBeenCalledOnce()
    expect(mocks.resolveSeriesData).toHaveBeenCalledOnce()
  })

  it("drops a stale provider result before state mutation", async () => {
    const cache = createCache()
    cache.isRequestIdCurrent.mockResolvedValue(false)
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.handleInitializeTab).not.toHaveBeenCalled()
  })

  it("retries once when a newer loading request supersedes a valid result", async () => {
    const cache = createCache()
    cache.isRequestIdCurrent
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.resolveSeriesData).toHaveBeenCalledTimes(2)
    expect(cache.projectLoadingForTab).toHaveBeenCalledTimes(2)
    expect(mocks.handleInitializeTab).toHaveBeenCalledTimes(1)
  })

  it("uses and persists the constrained probe only for enabled MangaDex page preferences", async () => {
    getTab.mockResolvedValue({
      id: 9,
      active: true,
      windowId: 3,
      url: "https://mangadex.org/title/12345678-1234-1234-1234-123456789abc",
    })
    mocks.matchUrl.mockReturnValue({
      integrationId: "mangadex",
      role: "series",
    })
    mocks.executePageProbe.mockResolvedValue({
      url: "https://mangadex.org/title/12345678-1234-1234-1234-123456789abc",
      mangadexPreferences: { dataSaver: false, filteredLanguages: ["en"] },
    })
    mocks.resolveSeriesData.mockResolvedValue({
      seriesId: "12345678-1234-1234-1234-123456789abc",
      seriesMetadata: { title: "MangaDex series" },
      chapterList: [],
    })
    const cache = createCache()
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.executePageProbe).toHaveBeenCalledWith(9, "mangadex")
    expect(mocks.resolveSeriesData).toHaveBeenCalledWith(
      expect.objectContaining({
        mangadexPreferences: expect.objectContaining({
          dataSaver: false,
          filteredLanguages: ["en"],
        }),
      })
    )
    expect(setSession).toHaveBeenCalledWith({
      mangadexUserPreferencesBySeries: {
        "mangadex#12345678-1234-1234-1234-123456789abc": {
          dataSaver: false,
          filteredLanguages: ["en"],
        },
      },
    })
  })

  it("does not inject the MangaDex page probe when auto-read is disabled", async () => {
    mocks.getForSite.mockResolvedValue({ autoReadMangaDexSettings: false })
    getTab.mockResolvedValue({
      id: 9,
      active: true,
      windowId: 3,
      url: "https://mangadex.org/title/12345678-1234-1234-1234-123456789abc",
    })
    mocks.matchUrl.mockReturnValue({
      integrationId: "mangadex",
      role: "series",
    })
    mocks.resolveSeriesData.mockResolvedValue({
      seriesId: "12345678-1234-1234-1234-123456789abc",
      seriesMetadata: { title: "MangaDex series" },
      chapterList: [],
    })
    const cache = createCache()
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.executePageProbe).not.toHaveBeenCalled()
    expect(mocks.resolveSeriesData).toHaveBeenCalledWith(
      expect.objectContaining({ mangadexPreferences: undefined })
    )
    expect(setSession).not.toHaveBeenCalled()
  })

  it("settles the loading projection as an error when provider resolution exceeds its deadline", async () => {
    vi.useFakeTimers()
    try {
      const cache = createCache()
      mocks.resolveSeriesData.mockImplementation(
        () => new Promise(() => undefined)
      )
      const resolver = createTabContextResolver({
        getStateManager: () => ({}) as never,
        tabContextCache: cache as never,
        resolutionTimeoutMs: 10,
      })

      const pending = resolver.resolveTabContext(9)
      await vi.advanceTimersByTimeAsync(20)
      await pending

      expect(mocks.handleInitializeTab).toHaveBeenLastCalledWith(
        expect.anything(),
        {
          context: "error",
          error:
            "This site’s series information could not be loaded. Try again.",
        },
        9,
        { requestId: 4, windowId: 3, supersedeInFlight: true }
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects a late partial result after the resolution deadline", async () => {
    vi.useFakeTimers()
    try {
      const cache = createCache()
      let publishPartial:
        | ((value: {
            seriesId: string
            seriesMetadata: { title: string }
          }) => Promise<void>)
        | undefined
      mocks.resolveSeriesData.mockImplementation(
        (input) =>
          new Promise(() => {
            publishPartial = (
              input as {
                onPartial: typeof publishPartial
              }
            ).onPartial
          })
      )
      const resolver = createTabContextResolver({
        getStateManager: () =>
          ({ getTabState: vi.fn(async () => null) }) as never,
        tabContextCache: cache as never,
        resolutionTimeoutMs: 10,
      })

      const pending = resolver.resolveTabContext(9)
      await vi.advanceTimersByTimeAsync(20)
      await pending
      await publishPartial?.({
        seriesId: "123",
        seriesMetadata: { title: "Too late" },
      })

      expect(mocks.handleInitializeTab).toHaveBeenCalledTimes(1)
      expect(mocks.handleInitializeTab).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ context: "error" }),
        9,
        { requestId: 4, windowId: 3, supersedeInFlight: true }
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("settles a superseded page-probe result instead of retaining loading", async () => {
    getTab.mockResolvedValue({
      id: 9,
      active: true,
      windowId: 3,
      url: "https://www.manhuagui.com/comic/21243/",
    })
    mocks.matchUrl.mockReturnValue({
      integrationId: "manhuagui",
      role: "series",
    })
    mocks.executePageProbe.mockResolvedValue({
      url: "https://www.manhuagui.com/comic/99999/",
      integrationContext: { adultGatePresent: true },
    })
    const cache = createCache()
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.resolveSeriesData).not.toHaveBeenCalled()
    expect(mocks.handleInitializeTab).toHaveBeenCalledWith(
      expect.anything(),
      {
        context: "error",
        error: "This site’s series information could not be loaded. Try again.",
      },
      9,
      { requestId: 4, windowId: 3, supersedeInFlight: true }
    )
  })

  it("fails resolution when a required integration page probe fails", async () => {
    getTab.mockResolvedValue({
      id: 9,
      active: true,
      windowId: 3,
      url: "https://www.manhuagui.com/comic/21243/",
    })
    mocks.matchUrl.mockReturnValue({
      integrationId: "manhuagui",
      role: "series",
    })
    mocks.executePageProbe.mockRejectedValue(
      new Error("page probe unavailable")
    )
    const cache = createCache()
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.resolveSeriesData).not.toHaveBeenCalled()
    expect(mocks.handleInitializeTab).toHaveBeenCalledWith(
      expect.anything(),
      {
        context: "error",
        error: "This site’s series information could not be loaded. Try again.",
      },
      9,
      { requestId: 4, windowId: 3, supersedeInFlight: true }
    )
  })

  it("forwards a validated integration page context only to its owning resolver", async () => {
    getTab.mockResolvedValue({
      id: 9,
      active: true,
      windowId: 3,
      url: "https://www.manhuagui.com/comic/21243/",
    })
    mocks.matchUrl.mockReturnValue({
      integrationId: "manhuagui",
      role: "series",
    })
    mocks.executePageProbe.mockResolvedValue({
      url: "https://www.manhuagui.com/comic/21243/",
      integrationContext: {
        adultGatePresent: false,
        chapterHtml: '<div class="chapter"></div>',
      },
    })
    mocks.resolveSeriesData.mockResolvedValue({
      seriesId: "21243",
      seriesMetadata: { title: "Adult series" },
      chapterList: { chapters: [], volumes: [] },
    })
    const cache = createCache()
    const resolver = createTabContextResolver({
      getStateManager: () => ({}) as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.resolveSeriesData).toHaveBeenCalledWith({
      siteIntegrationId: "manhuagui",
      seriesUrl: "https://www.manhuagui.com/comic/21243/",
      mangadexPreferences: undefined,
      integrationContext: {
        adultGatePresent: false,
        chapterHtml: '<div class="chapter"></div>',
      },
      signal: expect.any(AbortSignal),
      onPartial: expect.any(Function),
    })
  })
})
