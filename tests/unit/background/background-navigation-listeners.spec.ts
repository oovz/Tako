import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/src/site-integrations/url-matcher', () => ({
  matchUrl: vi.fn((url: string) => (
    url.includes('/title/')
      ? { integrationId: 'mangadex', role: 'series' }
      : null
  )),
}))

import { registerBackgroundNavigationListeners } from '@/entrypoints/background/background-navigation-listeners'

describe('registerBackgroundNavigationListeners', () => {
  const tabsOnUpdatedAddListener = vi.fn()
  const tabsOnActivatedAddListener = vi.fn()
  const webNavigationOnCommittedAddListener = vi.fn()
  const webNavigationOnHistoryStateUpdatedAddListener = vi.fn()
  const storageGet = vi.fn()
  const storageRemove = vi.fn()
  const tabsQuery = vi.fn()
  const tabsGet = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    storageGet.mockResolvedValue({})
    storageRemove.mockResolvedValue(undefined)
    tabsQuery.mockResolvedValue([])
    tabsGet.mockResolvedValue(undefined)

    vi.stubGlobal('chrome', {
      tabs: {
        onUpdated: {
          addListener: tabsOnUpdatedAddListener,
        },
        onActivated: {
          addListener: tabsOnActivatedAddListener,
        },
        query: tabsQuery,
        get: tabsGet,
      },
      webNavigation: {
        onCommitted: {
          addListener: webNavigationOnCommittedAddListener,
        },
        onHistoryStateUpdated: {
          addListener: webNavigationOnHistoryStateUpdatedAddListener,
        },
      },
      storage: {
        session: {
          get: storageGet,
          remove: storageRemove,
        },
      },
    })
  })

  it('treats supported SPA navigations as a no-op so refresh remains the recovery path', async () => {
    const clearTabState = vi.fn(async () => undefined)
    const deleteCachedContext = vi.fn()
    const syncActiveTabContext = vi.fn(async () => undefined)
    const ensureContentScriptPresent = vi.fn(async () => undefined)

    storageGet.mockResolvedValue({
      tab_9: {
        siteIntegrationId: 'mangadex',
        mangaId: 'old-series',
        seriesTitle: 'Old Series',
      },
    })

    registerBackgroundNavigationListeners({
      ensureStateManagerInitialized: async () => undefined,
      getStateManager: () => ({
        clearTabState,
      }) as never,
      tabContextCache: {
        handleTabActivated: vi.fn(async () => undefined),
        handleTabUpdated: vi.fn(async () => undefined),
        setCachedContext: vi.fn(),
        deleteCachedContext,
        syncActiveTabContext,
      },
      tabUiCoordinator: {
        ensureContentScriptPresent,
        updateActionForTab: vi.fn(async () => undefined),
        updateSidePanelForTab: vi.fn(async () => undefined),
      },
    })

    const historyListener = webNavigationOnHistoryStateUpdatedAddListener.mock.calls[0]?.[0] as (details: {
      tabId: number
      frameId: number
      url?: string
    }) => void

    historyListener({
      tabId: 9,
      frameId: 0,
      url: 'https://mangadex.org/title/new-series?tab=chapters&order=asc',
    })

    await Promise.resolve()

    expect(deleteCachedContext).not.toHaveBeenCalled()
    expect(storageRemove).not.toHaveBeenCalled()
    expect(syncActiveTabContext).not.toHaveBeenCalled()
    expect(ensureContentScriptPresent).not.toHaveBeenCalled()
    expect(clearTabState).not.toHaveBeenCalled()
  })
})
