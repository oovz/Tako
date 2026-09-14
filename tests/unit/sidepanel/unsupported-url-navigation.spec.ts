/**
 * @file unsupported-url-navigation.spec.ts
 * @description Tests side panel helper behavior for unsupported navigation.
 *
 * The cases cover URL classification and chapter grouping used by navigation
 * state updates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { isInternalUrl } from "@/entrypoints/sidepanel/hooks/sidepanelActiveTabHelpers"
import { groupChapters } from "@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers"

// Mock chrome APIs
const mockStorageData: Record<string, unknown> = {}
const storageChangeListeners: Array<
  (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => void
> = []

const chromeMock = {
  tabs: {
    query: vi.fn(),
    get: vi.fn(),
    onActivated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
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
        Object.assign(mockStorageData, items)
        // Simulate storage change event
        const changes: Record<string, chrome.storage.StorageChange> = {}
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { newValue: value }
        }
        storageChangeListeners.forEach((listener) =>
          listener(changes, "session")
        )
        return Promise.resolve()
      }),
      remove: vi.fn().mockImplementation((keys: string | string[]) => {
        const keysArray = typeof keys === "string" ? [keys] : keys
        keysArray.forEach((key) => delete mockStorageData[key])
        return Promise.resolve()
      }),
    },
    onChanged: {
      addListener: vi.fn().mockImplementation((listener) => {
        storageChangeListeners.push(listener)
      }),
      removeListener: vi.fn().mockImplementation((listener) => {
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

// Helper to clear mock storage
function clearMockStorage() {
  Object.keys(mockStorageData).forEach((key) => delete mockStorageData[key])
  storageChangeListeners.length = 0
}

describe("Unsupported URL navigation", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearMockStorage()
    // Reset module-level state by clearing the import cache
    vi.resetModules()
  })

  afterEach(() => {
    clearMockStorage()
  })

  describe("isInternalUrl", () => {
    it("treats browser pages as external URLs", () => {
      // The homepage is a valid HTTP URL, not an internal chrome:// URL
      expect(isInternalUrl("https://mangadex.org/")).toBe(false)
      expect(
        isInternalUrl("https://mangadex.org/title/abc123/manga-name")
      ).toBe(false)
    })

    it("recognizes browser and extension URLs as internal", () => {
      expect(isInternalUrl("chrome://newtab")).toBe(true)
      expect(isInternalUrl("chrome-extension://fake-id/popup.html")).toBe(true)
      expect(isInternalUrl("about:blank")).toBe(true)
    })
  })

  describe("Chapter grouping", () => {
    it("groups empty and volume-numbered chapter lists", async () => {
      const tabId = 12345
      const oldMangaState = {
        siteId: "mangadex",
        seriesId: "mangadex:abc123",
        seriesTitle: "Old Manga Title",
        chapters: [{ url: "ch1", title: "Chapter 1", index: 1 }],
        lastUpdated: Date.now(),
      }

      // Keep representative state for the previous page.
      mockStorageData[`tab_${tabId}`] = oldMangaState
      mockStorageData.globalState = { downloadQueue: [] }

      // The active tab has moved to an unsupported URL.
      chromeMock.tabs.get.mockResolvedValue({
        id: tabId,
        url: "https://mangadex.org/", // Homepage - unsupported
        active: true,
      })

      chromeMock.tabs.query.mockImplementation(async (queryInfo: unknown) => {
        const q = queryInfo as Record<string, unknown>
        if (q.currentWindow === true && q.active === true) {
          return [{ id: tabId, url: "https://mangadex.org/", active: true }]
        }
        if (q.currentWindow === true) {
          return [{ id: tabId, url: "https://mangadex.org/", active: true }]
        }
        return []
      })

      // Empty input produces no groups.
      const result = groupChapters([])
      expect(result).toEqual([])

      // Volume metadata groups the chapters under one volume.
      const chaptersWithVolume = [
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
      ]
      const groupedWithVolume = groupChapters(chaptersWithVolume)
      expect(groupedWithVolume.length).toBe(1) // Grouped into one volume
    })

    it("preserves collapsed state when regrouping volume chapters", async () => {
      // Create chapters with volume numbers.
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
      ]

      // The first grouping starts collapsed.
      const firstResult = groupChapters(chapters)
      expect(firstResult.length).toBe(1)

      const volume = firstResult[0] as { collapsed: boolean; groupId: string }
      expect(volume.collapsed).toBe(true) // Default

      // Simulate the user expanding the volume.
      const expandedPrevious = [{ ...volume, collapsed: false }]

      // Regrouping keeps the previous collapsed state.
      // @ts-expect-error - the helper accepts its internal row shape here.
      const secondResult = groupChapters(chapters, expandedPrevious)
      const secondVolume = secondResult[0] as { collapsed: boolean }
      expect(secondVolume.collapsed).toBe(false) // Preserved from previous
    })
  })
})
