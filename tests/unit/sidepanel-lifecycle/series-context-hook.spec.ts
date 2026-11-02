// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useSidepanelSeriesContext } from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"
import { useSidepanelTrackedTabId } from "@/entrypoints/sidepanel/hooks/useSidepanelTrackedTabId"
import type { DownloadedChapterRecord } from "@/src/domain/history/types"
import {
  LOCAL_STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
} from "@/src/runtime/storage-keys"

const send = vi.fn()
const readSession = vi.fn()

function event<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => void>()
  return {
    listeners,
    addListener: (listener: (...args: T) => void) => listeners.add(listener),
    removeListener: (listener: (...args: T) => void) =>
      listeners.delete(listener),
    emit: (...args: T) => listeners.forEach((listener) => listener(...args)),
  }
}
const activated = event<[chrome.tabs.OnActivatedInfo]>()
const updated =
  event<[number, chrome.tabs.OnUpdatedInfo, Partial<chrome.tabs.Tab>]>()
const changed =
  event<
    [Record<string, chrome.storage.StorageChange>, chrome.storage.AreaName]
  >()
const query = vi.fn()
let root: Root
let container: HTMLDivElement
let state: ReturnType<typeof useSidepanelSeriesContext>
let storedContext: unknown
const url = "https://mangadex.org/title/series"
const tab = { id: 7, windowId: 2, url, active: true }
const savedChapter: DownloadedChapterRecord = {
  siteIntegrationId: "mangadex",
  seriesId: "series",
  chapterId: "chapter",
  url: "https://mangadex.org/chapter/one",
  title: "Chapter",
  seriesTitle: "Series",
  downloadedAt: 10,
  format: "cbz",
  outputDestination: "downloads-api",
  saveConfirmedAt: 10,
}
function readyContext() {
  return {
    2: {
      windowId: 2,
      activeTabId: 7,
      revision: 3,
      timestamp: 1,
      context: {
        sourceUrl: url,
        siteIntegrationId: "mangadex",
        mangaId: "series",
        seriesTitle: "Series",
        chapters: [
          {
            id: "chapter",
            url: "https://mangadex.org/chapter/one",
            title: "Chapter",
            index: 1,
            status: "queued",
            lastUpdated: 1,
          },
        ],
        volumes: [],
        lastUpdated: 1,
      },
    },
  }
}
function View() {
  state = useSidepanelSeriesContext()
  return createElement(
    "button",
    { onClick: state.retrySeriesContext },
    state.isLoading ? "loading" : state.mangaTitle || state.blockingMessage
  )
}
function changeHistory() {
  changed.emit({ [LOCAL_STORAGE_KEYS.downloadedChapters]: {} }, "local")
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  storedContext = readyContext()
  query.mockReset().mockResolvedValue([tab])
  readSession.mockReset().mockImplementation(async () => ({
    [SESSION_STORAGE_KEYS.activeTabContextByWindow]: storedContext,
  }))
  send
    .mockReset()
    .mockImplementation(async (message) =>
      message.type === "GET_SIDEPANEL_DOWNLOAD_STATE"
        ? { success: true, data: { downloadedChapters: [] } }
        : { success: true }
    )
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: send },
    windows: { getCurrent: vi.fn(async () => ({ id: 2 })) },
    tabs: {
      getCurrent: vi.fn(async () => ({ windowId: 2 })),
      query,
      onActivated: activated,
      onUpdated: updated,
    },
    storage: {
      session: {
        get: readSession,
      },
      onChanged: changed,
    },
  })
  container = document.createElement("div")
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  activated.listeners.clear()
  updated.listeners.clear()
  changed.listeners.clear()
  vi.unstubAllGlobals()
})

it("renders the exact tab projection and applies only the newest downloaded chapter response", async () => {
  await act(async () => root.render(createElement(View)))
  expect(container.textContent).toBe("Series")
  expect(state.seriesRevision).toBe(3)
  const older = Promise.withResolvers<unknown>()
  send.mockReturnValueOnce(older.promise).mockResolvedValueOnce({
    success: true,
    data: {
      downloadedChapters: [savedChapter],
    },
  })
  await act(async () => changeHistory())
  await act(async () => changeHistory())
  expect(state.items[0]).toMatchObject({
    id: "chapter",
    downloaded: true,
    saveConfirmedAt: 10,
  })
  await act(async () =>
    older.resolve({ success: true, data: { downloadedChapters: [] } })
  )
  expect(state.items[0]).toMatchObject({ id: "chapter", downloaded: true })
  act(() => root.unmount())
  expect(activated.listeners.size).toBe(0)
  expect(updated.listeners.size).toBe(0)
  expect(changed.listeners.size).toBe(0)
})

it("retains known chapter markers after a query failure and accepts a later successful refresh", async () => {
  send.mockResolvedValue({
    success: true,
    data: { downloadedChapters: [savedChapter] },
  })
  await act(async () => root.render(createElement(View)))
  expect(state.items[0]).toMatchObject({ id: "chapter", downloaded: true })
  send.mockResolvedValueOnce({ success: false, error: "Worker unavailable" })
  await act(async () => changeHistory())
  expect(state.items[0]).toMatchObject({ id: "chapter", downloaded: true })
  const older = Promise.withResolvers<unknown>()
  send
    .mockReturnValueOnce(older.promise)
    .mockResolvedValueOnce({ success: true, data: { downloadedChapters: [] } })
  await act(async () => changeHistory())
  await act(async () => changeHistory())
  await act(async () => older.reject(new Error("Old query failed")))
  expect(state.items[0]).toMatchObject({ id: "chapter", downloaded: false })
})

