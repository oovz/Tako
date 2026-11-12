import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  reconcileIntegrationSupportAfterPermissionRemoval,
  registerBackgroundNavigationListeners,
} from "@/entrypoints/background/background-navigation-listeners"

vi.mock("@/src/runtime/logger", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/src/site-integrations/url-matcher", () => ({
  matchUrl: (url: string) =>
    url.includes("mangadex.org/title/")
      ? { integrationId: "mangadex", role: "series" }
      : null,
}))

const supportedUrl = "https://mangadex.org/title/series"
const unsupportedUrl = "https://example.com/other"
const tab = { id: 7, windowId: 2, active: true, url: supportedUrl }
const committed =
  vi.fn<
    (
      callback: (details: {
        tabId: number
        frameId: number
        url: string
      }) => void
    ) => void
  >()
const history =
  vi.fn<
    (
      callback: (details: {
        tabId: number
        frameId: number
        url: string
      }) => void
    ) => void
  >()
const activated =
  vi.fn<(callback: (details: chrome.tabs.OnActivatedInfo) => void) => void>()
const getTab = vi.fn()

function dependencies() {
  const clear = vi.fn(async () => true)
  const resolve = vi.fn(async () => undefined)
  const action = vi.fn(
    async (_tabId: number, _url?: string | null) => undefined
  )
  const cached = vi.fn()
  const deps = {
    ensureIntegrationsReady: async () => undefined,
    getTabContextStateService: () => ({ clearTabState: clear }) as never,
    tabContextCache: {
      handleTabActivated: async () => undefined,
      handleTabUpdated: async () => undefined,
      setCachedContext: cached,
      syncActiveTabContext: async () => undefined,
      projectLoadingForTab: async () => ({ requestId: 1 }),
    },
    tabContextResolver: { resolveTabContext: resolve },
    tabUiCoordinator: {
      updateActionForTab: action,
    },
  } satisfies Parameters<typeof registerBackgroundNavigationListeners>[0]
  return { deps, clear, resolve, action, cached }
}

beforeEach(() => {
  vi.clearAllMocks()
  getTab.mockResolvedValue(tab)
  vi.stubGlobal("chrome", {
    tabs: {
      get: getTab,
      query: async () => [],
      onUpdated: { addListener: vi.fn() },
      onActivated: { addListener: activated },
    },
    webNavigation: {
      onCommitted: { addListener: committed },
      onHistoryStateUpdated: { addListener: history },
      onDOMContentLoaded: { addListener: vi.fn() },
    },
  })
})

describe("navigation cleanup ownership", () => {
  it("clears an unsupported committed page only after rechecking its current URL", async () => {
    const { deps, clear, cached } = dependencies()
    getTab.mockResolvedValue({ ...tab, url: unsupportedUrl })
    registerBackgroundNavigationListeners(deps)
    committed.mock.calls[0][0]({ tabId: 7, frameId: 0, url: unsupportedUrl })
    await vi.waitFor(() => expect(cached).toHaveBeenCalledWith(7, null))
    expect(clear).toHaveBeenCalledWith(7, {
      windowId: 2,
      expectedUrl: unsupportedUrl,
      supersedeInFlight: true,
    })
  })
  it("keeps a newer supported page when the committed cleanup snapshot becomes stale", async () => {
    const { deps, clear, action } = dependencies()
    getTab
      .mockResolvedValueOnce({ ...tab, url: unsupportedUrl })
      .mockResolvedValue(tab)
    registerBackgroundNavigationListeners(deps)
    committed.mock.calls[0][0]({ tabId: 7, frameId: 0, url: unsupportedUrl })
    await vi.waitFor(() => expect(getTab).toHaveBeenCalledTimes(2))
    expect(action).toHaveBeenCalledWith(7, unsupportedUrl)
    expect(clear).not.toHaveBeenCalled()
  })
  it("stops SPA projection and resolution when the state owner rejects its URL", async () => {
    const { deps, clear, cached, resolve } = dependencies()
    clear.mockResolvedValue(false)
    registerBackgroundNavigationListeners(deps)
    history.mock.calls[0][0]({ tabId: 7, frameId: 0, url: supportedUrl })
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce())
    expect(cached).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })
  it("does not clear SPA state when the tab has moved to a different URL", async () => {
    const { deps, clear, action } = dependencies()
    getTab.mockResolvedValue({ ...tab, url: unsupportedUrl })
    registerBackgroundNavigationListeners(deps)
    history.mock.calls[0][0]({ tabId: 7, frameId: 0, url: supportedUrl })
    await vi.waitFor(() => expect(action).toHaveBeenCalledWith(7, supportedUrl))
    expect(clear).not.toHaveBeenCalled()
  })
  it("clears activation availability when context resolution fails", async () => {
    const { deps, resolve, action } = dependencies()
    resolve.mockRejectedValue(new Error("readiness failed"))
    registerBackgroundNavigationListeners(deps)
    activated.mock.calls[0][0]({ tabId: 7, windowId: 2 })
    await vi.waitFor(() => expect(action).toHaveBeenCalledWith(7, null))
  })
  it("handles activation before Chrome exposes a tab URL", async () => {
    const { deps, resolve, action } = dependencies()
    getTab.mockResolvedValue({ ...tab, url: undefined })
    registerBackgroundNavigationListeners(deps)
    activated.mock.calls[0][0]({ tabId: 7, windowId: 2 })
    await vi.waitFor(() => expect(action).toHaveBeenCalledWith(7, null))
    expect(resolve).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ windowId: 2, allowCached: true })
    )
  })
})

describe("permission removal support refresh", () => {
  it("waits for integration and runtime readiness, then refreshes every valid tab despite individual failures", async () => {
    let release!: () => void
    const refreshIntegrations = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const ensureRuntimeReady = vi.fn(async () => undefined)
    const query = vi.fn(async () => [
      { ...tab },
      { ...tab, id: 8, active: false },
      { windowId: 2 },
    ])
    Object.assign(chrome.tabs, { query })
    const { deps, action, resolve } = dependencies()
    action.mockImplementation(async (tabId: number) => {
      if (tabId === 8) throw new Error("tab closed")
      return undefined
    })
    const operation = reconcileIntegrationSupportAfterPermissionRemoval({
      refreshIntegrations,
      ensureRuntimeReady,
      tabUiCoordinator: deps.tabUiCoordinator,
      tabContextResolver: deps.tabContextResolver,
    })
    expect(ensureRuntimeReady).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
    release()
    await operation
    expect(ensureRuntimeReady).toHaveBeenCalledOnce()
    expect(action).toHaveBeenCalledTimes(2)
    expect(resolve).toHaveBeenCalledExactlyOnceWith(7, {
      windowId: 2,
      allowCached: false,
    })
  })
  it("propagates readiness failure before reading tabs", async () => {
    const { deps, action } = dependencies()
    const query = vi.fn(async () => [])
    Object.assign(chrome.tabs, { query })
    await expect(
      reconcileIntegrationSupportAfterPermissionRemoval({
        refreshIntegrations: async () => {
          throw new Error("permission reload failed")
        },
        ensureRuntimeReady: async () => undefined,
        tabUiCoordinator: deps.tabUiCoordinator,
        tabContextResolver: deps.tabContextResolver,
      })
    ).rejects.toThrow("permission reload failed")
    expect(query).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })
})
