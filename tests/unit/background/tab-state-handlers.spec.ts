import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleClearTabState, handleInitializeTab } from '@/entrypoints/background/action-handlers/tab-state-handlers'
import { tabContextCache } from '@/entrypoints/background/tab-cache'
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'

const activeTabState = {
  siteIntegrationId: 'mangadex',
  mangaId: 'active-series',
  seriesTitle: 'Active Series',
  chapters: [],
  volumes: [],
  lastUpdated: 1,
}

describe('handleInitializeTab', () => {
  const sessionStore: Record<string, unknown> = {}
  const sessionSet = vi.fn<(values: Record<string, unknown>) => Promise<void>>(async () => {})
  const sessionRemove = vi.fn<(keys: string | string[]) => Promise<void>>(async () => {})
  const sessionGet = vi.fn<(keys: string | string[]) => Promise<Record<string, unknown>>>(async () => ({}))
  let activeTabId = 5
  let getTabMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(sessionStore).forEach((key) => delete sessionStore[key])
    activeTabId = 5
    sessionStore.tab_5 = activeTabState
    getTabMock = vi.fn(async (tabId: number) => ({
      id: tabId,
      url: tabId === activeTabId
        ? 'https://mangadex.org/title/active-series'
        : 'https://mangadex.org/title/inactive-series',
    }))
    ;[5, 6, 9, 15, 16, 21].forEach((tabId) => tabContextCache.deleteCachedContext(tabId))

    sessionSet.mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(sessionStore, values)
    })

    sessionRemove.mockImplementation(async (keys: string | string[]) => {
      const keysToRemove = Array.isArray(keys) ? keys : [keys]
      keysToRemove.forEach((key) => {
        delete sessionStore[key]
      })
    })

    sessionGet.mockImplementation(async (keys: string | string[]) => {
      const result: Record<string, unknown> = {}
      const keysToRead = Array.isArray(keys) ? keys : [keys]
      keysToRead.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(sessionStore, key)) {
          result[key] = sessionStore[key]
        }
      })
      return result
    })

    ;(globalThis as { chrome?: unknown }).chrome = {
      storage: {
        session: {
          get: sessionGet,
          set: sessionSet,
          remove: sessionRemove,
        },
      },
      tabs: {
        query: vi.fn(async () => [{ id: activeTabId }]),
        get: getTabMock,
      },
    }
  })

  it('handles discriminated unsupported payload by clearing activeTabContext', async () => {
    const stateManager = {
      initializeTabState: vi.fn(),
      getTabState: vi.fn(),
    } as unknown as CentralizedStateManager

    const result = await handleInitializeTab(stateManager, { context: 'unsupported' }, 15)

    expect(result).toEqual({ success: true, tabState: null })
    expect(sessionRemove).toHaveBeenCalledWith(['tab_15', 'seriesContextError_15'])
    expect(sessionSet).toHaveBeenCalledWith({ [SESSION_STORAGE_KEYS.activeTabContext]: activeTabState })
    expect((stateManager.initializeTabState as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(0)
  })

  it('handles discriminated error payload by writing error context', async () => {
    const stateManager = {
      initializeTabState: vi.fn(),
      getTabState: vi.fn(),
    } as unknown as CentralizedStateManager

    const result = await handleInitializeTab(stateManager, { context: 'error', error: 'Site integration failed' }, 16)

    expect(result).toEqual({ success: true, tabState: { error: 'Site integration failed' } })
    expect(sessionRemove).toHaveBeenCalledWith('tab_16')
    expect(sessionSet).toHaveBeenCalledWith({ ['seriesContextError_16']: 'Site integration failed' })
  })

  it('maps contract payload fields and writes activeTabContext from tab state', async () => {
    activeTabId = 9
    const tabState = {
      siteIntegrationId: 'mangadex',
      mangaId: 'series-1',
      seriesTitle: 'Series 1',
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const stateManager = {
      initializeTabState: vi.fn(async () => {}),
      getTabState: vi.fn(async () => tabState),
    } as unknown as CentralizedStateManager

    const result = await handleInitializeTab(
      stateManager,
      {
        context: 'ready',
        siteIntegrationId: 'mangadex',
        mangaId: 'series-1',
        seriesTitle: 'Series 1',
        chapters: [
          {
            id: 'chapter-1',
            url: 'https://mangadex.org/chapter/1',
            title: 'Chapter 1',
            chapterLabel: 'Ch. 1',
            chapterNumber: 1,
            volumeNumber: 2,
          },
        ],
      },
      9,
    )

    expect(result).toEqual({ success: true, tabState })
    expect(stateManager.initializeTabState).toHaveBeenCalledWith(
      9,
      'mangadex',
      'series-1',
      'Series 1',
      [
        {
          id: 'chapter-1',
          url: 'https://mangadex.org/chapter/1',
          title: 'Chapter 1',
          locked: false,
          index: 1,
          chapterLabel: 'Ch. 1',
          language: undefined,
          chapterNumber: 1,
          volumeNumber: 2,
          volumeLabel: undefined,
        },
      ],
      undefined,
      undefined,
    )
    expect(sessionRemove).toHaveBeenCalledWith('seriesContextError_9')
    expect(sessionSet).toHaveBeenLastCalledWith({ [SESSION_STORAGE_KEYS.activeTabContext]: tabState })
  })

  it('forwards explicit integration-provided volumes to the state manager', async () => {
    activeTabId = 9
    const tabState = {
      siteIntegrationId: 'shonenjumpplus',
      mangaId: 'series-with-custom-volumes',
      seriesTitle: 'Series With Custom Volumes',
      chapters: [],
      volumes: [
        { id: 'custom-volume-b', title: 'Arc B', label: 'Arc B' },
        { id: 'custom-volume-a', title: 'Arc A', label: 'Arc A' },
      ],
      lastUpdated: Date.now(),
    }

    const stateManager = {
      initializeTabState: vi.fn(async () => {}),
      getTabState: vi.fn(async () => tabState),
    } as unknown as CentralizedStateManager

    const result = await handleInitializeTab(
      stateManager,
      {
        context: 'ready',
        siteIntegrationId: 'shonenjumpplus',
        mangaId: 'series-with-custom-volumes',
        seriesTitle: 'Series With Custom Volumes',
        chapters: [
          {
            id: 'chapter-1',
            url: 'https://shonenjumpplus.com/episode/1',
            title: 'Chapter 1',
            volumeNumber: 2,
            volumeLabel: 'Arc B',
          },
        ],
        volumes: [
          { id: 'custom-volume-b', title: 'Arc B', label: 'Arc B' },
          { id: 'custom-volume-a', title: 'Arc A', label: 'Arc A' },
        ],
      },
      9,
    )

    expect(result).toEqual({ success: true, tabState })
    expect(stateManager.initializeTabState).toHaveBeenCalledWith(
      9,
      'shonenjumpplus',
      'series-with-custom-volumes',
      'Series With Custom Volumes',
      [
        {
          id: 'chapter-1',
          url: 'https://shonenjumpplus.com/episode/1',
          title: 'Chapter 1',
          locked: false,
          index: 1,
          chapterLabel: undefined,
          chapterNumber: undefined,
          volumeNumber: 2,
          volumeLabel: 'Arc B',
        },
      ],
      undefined,
      [
        { id: 'custom-volume-b', title: 'Arc B', label: 'Arc B' },
        { id: 'custom-volume-a', title: 'Arc A', label: 'Arc A' },
      ],
    )
  })

  it('does not clobber the current activeTabContext when initializing an inactive tab', async () => {
    const tabState = {
      siteIntegrationId: 'mangadex',
      mangaId: 'inactive-series',
      seriesTitle: 'Inactive Series',
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    }

    const stateManager = {
      initializeTabState: vi.fn(async () => {}),
      getTabState: vi.fn(async (requestedTabId: number) => requestedTabId === 9 ? tabState : activeTabState),
    } as unknown as CentralizedStateManager

    ;(chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 5 }])

    const result = await handleInitializeTab(
      stateManager,
      {
        context: 'ready',
        siteIntegrationId: 'mangadex',
        mangaId: 'inactive-series',
        seriesTitle: 'Inactive Series',
        chapters: [],
      },
      9,
    )

    expect(result).toEqual({ success: true, tabState })
    expect(sessionStore.tab_5).toEqual(activeTabState)
    expect(sessionSet).toHaveBeenCalledWith({ [SESSION_STORAGE_KEYS.activeTabContext]: activeTabState })
    expect(sessionSet).not.toHaveBeenCalledWith({ [SESSION_STORAGE_KEYS.activeTabContext]: tabState })
  })

  it('rejects malformed INITIALIZE_TAB payloads outside the discriminated union contract', async () => {
    const stateManager = {
      initializeTabState: vi.fn(async () => {}),
      getTabState: vi.fn(async () => null),
    } as unknown as CentralizedStateManager

    const result = await handleInitializeTab(
      stateManager,
      {
        context: 'ready',
        siteIntegrationId: 'mangadex',
        mangaId: 'series-1',
        seriesTitle: 'Series 1',
        chapters: [
          {
            id: '',
            url: 'https://mangadex.org/chapter/1',
            title: 'Chapter 1',
          },
        ],
      } as never,
      9,
    )

    expect(result).toEqual({ success: false })
    expect(sessionRemove).toHaveBeenCalledWith('tab_9')
    expect(sessionSet).toHaveBeenCalledWith({ ['seriesContextError_9']: 'Invalid INITIALIZE_TAB payload' })
    expect(stateManager.initializeTabState).not.toHaveBeenCalled()
  })

  it('propagates locked chapters as non-selectable in initialized tab state', async () => {
    const stateManager = {
      initializeTabState: vi.fn(async () => {}),
      getTabState: vi.fn(async () => null),
    } as unknown as CentralizedStateManager

    await handleInitializeTab(
      stateManager,
      {
        context: 'ready',
        siteIntegrationId: 'mangadex',
        mangaId: 'series-locked',
        seriesTitle: 'Locked Series',
        chapters: [
          {
            id: 'chapter-locked',
            url: 'https://mangadex.org/chapter/locked',
            title: 'Chapter Locked',
            locked: true,
          },
          {
            id: 'chapter-open',
            url: 'https://mangadex.org/chapter/open',
            title: 'Chapter Open',
          },
        ],
      },
      21,
    )

    expect(stateManager.initializeTabState).toHaveBeenCalledWith(
      21,
      'mangadex',
      'series-locked',
      'Locked Series',
      [
        {
          id: 'chapter-locked',
          url: 'https://mangadex.org/chapter/locked',
          title: 'Chapter Locked',
          index: 1,
          chapterLabel: undefined,
          language: undefined,
          chapterNumber: undefined,
          volumeNumber: undefined,
          volumeLabel: undefined,
          locked: true,
        },
        {
          id: 'chapter-open',
          url: 'https://mangadex.org/chapter/open',
          title: 'Chapter Open',
          index: 2,
          chapterLabel: undefined,
          language: undefined,
          chapterNumber: undefined,
          volumeNumber: undefined,
          volumeLabel: undefined,
          locked: false,
        },
      ],
      undefined,
      undefined,
    )
  })

  it('nulls cached context before clearing tab state to avoid stale re-projection races', async () => {
    tabContextCache.setCachedContext(33, {
      siteIntegrationId: 'mangadex',
      mangaId: 'cached-series',
      seriesTitle: 'Cached Series',
      chapters: [],
      volumes: [],
      lastUpdated: Date.now(),
    })

    const stateManager = {
      clearTabState: vi.fn(async (requestedTabId: number) => {
        expect(requestedTabId).toBe(33)
        expect(tabContextCache.getCachedContext(33)).toBeNull()
      }),
    } as unknown as CentralizedStateManager

    const result = await handleClearTabState(stateManager, 33)

    expect(result).toEqual({ success: true })
    expect(tabContextCache.getCachedContext(33)).toBeUndefined()
  })
})

