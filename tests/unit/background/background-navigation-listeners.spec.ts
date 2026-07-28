import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/src/runtime/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/src/site-integrations/url-matcher", () => ({
  matchUrl: vi.fn((url: string) =>
    url.includes("/title/")
      ? { integrationId: "mangadex", role: "series" }
      : null
  ),
}))

import { registerBackgroundNavigationListeners } from "@/entrypoints/background/background-navigation-listeners"
import logger from "@/src/runtime/logger"
import { matchUrl } from "@/src/site-integrations/url-matcher"

describe("background navigation listeners", () => {
  const onUpdated = vi.fn()
  const onActivated = vi.fn()
  const onCommitted = vi.fn()
  const onDOMContentLoaded = vi.fn()
  const onHistoryStateUpdated = vi.fn()
  const queryTabs = vi.fn()
  const getTab = vi.fn()
  const getSession = vi.fn(async () => ({}))
  const removeSession = vi.fn(async () => undefined)

  function createDependencies() {
    const clearTabState = vi.fn(async () => undefined)
    return {
      ensureSiteIntegrationMetadataInitialized: vi.fn(async () => undefined),
      ensureStateManagerInitialized: vi.fn(async () => undefined),
      getStateManager: vi.fn(() => ({ clearTabState }) as never),
      clearTabState,
      tabContextCache: {
        handleTabActivated: vi.fn(async () => undefined),
        handleTabUpdated: vi.fn(async (): Promise<void> => {}),
        setCachedContext: vi.fn(),
        deleteCachedContext: vi.fn(),
        getCachedContext: vi.fn<() => unknown>(() => undefined),
        syncActiveTabContext: vi.fn(async () => undefined),
        projectLoadingForTab: vi.fn(async () => ({ requestId: 1 })),
      },
      tabContextResolver: {
        resolveTabContext: vi.fn(async () => undefined),
      },
      tabUiCoordinator: {
        updateActionForTab: vi.fn(async () => undefined),
        updateSidePanelForTab: vi.fn(async () => undefined),
      },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(matchUrl).mockImplementation((url: string) =>
      url.includes("/title/")
        ? { integrationId: "mangadex", role: "series" }
        : null
    )
    queryTabs.mockResolvedValue([])
    getSession.mockResolvedValue({})
    getTab.mockResolvedValue({
      id: 7,
      active: true,
      windowId: 2,
      url: "https://mangadex.org/title/series-1",
    })
    vi.stubGlobal("chrome", {
      tabs: {
        onUpdated: { addListener: onUpdated },
        onActivated: { addListener: onActivated },
        query: queryTabs,
        get: getTab,
      },
      webNavigation: {
        onCommitted: { addListener: onCommitted },
        onDOMContentLoaded: { addListener: onDOMContentLoaded },
        onHistoryStateUpdated: { addListener: onHistoryStateUpdated },
      },
      storage: {
        session: {
          get: getSession,
          remove: removeSession,
        },
      },
    })
  })

  it("projects loading on navigation and resolves only after completion", async () => {
    const deps = createDependencies()
    registerBackgroundNavigationListeners(deps)
    const listener = onUpdated.mock.calls[0][0] as (
      tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab
    ) => void
    const tab = {
      id: 7,
      active: true,
      windowId: 2,
      url: "https://mangadex.org/title/series-1",
    } as chrome.tabs.Tab

    listener(7, { status: "loading" }, tab)
    await vi.waitFor(() =>
      expect(deps.tabContextCache.projectLoadingForTab).toHaveBeenCalledWith(
        7,
        2
      )
    )
    expect(deps.tabContextResolver.resolveTabContext).not.toHaveBeenCalled()

    listener(7, { status: "complete" }, tab)
    await vi.waitFor(() =>
      expect(deps.tabContextResolver.resolveTabContext).toHaveBeenCalledWith(
        7,
        {
          windowId: 2,
          allowCached: false,
        }
      )
    )
  })

  it("serializes a loading projection before a following complete event resolves", async () => {
    const deps = createDependencies()
    let releaseLoadingUpdate: (() => void) | undefined
    deps.tabContextCache.handleTabUpdated.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseLoadingUpdate = resolve
        })
    )
    registerBackgroundNavigationListeners(deps)
    const listener = onUpdated.mock.calls[0][0] as (
      tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab
    ) => void
    const tab = {
      id: 7,
      active: true,
      windowId: 2,
      url: "https://mangadex.org/title/series-1",
    } as chrome.tabs.Tab

    listener(7, { status: "loading" }, tab)
    listener(7, { status: "complete" }, tab)

    await vi.waitFor(() =>
      expect(deps.tabContextCache.handleTabUpdated).toHaveBeenCalledTimes(1)
    )
    expect(deps.tabContextResolver.resolveTabContext).not.toHaveBeenCalled()

    releaseLoadingUpdate?.()

    await vi.waitFor(() =>
      expect(deps.tabContextResolver.resolveTabContext).toHaveBeenCalledTimes(1)
    )
    expect(
      deps.tabContextCache.projectLoadingForTab.mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.tabContextResolver.resolveTabContext.mock.invocationCallOrder[0]
    )
  })

  it("starts supported active-tab resolution at top-frame DOM readiness", async () => {
    const deps = createDependencies()
    registerBackgroundNavigationListeners(deps)
    const listener = onDOMContentLoaded.mock.calls[0][0] as (details: {
      tabId: number
      frameId: number
      url: string
    }) => void

    listener({
      tabId: 7,
      frameId: 0,
      url: "https://mangadex.org/title/series-1",
    })

    await vi.waitFor(() =>
      expect(deps.tabContextResolver.resolveTabContext).toHaveBeenCalledWith(
        7,
        { windowId: 2, allowCached: false }
      )
    )
  })

  it("waits for stored integration enablement before classifying MangaDex navigation", async () => {
    const deps = createDependencies()
    let hydrated = false
    let releaseMetadata: (() => void) | undefined
    const metadataReady = new Promise<undefined>((resolve) => {
      releaseMetadata = () => {
        hydrated = true
        resolve(undefined)
      }
    })
    deps.ensureSiteIntegrationMetadataInitialized.mockReturnValue(metadataReady)
    vi.mocked(matchUrl).mockImplementation((url: string) =>
      hydrated && url.includes("/title/")
        ? { integrationId: "mangadex", role: "series" }
        : null
    )
    registerBackgroundNavigationListeners(deps)
    const updatedListener = onUpdated.mock.calls[0][0] as (
      tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab
    ) => void
    const domReadyListener = onDOMContentLoaded.mock.calls[0][0] as (details: {
      tabId: number
      frameId: number
      url: string
    }) => void
    const tab = {
      id: 7,
      active: true,
      windowId: 2,
      url: "https://mangadex.org/title/series-1",
    } as chrome.tabs.Tab

    updatedListener(7, { status: "loading" }, tab)
    domReadyListener({
      tabId: 7,
      frameId: 0,
      url: tab.url!,
    })

    await Promise.resolve()
    expect(deps.clearTabState).not.toHaveBeenCalled()
    expect(deps.tabContextResolver.resolveTabContext).not.toHaveBeenCalled()

    releaseMetadata?.()

    await vi.waitFor(() =>
      expect(deps.tabContextResolver.resolveTabContext).toHaveBeenCalledOnce()
    )
    expect(deps.clearTabState).not.toHaveBeenCalled()
    expect(matchUrl).toHaveBeenCalled()
  })

  it("starts DOM-ready resolution before full runtime startup settles", async () => {
    const deps = createDependencies()
    let releaseInitialization: (() => void) | undefined
    deps.ensureStateManagerInitialized.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseInitialization = () => resolve(undefined)
        })
    )
    registerBackgroundNavigationListeners(deps)
    const listener = onDOMContentLoaded.mock.calls[0][0] as (details: {
      tabId: number
      frameId: number
      url: string
    }) => void

    listener({
      tabId: 7,
      frameId: 0,
      url: "https://mangadex.org/title/series-1",
    })

    await vi.waitFor(() =>
      expect(deps.tabContextResolver.resolveTabContext).toHaveBeenCalledWith(
        7,
        { windowId: 2, allowCached: false }
      )
    )

    releaseInitialization?.()
  })

  it("does not let a complete update reproject an in-flight DOM-ready resolution", async () => {
    const deps = createDependencies()
    registerBackgroundNavigationListeners(deps)
    const domReadyListener = onDOMContentLoaded.mock.calls[0][0] as (details: {
      tabId: number
      frameId: number
      url: string
    }) => void
    const updatedListener = onUpdated.mock.calls[0][0] as (
      tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab
    ) => void
    const tab = {
      id: 7,
      active: true,
      windowId: 2,
      url: "https://mangadex.org/title/series-1",
    } as chrome.tabs.Tab

    domReadyListener({
      tabId: 7,
      frameId: 0,
      url: "https://mangadex.org/title/series-1",
    })
    await vi.waitFor(() =>
      expect(deps.tabContextResolver.resolveTabContext).toHaveBeenCalledTimes(1)
    )

    updatedListener(7, { status: "complete" }, tab)

    await vi.waitFor(() =>
      expect(deps.tabUiCoordinator.updateSidePanelForTab).toHaveBeenCalledWith(
        7
      )
    )
    expect(deps.tabContextCache.handleTabUpdated).not.toHaveBeenCalled()
    expect(deps.tabContextCache.projectLoadingForTab).not.toHaveBeenCalled()
  })

  it("does not refetch on completion after a context has already resolved", async () => {
    const deps = createDependencies()
    deps.tabContextCache.getCachedContext.mockReturnValue({
      siteIntegrationId: "mangadex",
    })
    registerBackgroundNavigationListeners(deps)
    const listener = onUpdated.mock.calls[0][0] as (
      tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab
    ) => void

    listener(7, { status: "complete" }, {
      id: 7,
      active: true,
      windowId: 2,
      url: "https://mangadex.org/title/series-1",
    } as chrome.tabs.Tab)

    await vi.waitFor(() =>
      expect(deps.tabUiCoordinator.updateSidePanelForTab).toHaveBeenCalledWith(
        7
      )
    )
    expect(deps.tabContextCache.handleTabUpdated).not.toHaveBeenCalled()
    expect(deps.tabContextResolver.resolveTabContext).not.toHaveBeenCalled()
  })

  it("resolves an activated tab loading-first with cache allowed", async () => {
    const deps = createDependencies()
    registerBackgroundNavigationListeners(deps)
    const listener = onActivated.mock.calls[0][0] as (
      info: chrome.tabs.OnActivatedInfo
    ) => void

    listener({ tabId: 7, windowId: 2 })
    await vi.waitFor(() =>
      expect(deps.tabContextResolver.resolveTabContext).toHaveBeenCalledWith(
        7,
        {
          windowId: 2,
          allowCached: true,
        }
      )
    )
    await vi.waitFor(() =>
      expect(deps.tabUiCoordinator.updateActionForTab).toHaveBeenCalledWith(
        7,
        "https://mangadex.org/title/series-1"
      )
    )
    expect(logger.debug).toHaveBeenCalledWith(
      "[navigation] Active tab changed",
      expect.objectContaining({
        phase: "received",
        reason: "tabs.onActivated",
        tabId: 7,
        windowId: 2,
      })
    )
    expect(logger.debug).toHaveBeenCalledWith(
      "[navigation] Active tab context resolution finished",
      expect.objectContaining({
        phase: "resolution-finished",
        reason: "tabs.onActivated",
        tabId: 7,
        windowId: 2,
        url: "https://mangadex.org/title/series-1",
        initializationWaitMs: expect.any(Number),
        resolutionMs: expect.any(Number),
        totalMs: expect.any(Number),
      })
    )
  })

  it("logs activation receipt before initialization or provider work settles", async () => {
    const deps = createDependencies()
    let releaseInitialization: (() => void) | undefined
    deps.ensureStateManagerInitialized.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseInitialization = () => resolve(undefined)
        })
    )
    registerBackgroundNavigationListeners(deps)
    const listener = onActivated.mock.calls[0][0] as (
      info: chrome.tabs.OnActivatedInfo
    ) => void

    listener({ tabId: 7, windowId: 2 })

    expect(logger.debug).toHaveBeenCalledWith(
      "[navigation] Active tab changed",
      expect.objectContaining({ phase: "received", tabId: 7, windowId: 2 })
    )
    expect(deps.tabContextResolver.resolveTabContext).toHaveBeenCalledWith(7, {
      windowId: 2,
      allowCached: true,
    })

    releaseInitialization?.()
    await vi.waitFor(() =>
      expect(logger.debug).toHaveBeenCalledWith(
        "[navigation] Active tab initialization synchronized",
        expect.objectContaining({
          phase: "initialization-completed",
          tabId: 7,
          windowId: 2,
        })
      )
    )
  })

  it("re-resolves SPA navigation without messaging a resident content script", async () => {
    const deps = createDependencies()
    registerBackgroundNavigationListeners(deps)
    const listener = onHistoryStateUpdated.mock.calls[0][0] as (details: {
      tabId: number
      frameId: number
      url: string
    }) => void

    listener({
      tabId: 7,
      frameId: 0,
      url: "https://mangadex.org/title/series-2",
    })
    await vi.waitFor(() =>
      expect(deps.tabContextResolver.resolveTabContext).toHaveBeenCalledWith(
        7,
        {
          windowId: 2,
          allowCached: false,
        }
      )
    )
    expect(deps.clearTabState).toHaveBeenCalledWith(7)
    expect(removeSession).toHaveBeenCalledWith(["seriesContextError_7"])
  })

  it("does not let a stale committed URL clear newer supported tab state", async () => {
    const deps = createDependencies()
    let releaseInitialization: (() => void) | undefined
    deps.ensureStateManagerInitialized.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseInitialization = () => resolve(undefined)
        })
    )
    getSession.mockResolvedValue({
      tab_7: {
        siteIntegrationId: "mangadex",
        mangaId: "new-series",
        seriesTitle: "New Series",
        chapters: [],
        volumes: [],
        lastUpdated: 2,
      },
    })
    registerBackgroundNavigationListeners(deps)
    const listener = onCommitted.mock.calls[0][0] as (details: {
      tabId: number
      frameId: number
      url: string
    }) => void

    listener({
      tabId: 7,
      frameId: 0,
      url: "https://example.com/old-unsupported-page",
    })
    await vi.waitFor(() =>
      expect(deps.ensureStateManagerInitialized).toHaveBeenCalledTimes(1)
    )

    getTab.mockResolvedValue({
      id: 7,
      active: true,
      windowId: 2,
      url: "https://mangadex.org/title/new-series",
    })
    releaseInitialization?.()

    await vi.waitFor(() =>
      expect(deps.tabUiCoordinator.updateActionForTab).toHaveBeenCalledWith(
        7,
        "https://mangadex.org/title/new-series"
      )
    )
    expect(deps.clearTabState).not.toHaveBeenCalled()
    expect(deps.tabContextCache.setCachedContext).not.toHaveBeenCalled()
    expect(deps.tabContextCache.deleteCachedContext).not.toHaveBeenCalled()
    expect(removeSession).not.toHaveBeenCalled()
  })

  it("resolves active tabs discovered during service-worker startup", async () => {
    queryTabs.mockResolvedValue([
      {
        id: 8,
        active: true,
        windowId: 3,
        url: "https://mangadex.org/title/series-3",
      },
    ])
    const deps = createDependencies()
    registerBackgroundNavigationListeners(deps)

    await vi.waitFor(() =>
      expect(deps.tabContextResolver.resolveTabContext).toHaveBeenCalledWith(
        8,
        {
          windowId: 3,
          allowCached: true,
        }
      )
    )
  })
})
