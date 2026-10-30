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

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock("@/src/runtime/send-runtime-message", () => ({
  sendRuntimeMessage: send,
}))

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
  send
    .mockReset()
    .mockImplementation(async (message) =>
      message.type === "GET_SIDEPANEL_DOWNLOAD_STATE"
        ? { success: true, data: { downloadedChapters: [] } }
        : { success: true }
    )
  vi.stubGlobal("chrome", {
    windows: { getCurrent: vi.fn(async () => ({ id: 2 })) },
    tabs: {
      getCurrent: vi.fn(async () => ({ windowId: 2 })),
      query,
      onActivated: activated,
      onUpdated: updated,
    },
    storage: {
      session: {
        get: vi.fn(async () => ({
          [SESSION_STORAGE_KEYS.activeTabContextByWindow]: storedContext,
        })),
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
