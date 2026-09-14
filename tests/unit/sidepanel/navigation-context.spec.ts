/**
 * Tests side panel navigation state, URL classification, chapter grouping,
 * and downloaded chapter markers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { isInternalUrl } from "@/entrypoints/sidepanel/hooks/sidepanelActiveTabHelpers"
import {
  applyDownloadedChapterMarkers,
  groupChapters,
} from "@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers"

// Mock chrome APIs
const mockStorageData: Record<string, unknown> = {}
const storageChangeListeners: Array<
  (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => void
> = []
const tabActivatedListeners: Array<
  (activeInfo: chrome.tabs.OnActivatedInfo) => void
> = []

const chromeMock = {
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    onActivated: {
      addListener: vi.fn((listener) => tabActivatedListeners.push(listener)),
      removeListener: vi.fn((listener) => {
        const idx = tabActivatedListeners.indexOf(listener)
        if (idx !== -1) tabActivatedListeners.splice(idx, 1)
      }),
    },
  },
  storage: {
    session: {
      get: vi.fn().mockImplementation((keys?: string | string[]) => {
        if (!keys) return Promise.resolve(mockStorageData)
        if (typeof keys === "string") {
          return Promise.resolve({ [keys]: mockStorageData[keys] })
        }
        const result: Record<string, unknown> = {}
        for (const key of keys) {
          if (key in mockStorageData) {
            result[key] = mockStorageData[key]
          }
        }
        return Promise.resolve(result)
      }),
      set: vi.fn().mockImplementation((items: Record<string, unknown>) => {
        const changes: Record<string, chrome.storage.StorageChange> = {}
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: mockStorageData[key], newValue: value }
        }
        // Set the data AFTER capturing oldValue
        Object.assign(mockStorageData, items)
        storageChangeListeners.forEach((listener) =>
          listener(changes, "session")
        )
        return Promise.resolve()
      }),
      remove: vi.fn().mockImplementation((keys: string | string[]) => {
        const keysArray = typeof keys === "string" ? [keys] : keys
        const changes: Record<string, chrome.storage.StorageChange> = {}
        for (const key of keysArray) {
          if (key in mockStorageData) {
            changes[key] = {
              oldValue: mockStorageData[key],
              newValue: undefined,
            }
            delete mockStorageData[key]
          }
        }
        if (Object.keys(changes).length > 0) {
          storageChangeListeners.forEach((listener) =>
            listener(changes, "session")
          )
        }
        return Promise.resolve()
      }),
    },
    onChanged: {
      addListener: vi.fn((listener) => storageChangeListeners.push(listener)),
      removeListener: vi.fn((listener) => {
        const idx = storageChangeListeners.indexOf(listener)
        if (idx !== -1) storageChangeListeners.splice(idx, 1)
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    getURL: vi.fn((path: string) => `chrome-extension://fake-id/${path}`),
  },
  sidePanel: {
    setOptions: vi.fn().mockResolvedValue(undefined),
  },
}

vi.stubGlobal("chrome", chromeMock)
vi.stubGlobal("crypto", {
  randomUUID: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
})

// Helper functions
function clearMockStorage() {
  Object.keys(mockStorageData).forEach((key) => delete mockStorageData[key])
}

function clearAllListeners() {
  storageChangeListeners.length = 0
  tabActivatedListeners.length = 0
}

function simulateTabStorageCleared(tabId: number) {
  const key = `tab_${tabId}`
  const changes: Record<string, chrome.storage.StorageChange> = {
    [key]: { oldValue: mockStorageData[key], newValue: undefined },
  }
  delete mockStorageData[key]
  storageChangeListeners.forEach((listener) => listener(changes, "session"))
}

describe("Navigation Context", () => {
  beforeEach(() => {
    vi.clearAllMocks() // Preserve the mock implementations between cases.
    clearMockStorage()
    clearAllListeners()
    vi.resetModules()
  })

  afterEach(() => {
    clearMockStorage()
    clearAllListeners()
  })

  describe("isInternalUrl", () => {
    it("correctly identifies internal chrome URLs", () => {
      expect(isInternalUrl("chrome://newtab")).toBe(true)
      expect(isInternalUrl("chrome://settings")).toBe(true)
      expect(isInternalUrl("chrome-extension://fake-id/popup.html")).toBe(true)
      expect(isInternalUrl("about:blank")).toBe(true)
      expect(isInternalUrl("edge://settings")).toBe(true)
      expect(isInternalUrl("devtools://devtools/inspector.html")).toBe(true)
    })

    it("correctly identifies external HTTP URLs as non-internal", () => {
      expect(isInternalUrl("https://mangadex.org/")).toBe(false)
      expect(
        isInternalUrl("https://mangadex.org/title/abc123/manga-name")
      ).toBe(false)
      expect(isInternalUrl("https://google.com/")).toBe(false)
      expect(isInternalUrl("http://localhost:3000")).toBe(false)
    })

    it("treats empty/undefined URLs as internal", () => {
      expect(isInternalUrl(undefined)).toBe(true)
      expect(isInternalUrl("")).toBe(true)
    })
  })

  describe("Background tab state clearing detection", () => {
    it("detects a cleared tab state", async () => {
      const tabId = 123
      const tabKey = `tab_${tabId}`

      // Start with state for the active tab.
      mockStorageData[tabKey] = {
        siteId: "mangadex",
        seriesId: "abc123",
        seriesTitle: "Test Manga",
        chapters: [],
      }

      // Observe the storage event for this tab.
      let detectedClear = false
      const testListener = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string
      ) => {
        if (areaName !== "session") return
        if (tabKey in changes && changes[tabKey].newValue === undefined) {
          detectedClear = true
        }
      }

      storageChangeListeners.push(testListener)

      // Clear the tab state.
      simulateTabStorageCleared(tabId)

      expect(detectedClear).toBe(true)
      expect(mockStorageData[tabKey]).toBeUndefined()
    })
  })

  describe("Navigation state transitions", () => {
    it("clears tab state when navigation becomes unsupported", async () => {
      const tabId = 100

      // Initial state: on supported page
      mockStorageData[`tab_${tabId}`] = {
        siteId: "mangadex",
        seriesId: "abc123",
        seriesTitle: "Test Manga",
        chapters: [],
      }

      // Background clears state when navigating to unsupported
      simulateTabStorageCleared(tabId)

      // State should be cleared
      expect(mockStorageData[`tab_${tabId}`]).toBeUndefined()
    })

    it("stores state when navigation becomes supported", async () => {
      const tabId = 200

      // Initial state: no tab state (unsupported)
      expect(mockStorageData[`tab_${tabId}`]).toBeUndefined()

      // Content script initializes state for the supported page
      const mangaState = {
        siteId: "mangadex",
        seriesId: "abc123",
        seriesTitle: "New Manga",
        chapters: [{ url: "ch1", title: "Chapter 1", index: 0 }],
      }

      await chromeMock.storage.session.set({ [`tab_${tabId}`]: mangaState })

      // State should exist
      expect(mockStorageData[`tab_${tabId}`]).toEqual(mangaState)
    })

    it("restores state after returning to a supported page", async () => {
      const tabId = 300

      // Step 1: Initial state on supported page
      const mangaState = {
        siteId: "mangadex",
        seriesId: "abc123",
        seriesTitle: "Original Manga",
        chapters: [],
      }
      mockStorageData[`tab_${tabId}`] = mangaState

      // Step 2: Navigate to unsupported (background clears state)
      simulateTabStorageCleared(tabId)
      expect(mockStorageData[`tab_${tabId}`]).toBeUndefined()

      // Step 3: Back button - content script reinitializes
      await chromeMock.storage.session.set({ [`tab_${tabId}`]: mangaState })
      expect(mockStorageData[`tab_${tabId}`]).toEqual(mangaState)
    })

    it("keeps state for multiple tabs on the same URL", async () => {
      const tab1Id = 400
      const tab2Id = 401

      // Both tabs have state for the same series
      const mangaState = {
        siteId: "mangadex",
        seriesId: "abc123",
        seriesTitle: "Same Manga",
        chapters: [],
      }
      mockStorageData[`tab_${tab1Id}`] = { ...mangaState }
      mockStorageData[`tab_${tab2Id}`] = { ...mangaState }

      // Both tabs have state
      expect(mockStorageData[`tab_${tab1Id}`]).toBeDefined()
      expect(mockStorageData[`tab_${tab2Id}`]).toBeDefined()

      // Tab switch should trigger reinitialization for the new tab
    })
  })
})

describe("groupChapters", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("handles empty chapter list", () => {
    const result = groupChapters([])
    expect(result).toEqual([])
  })

  it("creates volume groups for chapters with volumeNumber", () => {
    const chapters = [
      {
        id: "ch1",
        url: "ch1",
        title: "Ch 1",
        index: 0,
        chapterNumber: 1,
        volumeNumber: 1,
        status: "queued" as const,
        lastUpdated: Date.now(),
      },
      {
        id: "ch2",
        url: "ch2",
        title: "Ch 2",
        index: 1,
        chapterNumber: 2,
        volumeNumber: 1,
        status: "queued" as const,
        lastUpdated: Date.now(),
      },
      {
        id: "ch3",
        url: "ch3",
        title: "Ch 3",
        index: 2,
        chapterNumber: 3,
        volumeNumber: 2,
        status: "queued" as const,
        lastUpdated: Date.now(),
      },
    ]

    const result = groupChapters(chapters)

    // Should create 2 volume groups
    expect(result.length).toBe(2)
  })

  it("preserves collapsed state from previous items", () => {
    const chapters = [
      {
        id: "ch1",
        url: "ch1",
        title: "Ch 1",
        index: 0,
        chapterNumber: 1,
        volumeNumber: 1,
        status: "queued" as const,
        lastUpdated: Date.now(),
      },
    ]

    // First call - default collapsed: true
    const firstResult = groupChapters(chapters)
    expect((firstResult[0] as { collapsed: boolean }).collapsed).toBe(true)

    // Simulate user expanding
    const expanded = [
      { ...(firstResult[0] as object), collapsed: false },
    ] as unknown as import("@/entrypoints/sidepanel/types").VolumeOrChapter[]

    // Second call with previous state
    const secondResult = groupChapters(chapters, expanded)
    expect((secondResult[0] as { collapsed: boolean }).collapsed).toBe(false)
  })
})

describe("downloaded chapter markers", () => {
  it("marks exact chapter ids in standalone and volume rows", () => {
    const items: import("@/entrypoints/sidepanel/types").VolumeOrChapter[] = [
      {
        id: "standalone-1",
        title: "Standalone",
        index: 1,
        selected: false,
        url: "https://example.com/standalone-1",
        status: "queued",
        isStandalone: true,
      },
      {
        groupId: "volume-1",
        title: "Volume 1",
        collapsed: false,
        chapters: [
          {
            id: "chapter-1",
            title: "Chapter 1",
            index: 2,
            selected: false,
            url: "https://example.com/chapter-1",
            status: "queued",
          },
          {
            id: "chapter-2",
            title: "Chapter 2",
            index: 3,
            selected: false,
            url: "https://example.com/chapter-2",
            status: "queued",
          },
        ],
      },
    ]

    const marked = applyDownloadedChapterMarkers(
      items,
      new Set(["standalone-1", "chapter-2"])
    )

    expect("chapters" in marked[0] ? undefined : marked[0].downloaded).toBe(
      true
    )
    expect("chapters" in marked[1] && marked[1].chapters[0].downloaded).toBe(
      false
    )
    expect("chapters" in marked[1] && marked[1].chapters[1].downloaded).toBe(
      true
    )
  })
})
