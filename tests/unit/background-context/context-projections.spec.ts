import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTabContextCache } from "@/entrypoints/background/tab-cache"
import { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"

vi.mock("@/src/site-integrations/url-matcher", () => ({
  matchUrl: (url: string) =>
    url.includes("mangadex.org/title/")
      ? { integrationId: "mangadex", role: "series" }
      : null,
}))
const sourceUrl = "https://mangadex.org/title/series"
const tab = { id: 7, active: true, windowId: 2, url: sourceUrl }
let session: Record<string, unknown>
const getTab = vi.fn()
const query = vi.fn()
function cache() {
  return createTabContextCache({
    getTab,
    queryActiveTabs: query,
    readSession: async () => structuredClone(session),
    writeSession: async (values) => {
      Object.assign(session, structuredClone(values))
    },
  })
}
beforeEach(() => {
  session = {}
  vi.clearAllMocks()
  getTab.mockResolvedValue(tab)
  query.mockResolvedValue([tab])
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: async () => structuredClone(session),
        set: async (values: Record<string, unknown>) => {
          Object.assign(session, structuredClone(values))
        },
        remove: async (keys: string | string[]) => {
          for (const key of [keys].flat()) delete session[key]
        },
      },
    },
  })
})

describe("active window projection discovery", () => {
  it("uses the tab's window when activation has no window hint", async () => {
    await cache().handleTabActivated(7)
    expect(
      session[SESSION_STORAGE_KEYS.activeTabContextByWindow]
    ).toMatchObject({ 2: { activeTabId: 7, context: { loading: true } } })
  })
  it("recovers the active window after the first tab lookup fails", async () => {
    getTab.mockRejectedValueOnce(new Error("tab snapshot unavailable"))
    await cache().handleTabActivated(7)
    expect(
      session[SESSION_STORAGE_KEYS.activeTabContextByWindow]
    ).toMatchObject({ 2: { activeTabId: 7 } })
  })
  it("synchronizes distinct windows while skipping tabs whose window cannot be established", async () => {
    query.mockResolvedValue([
      { id: undefined },
      { id: 7 },
      { id: 8, windowId: 3 },
      { id: 9 },
    ])
    getTab.mockImplementation(async (id: number) =>
      id === 7 ? tab : id === 8 ? { ...tab, id: 8, windowId: 3 } : undefined
    )
    await cache().syncActiveTabContext()
    expect(
      session[SESSION_STORAGE_KEYS.activeTabContextByWindow]
    ).toMatchObject({ 2: { activeTabId: 7 }, 3: { activeTabId: 8 } })
    expect(
      Object.keys(
        session[SESSION_STORAGE_KEYS.activeTabContextByWindow] as object
      )
    ).toHaveLength(2)
  })
  it("rejects an inactive resolver mutation while retaining an unversioned background cache mutation", async () => {
    query.mockResolvedValue([])
    const contextCache = cache()
    const mutation = vi.fn(async () => null)
    expect(
      await contextCache.commitTabContextMutation(
        7,
        { windowId: 2, requestId: 1 },
        mutation
      )
    ).toBe(false)
    expect(mutation).not.toHaveBeenCalled()
    expect(
      await contextCache.commitTabContextMutation(7, undefined, mutation)
    ).toBe(true)
    expect(contextCache.getCachedContext(7)).toBeNull()
    expect(
      session[SESSION_STORAGE_KEYS.activeTabContextByWindow]
    ).toBeUndefined()
  })
})

it("initializes newly discovered chapters while preserving completed progress for the same series", async () => {
  const state = new TabContextStateService(cache())
  const initial = {
    context: "ready" as const,
    sourceUrl,
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    chapters: [
      { id: "one", title: "One", url: "https://mangadex.org/chapter/one" },
    ],
  }
  await state.commitResolvedTabContext(initial, 7, { windowId: 2 })
  const stored = await state.getTabState(7)
  expect(stored?.chapters[0].status).toBe("queued")
  if (!stored) throw new Error("Initial series state was not committed")
  stored.chapters[0] = {
    ...stored.chapters[0],
    status: "completed",
    totalImages: 12,
    lastUpdated: 10,
  }
  session.tab_7 = stored
  await state.commitResolvedTabContext(
    {
      ...initial,
      chapters: [
        ...initial.chapters,
        { id: "two", title: "Two", url: "https://mangadex.org/chapter/two" },
      ],
    },
    7,
    { windowId: 2 }
  )
  const merged = await state.getTabState(7)
  expect(merged?.chapters).toMatchObject([
    { id: "one", status: "completed", totalImages: 12, lastUpdated: 10 },
    { id: "two", status: "queued" },
  ])
  expect(merged?.chapters[1].lastUpdated).toEqual(expect.any(Number))
})