it("recovers an error once and allows the rendered retry action to request another resolution", async () => {
  storedContext = {
    2: {
      windowId: 2,
      activeTabId: 7,
      revision: 3,
      timestamp: 1,
      context: { error: "Unavailable" },
    },
  }
  await act(async () => root.render(createElement(View)))
  expect(container.textContent).toBe("Unavailable")
  const refreshCalls = () =>
    send.mock.calls.filter(
      ([message]) => message.type === "REQUEST_TAB_CONTEXT_REFRESH"
    )
  expect(refreshCalls()).toHaveLength(1)
  await act(async () => container.querySelector("button")!.click())
  expect(refreshCalls()).toHaveLength(2)
  expect(refreshCalls()[1][0].payload).toEqual({
    tabId: 7,
    windowId: 2,
    reason: "sidepanel-retry",
  })
})

it("rejects a superseded window query and listens only to relevant tab updates", async () => {
  const older = Promise.withResolvers<unknown[]>()
  query
    .mockReturnValueOnce(older.promise)
    .mockResolvedValueOnce([{ ...tab, id: 9, windowId: 4 }])
  let tracked: ReturnType<typeof useSidepanelTrackedTabId>
  function Tracked({ windowId }: { windowId: number }) {
    tracked = useSidepanelTrackedTabId(windowId)
    return createElement("output", null, tracked.tabId)
  }
  await act(async () => root.render(createElement(Tracked, { windowId: 2 })))
  await act(async () => root.render(createElement(Tracked, { windowId: 4 })))
  expect(container.textContent).toBe("9")
  await act(async () => older.resolve([tab]))
  expect(container.textContent).toBe("9")
  await act(async () => {
    activated.emit({ tabId: 3, windowId: 2 })
    updated.emit(9, { title: "Other" }, { active: true, windowId: 4 })
    updated.emit(
      8,
      { url: "https://mangadex.org/new" },
      { active: true, windowId: 4 }
    )
  })
  expect(query).toHaveBeenCalledTimes(2)
  query.mockResolvedValue([
    { ...tab, id: 9, windowId: 4, url: "https://mangadex.org/new" },
  ])
  await act(async () =>
    updated.emit(
      9,
      { url: "https://mangadex.org/new" },
      { active: true, windowId: 4 }
    )
  )
  expect(query).toHaveBeenCalledTimes(3)
})

it.each(["active tab", "session context"] as const)(
  "keeps the series loading until the independently delayed %s read finishes",
  async (delayedRead) => {
    const pendingTab = Promise.withResolvers<(typeof tab)[]>()
    const pendingSession = Promise.withResolvers<Record<string, unknown>>()
    if (delayedRead === "active tab") query.mockReturnValue(pendingTab.promise)
    else readSession.mockReturnValue(pendingSession.promise)
    await act(async () => root.render(createElement(View)))
    expect(state.windowId).toBe(2)
    if (delayedRead === "active tab") {
      expect(state.tabId).toBeUndefined()
      expect(state.mangaTitle).toBe("Series")
    } else {
      expect(state.tabId).toBe(7)
      expect(state.mangaState).toBeUndefined()
    }
    expect(state.isLoading).toBe(true)
    expect(state.retrySeriesContext).toBeUndefined()
    await act(async () => {
      pendingTab.resolve([tab])
      pendingSession.resolve({
        [SESSION_STORAGE_KEYS.activeTabContextByWindow]: readyContext(),
      })
    })
    expect(state).toMatchObject({
      windowId: 2,
      tabId: 7,
      seriesRevision: 3,
      seriesId: "series",
      isLoading: false,
    })
  }
)

it.each([
  {
    identity: "another provider",
    record: {
      ...savedChapter,
      siteIntegrationId: "mangaplus",
      url: "https://mangaplus.shueisha.co.jp/viewer/1000001",
    },
  },
  {
    identity: "another series",
    record: {
      ...savedChapter,
      seriesId: "other-series",
      seriesTitle: "Other series",
    },
  },
])(
  "does not inherit a saved result from $identity sharing the chapter ID",
  async ({ record }) => {
    send.mockImplementation(async (message) =>
      message.type === "GET_SIDEPANEL_DOWNLOAD_STATE"
        ? { success: true, data: { downloadedChapters: [record] } }
        : { success: true }
    )
    await act(async () => root.render(createElement(View)))
    const first = state.items[0]
    expect(first).toMatchObject({ id: "chapter", downloaded: false })
    if ("chapters" in first) throw new Error("Expected standalone chapter")
    expect(first.outputDestination).toBeUndefined()
    expect(first.saveConfirmedAt).toBeUndefined()
    send.mockResolvedValueOnce({
      success: true,
      data: { downloadedChapters: [savedChapter] },
    })
    await act(async () => changeHistory())
    expect(state.items[0]).toMatchObject({
      id: "chapter",
      downloaded: true,
      outputDestination: "downloads-api",
      saveConfirmedAt: 10,
    })
  }
)
