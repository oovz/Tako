import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  commitResolvedTabContext: vi.fn(async () => ({ success: true })),
  resolveSeriesData: vi.fn(),
  executePageProbe: vi.fn(),
  getBackgroundSiteAdapterById: vi.fn(),
  matchUrl: vi.fn(),
  getForSite: vi.fn(),
}))

vi.mock("@/entrypoints/background/tab-context-state-service", () => ({
  TabContextStateService: class {},
}))
vi.mock("@/src/runtime/resolve-site-integration-series-data", () => ({
  resolveSiteIntegrationSeriesData: mocks.resolveSeriesData,
}))
vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  getBackgroundSiteAdapterById: mocks.getBackgroundSiteAdapterById,
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
import { createTabContextResolver as createTabContextResolverImpl } from "@/entrypoints/background/tab-context-resolver"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import type { SiteIntegrationSettingsReader } from "@/src/types/site-integrations"

describe("tab context resolver", () => {
  const rateLimitService = {
    resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
    scheduleForIntegrationScope: vi.fn(
      async <T>(
        _integrationId: string,
        _scope: string,
        task: () => Promise<T>
      ) => task()
    ),
    cleanupRateLimiters: vi.fn(),
  } as unknown as RateLimitService
  const siteIntegrationSettingsReader: SiteIntegrationSettingsReader = {
    getAll: vi.fn(async () => ({})),
    getForSite: vi.fn(async () => ({})),
  }
  type ResolverDependencies = Parameters<typeof createTabContextResolverImpl>[0]
  function createTabContextResolver(
    deps: Omit<
      ResolverDependencies,
      "rateLimitService" | "siteIntegrationSettingsReader"
    > &
      Partial<
        Pick<
          ResolverDependencies,
          "rateLimitService" | "siteIntegrationSettingsReader"
        >
      >
  ) {
    return createTabContextResolverImpl({
      ...deps,
      rateLimitService,
      siteIntegrationSettingsReader,
    })
  }
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

  function createStateService() {
    const service = {
      commitResolvedTabContext: (...args: unknown[]) =>
        (mocks.commitResolvedTabContext as (...args: unknown[]) => unknown)(
          service,
          ...args
        ),
      getTabState: vi.fn(async () => null),
    }
    return service
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getForSite.mockResolvedValue({ autoReadMangaDexSettings: true })
    mocks.getBackgroundSiteAdapterById.mockResolvedValue({ background: {} })
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
      sourceUrl: "https://comic.pixiv.net/works/123",
      siteIntegrationId: "pixiv-comic",
      mangaId: "123",
      seriesTitle: "Cached",
      chapters: [],
      volumes: [],
      lastUpdated: 1,
    })
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
      rateLimitService,
      siteIntegrationSettingsReader,
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
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
      rateLimitService,
      siteIntegrationSettingsReader,
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
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
      rateLimitService,
      siteIntegrationSettingsReader,
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
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: createCache() as never,
      resolutionTimeoutMs: 5,
    })

    await resolver.resolveTabContext(9)

    expect(providerSignal).toBeInstanceOf(AbortSignal)
    expect(providerSignal?.aborted).toBe(true)
    expect(mocks.commitResolvedTabContext).toHaveBeenCalledWith(
      expect.anything(),
      { context: "error", error: expect.any(String) },
      9,
      {
        requestId: 4,
        windowId: 3,
        supersedeInFlight: true,
        expectedUrl: "https://comic.pixiv.net/works/123",
        ownerSignal: expect.any(AbortSignal),
      }
    )
  })

  it("resolves provider data and commits a request-scoped tab payload", async () => {
    const cache = createCache()
    const stateManager = {
      commitResolvedTabContext: (...args: unknown[]) =>
        (mocks.commitResolvedTabContext as (...args: unknown[]) => unknown)(
          stateManager,
          ...args
        ),
    } as never
    const beforeStateMutation = vi.fn(async () => undefined)
    const resolver = createTabContextResolver({
      getTabContextStateService: () => stateManager,
      tabContextCache: cache as never,
      beforeStateMutation,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.resolveSeriesData).toHaveBeenCalledWith({
      siteIntegrationId: "pixiv-comic",
      seriesUrl: "https://comic.pixiv.net/works/123",
      pageProbeData: undefined,
      rateLimitService,
      siteIntegrationSettingsReader,
      signal: expect.any(AbortSignal),
      onPartial: expect.any(Function),
    })
    expect(mocks.commitResolvedTabContext).toHaveBeenCalledWith(
      stateManager,
      expect.objectContaining({
        context: "ready",
        mangaId: "123",
        seriesTitle: "A series",
      }),
      9,
      {
        requestId: 4,
        windowId: 3,
        expectedUrl: "https://comic.pixiv.net/works/123",
        ownerSignal: expect.any(AbortSignal),
      }
    )
    expect(beforeStateMutation).toHaveBeenCalledOnce()
    expect(beforeStateMutation).toHaveBeenCalledBefore(
      mocks.commitResolvedTabContext
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
      commitResolvedTabContext: (...args: unknown[]) =>
        (mocks.commitResolvedTabContext as (...args: unknown[]) => unknown)(
          stateManager,
          ...args
        ),
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
    const getTabContextStateService = vi.fn(() => {
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
      getTabContextStateService,
      tabContextCache: cache as never,
      beforeStateMutation,
    })

    const resolution = resolver.resolveTabContext(9)
    await vi.waitFor(() => expect(beforeStateMutation).toHaveBeenCalledOnce())
    expect(getTabContextStateService).not.toHaveBeenCalled()

    releaseStateManager?.()
    await resolution

    expect(mocks.commitResolvedTabContext).toHaveBeenNthCalledWith(
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
      {
        requestId: 4,
        windowId: 3,
        expectedUrl: "https://comic.pixiv.net/works/123",
        ownerSignal: expect.any(AbortSignal),
      }
    )
    expect(mocks.commitResolvedTabContext).toHaveBeenLastCalledWith(
      stateManager,
      expect.objectContaining({
        context: "ready",
        mangaId: "123",
        chaptersLoading: undefined,
      }),
      9,
      {
        requestId: 4,
        windowId: 3,
        expectedUrl: "https://comic.pixiv.net/works/123",
        ownerSignal: expect.any(AbortSignal),
      }
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
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
      rateLimitService,
      siteIntegrationSettingsReader,
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

  it("retries when a source activation coalesces with an owner that observed the tab inactive", async () => {
    const activeTab = {
      id: 9,
      active: true,
      windowId: 3,
      url: "https://comic.pixiv.net/works/123",
    }
    let releaseInactiveRead: (() => void) | undefined
    const inactiveRead = new Promise<typeof activeTab>((resolve) => {
      releaseInactiveRead = () => resolve({ ...activeTab, active: false })
    })
    getTab
      .mockResolvedValueOnce(activeTab)
      .mockReturnValueOnce(inactiveRead)
      .mockResolvedValue(activeTab)
    const cache = createCache()
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
    })

    const first = resolver.resolveTabContext(9)
    await vi.waitFor(() => expect(getTab).toHaveBeenCalledTimes(2))
    const activation = resolver.resolveTabContext(9)
    releaseInactiveRead?.()

    await Promise.all([first, activation])

    expect(mocks.resolveSeriesData).toHaveBeenCalledOnce()
    expect(mocks.commitResolvedTabContext).toHaveBeenCalledOnce()
  })

  it("starts a fresh owner when a new activation supersedes pending work", async () => {
    const cache = createCache()
    let releaseReadiness: (() => void) | undefined
    const readiness = new Promise<void>((resolve) => {
      releaseReadiness = resolve
    })
    const beforeResolution = vi.fn(() => readiness)
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
      beforeResolution,
    })

    const first = resolver.resolveTabContext(9)
    await vi.waitFor(() => expect(beforeResolution).toHaveBeenCalledOnce())
    const second = resolver.resolveTabContext(9, {
      supersedeInFlight: true,
    })
    await vi.waitFor(() => expect(beforeResolution).toHaveBeenCalledTimes(2))

    releaseReadiness?.()
    await Promise.all([first, second])

    expect(cache.projectLoadingForTab).toHaveBeenCalledOnce()
    expect(mocks.resolveSeriesData).toHaveBeenCalledOnce()
  })

  it("does not publish an aborted owner's error over its replacement", async () => {
    const cache = createCache()
    cache.projectLoadingForTab
      .mockResolvedValueOnce({ requestId: 4 })
      .mockResolvedValueOnce({ requestId: 5 })
    mocks.resolveSeriesData.mockImplementationOnce(
      (input: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => reject(input.signal?.reason ?? new Error("aborted")),
            { once: true }
          )
        })
    )
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
    })

    const first = resolver.resolveTabContext(9)
    await vi.waitFor(() =>
      expect(mocks.resolveSeriesData).toHaveBeenCalledOnce()
    )
    const replacement = resolver.resolveTabContext(9, {
      supersedeInFlight: true,
    })

    await Promise.all([first, replacement])

    expect(cache.projectLoadingForTab).toHaveBeenNthCalledWith(2, 9, 3, true)
    expect(mocks.commitResolvedTabContext).toHaveBeenCalledOnce()
    expect(mocks.commitResolvedTabContext).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: "error" }),
      9,
      expect.anything()
    )
  })

  it("does not let a stale retry supersede the newer in-flight owner", async () => {
    const cache = createCache()
    let releaseFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined
    const result = {
      seriesId: "123",
      seriesMetadata: { title: "A series" },
      chapterList: { chapters: [], volumes: [] },
    }
    mocks.resolveSeriesData
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () => resolve(result)
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSecond = () => resolve(result)
          })
      )
    cache.isRequestIdCurrent
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
    })

    const first = resolver.resolveTabContext(9, { supersedeInFlight: true })
    await vi.waitFor(() =>
      expect(mocks.resolveSeriesData).toHaveBeenCalledOnce()
    )
    const second = resolver.resolveTabContext(9, { supersedeInFlight: true })
    await vi.waitFor(() =>
      expect(mocks.resolveSeriesData).toHaveBeenCalledTimes(2)
    )

    releaseFirst?.()
    await vi.waitFor(() => expect(cache.isRequestIdCurrent).toHaveBeenCalled())
    expect(mocks.resolveSeriesData).toHaveBeenCalledTimes(2)

    releaseSecond?.()
    await Promise.all([first, second])
    expect(mocks.resolveSeriesData).toHaveBeenCalledTimes(2)
  })

  it("drops a stale provider result before state mutation", async () => {
    const cache = createCache()
    cache.isRequestIdCurrent.mockResolvedValue(false)
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.commitResolvedTabContext).not.toHaveBeenCalled()
  })

  it("does not resurrect a request superseded by a newer loading revision", async () => {
    const cache = createCache()
    cache.isRequestIdCurrent.mockResolvedValue(false)
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.resolveSeriesData).toHaveBeenCalledOnce()
    expect(cache.projectLoadingForTab).toHaveBeenCalledOnce()
    expect(mocks.commitResolvedTabContext).not.toHaveBeenCalled()
  })

  it("retries against a changed URL while the request still owns the revision", async () => {
    const initialTab = {
      id: 9,
      active: true,
      windowId: 3,
      url: "https://comic.pixiv.net/works/123",
    }
    const navigatedTab = {
      ...initialTab,
      url: "https://comic.pixiv.net/works/456",
    }
    getTab
      .mockResolvedValueOnce(initialTab)
      .mockResolvedValueOnce(initialTab)
      .mockResolvedValueOnce(navigatedTab)
      .mockResolvedValue(navigatedTab)
    const cache = createCache()
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.resolveSeriesData).toHaveBeenCalledTimes(2)
    expect(cache.projectLoadingForTab).toHaveBeenCalledTimes(2)
    expect(mocks.commitResolvedTabContext).toHaveBeenCalledOnce()
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
    mocks.getBackgroundSiteAdapterById.mockResolvedValueOnce({
      background: {
        shouldExecutePageProbe: vi.fn(async () => true),
        persistPageProbeData: vi.fn(async () => undefined),
      },
    })
    mocks.executePageProbe.mockResolvedValue({
      url: "https://mangadex.org/title/12345678-1234-1234-1234-123456789abc",
      data: { dataSaver: false, filteredLanguages: ["en"] },
    })
    mocks.resolveSeriesData.mockResolvedValue({
      seriesId: "12345678-1234-1234-1234-123456789abc",
      seriesMetadata: { title: "MangaDex series" },
      chapterList: [],
    })
    const cache = createCache()
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.executePageProbe).toHaveBeenCalledWith(9, "mangadex")
    expect(mocks.resolveSeriesData).toHaveBeenCalledWith(
      expect.objectContaining({
        pageProbeData: expect.objectContaining({
          dataSaver: false,
          filteredLanguages: ["en"],
        }),
      })
    )
    expect(mocks.getBackgroundSiteAdapterById).toHaveBeenCalledWith("mangadex")
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
    mocks.getBackgroundSiteAdapterById.mockResolvedValueOnce({
      background: { shouldExecutePageProbe: vi.fn(async () => false) },
    })
    mocks.resolveSeriesData.mockResolvedValue({
      seriesId: "12345678-1234-1234-1234-123456789abc",
      seriesMetadata: { title: "MangaDex series" },
      chapterList: [],
    })
    const cache = createCache()
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.executePageProbe).not.toHaveBeenCalled()
    expect(mocks.resolveSeriesData).toHaveBeenCalledWith(
      expect.objectContaining({ pageProbeData: undefined })
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
        getTabContextStateService: () => createStateService() as never,
        tabContextCache: cache as never,
        resolutionTimeoutMs: 10,
      })

      const pending = resolver.resolveTabContext(9)
      await vi.advanceTimersByTimeAsync(20)
      await pending

      expect(mocks.commitResolvedTabContext).toHaveBeenLastCalledWith(
        expect.anything(),
        {
          context: "error",
          error:
            "This site’s series information could not be loaded. Try again.",
        },
        9,
        {
          requestId: 4,
          windowId: 3,
          supersedeInFlight: true,
          expectedUrl: "https://comic.pixiv.net/works/123",
          ownerSignal: expect.any(AbortSignal),
        }
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
        getTabContextStateService: () => createStateService() as never,
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

      expect(mocks.commitResolvedTabContext).toHaveBeenCalledTimes(1)
      expect(mocks.commitResolvedTabContext).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ context: "error" }),
        9,
        {
          requestId: 4,
          windowId: 3,
          supersedeInFlight: true,
          expectedUrl: "https://comic.pixiv.net/works/123",
          ownerSignal: expect.any(AbortSignal),
        }
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
    mocks.getBackgroundSiteAdapterById.mockResolvedValueOnce({
      background: {},
    })
    mocks.executePageProbe.mockResolvedValue({
      url: "https://www.manhuagui.com/comic/99999/",
      data: { adultGatePresent: true },
    })
    const cache = createCache()
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.resolveSeriesData).not.toHaveBeenCalled()
    expect(mocks.commitResolvedTabContext).toHaveBeenCalledWith(
      expect.anything(),
      {
        context: "error",
        error: "This site’s series information could not be loaded. Try again.",
      },
      9,
      {
        requestId: 4,
        windowId: 3,
        supersedeInFlight: true,
        expectedUrl: "https://www.manhuagui.com/comic/21243/",
        ownerSignal: expect.any(AbortSignal),
      }
    )
  })

  it("continues when an optional integration page probe fails", async () => {
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
    mocks.getBackgroundSiteAdapterById.mockResolvedValueOnce({
      background: {},
    })
    mocks.executePageProbe.mockRejectedValue(
      new Error("page probe unavailable")
    )
    const cache = createCache()
    const resolver = createTabContextResolver({
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.resolveSeriesData).toHaveBeenCalledOnce()
    expect(mocks.commitResolvedTabContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: "ready" }),
      9,
      {
        requestId: 4,
        windowId: 3,
        expectedUrl: "https://www.manhuagui.com/comic/21243/",
        ownerSignal: expect.any(AbortSignal),
      }
    )
  })

  it("continues base MangaDex resolution when optional probe settings time out", async () => {
    vi.useFakeTimers()
    try {
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
      mocks.getBackgroundSiteAdapterById.mockResolvedValueOnce({
        background: {
          shouldExecutePageProbe: vi.fn(() => new Promise(() => undefined)),
        },
      })
      const cache = createCache()
      const resolver = createTabContextResolver({
        getTabContextStateService: () => createStateService() as never,
        tabContextCache: cache as never,
        resolutionTimeoutMs: 10,
      })

      const pending = resolver.resolveTabContext(9)
      await vi.advanceTimersByTimeAsync(10)
      await pending

      expect(mocks.executePageProbe).not.toHaveBeenCalled()
      expect(mocks.resolveSeriesData).toHaveBeenCalledOnce()
      expect(mocks.commitResolvedTabContext).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ context: "ready" }),
        9,
        expect.objectContaining({
          requestId: 4,
          windowId: 3,
          ownerSignal: expect.any(AbortSignal),
        })
      )
    } finally {
      vi.useRealTimers()
    }
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
    mocks.getBackgroundSiteAdapterById.mockResolvedValueOnce({
      background: {},
    })
    mocks.executePageProbe.mockResolvedValue({
      url: "https://www.manhuagui.com/comic/21243/",
      data: {
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
      getTabContextStateService: () => createStateService() as never,
      tabContextCache: cache as never,
    })

    await resolver.resolveTabContext(9)

    expect(mocks.resolveSeriesData).toHaveBeenCalledWith({
      siteIntegrationId: "manhuagui",
      seriesUrl: "https://www.manhuagui.com/comic/21243/",
      pageProbeData: {
        adultGatePresent: false,
        chapterHtml: '<div class="chapter"></div>',
      },
      rateLimitService,
      siteIntegrationSettingsReader,
      signal: expect.any(AbortSignal),
      onPartial: expect.any(Function),
    })
  })
})
