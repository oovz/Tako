import { describe, it, expect, vi, beforeEach } from "vitest"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import {
  isInternalUrl,
  isExtensionUrl,
  resolveTabUrlForSupportCheck,
  resolveTrackedTabId,
} from "@/entrypoints/sidepanel/hooks/sidepanelActiveTabHelpers"
import {
  deriveSeriesContextFromActiveTabContext,
  normalizeActiveTabContext,
  normalizeStoredSeriesContext,
  selectPreferredSeriesContextTask,
} from "@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers"

// Mock global chrome object
const chromeMock = {
  tabs: {
    query: vi.fn(),
  },
}
vi.stubGlobal("chrome", chromeMock)
import type { DownloadTaskState } from "@/src/domain/queue/state"
import {
  NO_MANGA_FOUND_MSG,
  TAB_NOT_SUPPORTED_MSG,
} from "@/entrypoints/sidepanel/messages"

function makeTask(overrides: Partial<DownloadTaskState>): DownloadTaskState {
  const siteIntegrationId = overrides.siteIntegrationId ?? "mangadex"
  return {
    id: "task-1",
    siteIntegrationId,
    mangaId: "series-1",
    seriesTitle: "Series 1",
    chapters: [],
    status: "queued",
    created: 1,
    settingsSnapshot: createTaskSettingsSnapshot(
      DEFAULT_SETTINGS,
      siteIntegrationId
    ),
    ...overrides,
  }
}

describe("sidepanel active-tab helpers", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("should identify internal URLs correctly", () => {
    expect(isInternalUrl("chrome://newtab")).toBe(true)
    expect(isInternalUrl("https://google.com")).toBe(false)
    expect(isInternalUrl(undefined)).toBe(true)
    expect(isInternalUrl("")).toBe(true)
  })

  it("prefers committed tab.url over pendingUrl when resolving support-check URL", () => {
    const resolved = resolveTabUrlForSupportCheck({
      url: "https://comic.pixiv.net/works/9012",
      pendingUrl: "https://accounts.pixiv.net/?return_to=...",
    })

    expect(resolved).toBe("https://comic.pixiv.net/works/9012")
  })

  it("falls back to pendingUrl when tab.url is unavailable", () => {
    const resolved = resolveTabUrlForSupportCheck({
      pendingUrl: "https://comic.pixiv.net/viewer/stories/44495",
    })

    expect(resolved).toBe("https://comic.pixiv.net/viewer/stories/44495")
  })

  it("prefers pendingUrl when the committed URL is an internal placeholder", () => {
    const resolved = resolveTabUrlForSupportCheck({
      url: "about:blank",
      pendingUrl: "chrome-extension://test/sidepanel.html",
    })

    expect(resolved).toBe("chrome-extension://test/sidepanel.html")
  })

  it("identifies extension URLs separately from general internal URLs", () => {
    expect(isExtensionUrl("chrome-extension://test/sidepanel.html")).toBe(true)
    expect(isExtensionUrl("https://comic.pixiv.net/works/9012")).toBe(false)
    expect(isExtensionUrl(undefined)).toBe(false)
  })

  it("tracks the active tab id when the active surface is an extension page", () => {
    expect(
      resolveTrackedTabId({
        id: 100,
        url: "chrome-extension://aglomhfnbpoilggpgljgcfhicfpdhhfj/options.html",
      })
    ).toBe(100)
  })

  it("switches tracked tab ids when a real browser tab becomes active", () => {
    expect(
      resolveTrackedTabId({
        id: 77,
        url: "https://mangadex.org/title/abc123/series",
      })
    ).toBe(77)
  })
})

describe("series-context task selection", () => {
  it("prefers downloading tasks over queued tasks regardless of queue order", () => {
    const selected = selectPreferredSeriesContextTask([
      makeTask({ id: "queued-first", status: "queued", created: 1 }),
      makeTask({ id: "active-second", status: "downloading", created: 2 }),
    ])

    expect(selected?.id).toBe("active-second")
  })

  it("picks the oldest created task among tasks with the same preferred status", () => {
    const selected = selectPreferredSeriesContextTask([
      makeTask({ id: "active-newer", status: "downloading", created: 20 }),
      makeTask({ id: "active-older", status: "downloading", created: 10 }),
      makeTask({ id: "queued-fallback", status: "queued", created: 1 }),
    ])

    expect(selected?.id).toBe("active-older")
  })

  it("falls back to the oldest queued task when no downloading task exists", () => {
    const selected = selectPreferredSeriesContextTask([
      makeTask({ id: "queued-newer", status: "queued", created: 20 }),
      makeTask({ id: "queued-older", status: "queued", created: 10 }),
      makeTask({ id: "completed-task", status: "completed", created: 1 }),
    ])

    expect(selected?.id).toBe("queued-older")
  })
})

describe("activeTabContext mapping", () => {
  it("derives series data from a MangaPageState context", () => {
    const result = deriveSeriesContextFromActiveTabContext({
      kind: "ready",
      mangaState: {
        sourceUrl: "https://mangadex.org/title/series-ctx",
        siteIntegrationId: "mangadex",
        mangaId: "series-ctx",
        seriesTitle: "Series Context",
        chapters: [
          {
            id: "ch-1",
            url: "https://mangadex.org/chapter/1",
            title: "Chapter 1",
            index: 1,
            chapterNumber: 1,
            status: "queued",
            lastUpdated: 1,
          },
        ],
        volumes: [],
        metadata: {
          author: "Author",
          coverUrl: "https://example.com/cover.jpg",
        },
        lastUpdated: 1,
      },
    })

    expect(result.mangaState?.mangaId).toBe("series-ctx")
    expect(result.mangaTitle).toBe("Series Context")
    expect(result.seriesId).toBe("series-ctx")
    expect(result.siteId).toBe("mangadex")
    expect(result.author).toBe("Author")
    expect(result.coverUrl).toBe("https://example.com/cover.jpg")
    expect(result.blockingMessage).toBeUndefined()
    expect(result.isLoading).toBe(false)
    expect(result.items).toHaveLength(1)
    expect("chapters" in result.items[0]).toBe(false)
    if (!("chapters" in result.items[0])) {
      expect(result.items[0].id).toBe("ch-1")
    }
  })

  it("derives loading state from a loading context", () => {
    const result = deriveSeriesContextFromActiveTabContext({ kind: "loading" })

    expect(result.isLoading).toBe(true)
    expect(result.blockingMessage).toBeUndefined()
    expect(result.mangaState).toBeUndefined()
  })

  it("normalizes no-manga errors into the canonical blocking message", () => {
    const result = deriveSeriesContextFromActiveTabContext({
      kind: "error",
      error: "No manga found on this page",
    })

    expect(result.isLoading).toBe(false)
    expect(result.blockingMessage).toBe(NO_MANGA_FOUND_MSG)
  })

  it("maps unsupported context to the generic no-series guidance state", () => {
    const result = deriveSeriesContextFromActiveTabContext({
      kind: "unsupported",
    })

    expect(result.isLoading).toBe(false)
    expect(result.blockingMessage).toBe(TAB_NOT_SUPPORTED_MSG)
    expect(result.mangaState).toBeUndefined()
    expect(result.items).toEqual([])
  })

  it("normalizes raw session context into the discriminated active-tab union", () => {
    expect(normalizeActiveTabContext({ loading: true })).toEqual({
      kind: "loading",
    })
    expect(normalizeActiveTabContext({ error: "storage corruption" })).toEqual({
      kind: "error",
      error: "storage corruption",
    })
    expect(normalizeActiveTabContext({ nope: true })).toEqual({
      kind: "unsupported",
    })
    expect(
      normalizeActiveTabContext({
        sourceUrl: "https://mangadex.org/title/series-ctx",
        siteIntegrationId: "mangadex",
        mangaId: "series-ctx",
        seriesTitle: "Series Context",
        chapters: [],
        volumes: [],
        lastUpdated: 1,
      })
    ).toEqual({
      kind: "ready",
      mangaState: {
        sourceUrl: "https://mangadex.org/title/series-ctx",
        siteIntegrationId: "mangadex",
        mangaId: "series-ctx",
        seriesTitle: "Series Context",
        chapters: [],
        volumes: [],
        lastUpdated: 1,
      },
    })
  })

  it("waits for window ownership before reading the per-window projection", () => {
    expect(
      normalizeStoredSeriesContext(
        {
          2: {
            windowId: 2,
            activeTabId: 17,
            revision: 4,
            timestamp: 1,
            context: { error: "current projection" },
          },
        },
        17
      )
    ).toEqual({ kind: "loading" })
  })

  it("reads only the exact active tab projection for the current window", () => {
    expect(
      normalizeStoredSeriesContext(
        {
          2: {
            windowId: 2,
            activeTabId: 18,
            revision: 4,
            timestamp: 1,
            context: { error: "Different tab" },
          },
        },
        17,
        2,
        "https://mangadex.org/title/current/series"
      )
    ).toEqual({ kind: "loading" })
  })

  it("returns loading for a malformed per-window projection", () => {
    expect(
      normalizeStoredSeriesContext(
        {
          2: {
            windowId: 2,
            activeTabId: 17,
            revision: 4,
            timestamp: 1,
            context: { loading: true },
            unexpected: true,
          },
        },
        17,
        2,
        "https://mangadex.org/title/current/series"
      )
    ).toEqual({ kind: "loading" })
  })

  it("returns the strict ready projection for the exact tab, window, and URL", () => {
    expect(
      normalizeStoredSeriesContext(
        {
          2: {
            windowId: 2,
            activeTabId: 17,
            revision: 4,
            timestamp: 1,
            context: {
              sourceUrl: "https://mangadex.org/title/current/series",
              siteIntegrationId: "mangadex",
              mangaId: "current-series",
              seriesTitle: "Current Series",
              chapters: [],
              volumes: [],
              lastUpdated: 1,
            },
          },
        },
        17,
        2,
        "https://mangadex.org/title/current/series"
      )
    ).toEqual({
      kind: "ready",
      revision: 4,
      mangaState: {
        sourceUrl: "https://mangadex.org/title/current/series",
        siteIntegrationId: "mangadex",
        mangaId: "current-series",
        seriesTitle: "Current Series",
        chapters: [],
        volumes: [],
        lastUpdated: 1,
      },
    })
  })

  it("does not render a ready projection from a previous URL on the same tab", () => {
    expect(
      normalizeStoredSeriesContext(
        {
          2: {
            windowId: 2,
            activeTabId: 17,
            revision: 4,
            timestamp: 1,
            context: {
              sourceUrl: "https://mangadex.org/title/old/series",
              siteIntegrationId: "mangadex",
              mangaId: "old-series",
              seriesTitle: "Old Series",
              chapters: [],
              volumes: [],
              lastUpdated: 1,
            },
          },
        },
        17,
        2,
        "https://mangadex.org/title/new/series"
      )
    ).toEqual({ kind: "loading" })
  })

  it("normalizes unsupported/null context for an extension options page to unsupported and not detected", () => {
    const normalized = normalizeStoredSeriesContext(
      {
        2: {
          windowId: 2,
          activeTabId: 100,
          revision: 1,
          timestamp: 1,
          context: null,
        },
      },
      100,
      2,
      "chrome-extension://aglomhfnbpoilggpgljgcfhicfpdhhfj/options.html"
    )
    expect(normalized).toEqual({ kind: "unsupported" })

    const derived = deriveSeriesContextFromActiveTabContext(normalized)
    expect(derived.isLoading).toBe(false)
    expect(derived.blockingMessage).toBe(TAB_NOT_SUPPORTED_MSG)
  })
})
