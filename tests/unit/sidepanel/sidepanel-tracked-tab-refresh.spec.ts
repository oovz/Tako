// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createTrackedTabRefreshCoordinator,
  useSidepanelTrackedTabId,
} from "@/entrypoints/sidepanel/hooks/useSidepanelTrackedTabId"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function makeTab(id: number): chrome.tabs.Tab {
  return {
    id,
    active: true,
    url: `https://example.com/${id}`,
    index: 0,
    lastAccessed: 0,
    pinned: false,
    highlighted: true,
    windowId: 1,
    incognito: false,
    selected: true,
    discarded: false,
    frozen: false,
    autoDiscardable: true,
    groupId: -1,
  }
}

describe("tracked-tab refresh coordinator", () => {
  it("commits only the newest active-tab query when responses arrive out of order", async () => {
    const first = deferred<chrome.tabs.Tab[]>()
    const second = deferred<chrome.tabs.Tab[]>()
    const queryActiveTab = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const commit = vi.fn()
    const coordinator = createTrackedTabRefreshCoordinator({
      queryActiveTab,
      commit,
    })

    const firstRefresh = coordinator.refresh()
    const secondRefresh = coordinator.refresh()
    second.resolve([makeTab(2)])
    await secondRefresh
    first.resolve([makeTab(1)])
    await firstRefresh

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(2, "https://example.com/2")
  })

  it("does not let an older rejected query clear a newer tracked tab", async () => {
    const first = deferred<chrome.tabs.Tab[]>()
    const second = deferred<chrome.tabs.Tab[]>()
    const commit = vi.fn()
    const coordinator = createTrackedTabRefreshCoordinator({
      queryActiveTab: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
      commit,
    })

    const firstRefresh = coordinator.refresh()
    const secondRefresh = coordinator.refresh()
    second.resolve([makeTab(2)])
    await secondRefresh
    first.reject(new Error("stale query failed"))
    await firstRefresh

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(2, "https://example.com/2")
  })

  it("invalidates an in-flight query when disposed", async () => {
    const pending = deferred<chrome.tabs.Tab[]>()
    const commit = vi.fn()
    const coordinator = createTrackedTabRefreshCoordinator({
      queryActiveTab: () => pending.promise,
      commit,
    })

    const refresh = coordinator.refresh()
    coordinator.dispose()
    pending.resolve([makeTab(3)])
    await refresh

    expect(commit).not.toHaveBeenCalled()
  })
})

describe("mounted tracked-tab navigation", () => {
  let root: Root
  let container: HTMLDivElement
  let tracked: ReturnType<typeof useSidepanelTrackedTabId>
  let tabs: chrome.tabs.Tab[]
  const activated = new Set<(info: chrome.tabs.OnActivatedInfo) => void>()
  const updated = new Set<
    (
      tabId: number,
      change: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab
    ) => void
  >()
  const query = vi.fn(async (info: chrome.tabs.QueryInfo) =>
    tabs.filter(
      (tab) =>
        tab.windowId === info.windowId &&
        (info.active === undefined || tab.active === info.active)
    )
  )

  function View() {
    tracked = useSidepanelTrackedTabId(1)
    return createElement("output", null, tracked.activeUrl)
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      tabs: {
        query,
        onActivated: {
          addListener: (
            listener: (info: chrome.tabs.OnActivatedInfo) => void
          ) => activated.add(listener),
          removeListener: (
            listener: (info: chrome.tabs.OnActivatedInfo) => void
          ) => activated.delete(listener),
        },
        onUpdated: {
          addListener: (
            listener: (
              tabId: number,
              change: chrome.tabs.OnUpdatedInfo,
              tab: chrome.tabs.Tab
            ) => void
          ) => updated.add(listener),
          removeListener: (
            listener: (
              tabId: number,
              change: chrome.tabs.OnUpdatedInfo,
              tab: chrome.tabs.Tab
            ) => void
          ) => updated.delete(listener),
        },
      },
    })
    query.mockClear()
    tabs = [makeTab(7), { ...makeTab(8), active: false }]
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    expect(activated.size).toBe(0)
    expect(updated.size).toBe(0)
    vi.unstubAllGlobals()
  })

  it("tracks the active tab in its window and follows a new activation", async () => {
    await act(async () => root.render(createElement(View)))
    expect(tracked).toEqual({ tabId: 7, activeUrl: "https://example.com/7" })
    tabs = tabs.map((tab) => ({ ...tab, active: tab.id === 8 }))
    await act(async () =>
      activated.forEach((listener) => listener({ tabId: 8, windowId: 1 }))
    )
    expect(tracked).toEqual({ tabId: 8, activeUrl: "https://example.com/8" })
  })

  it("updates a known tab URL and clears the previous URL when the next active tab has none", async () => {
    await act(async () => root.render(createElement(View)))
    const navigated = { ...makeTab(7), url: "https://example.com/new-series" }
    tabs = [navigated]
    await act(async () =>
      updated.forEach((listener) =>
        listener(7, { url: navigated.url }, navigated)
      )
    )
    expect(tracked).toEqual({ tabId: 7, activeUrl: navigated.url })
    tabs = [{ ...makeTab(9), url: undefined }]
    await act(async () =>
      activated.forEach((listener) => listener({ tabId: 9, windowId: 1 }))
    )
    expect(tracked).toEqual({ tabId: 9, activeUrl: "" })
  })

  it("clears both tab identity and its known URL after the current Chrome query fails", async () => {
    await act(async () => root.render(createElement(View)))
    expect(tracked).toEqual({ tabId: 7, activeUrl: "https://example.com/7" })
    tabs = [makeTab(9)]
    query.mockRejectedValueOnce(new Error("Current tab query unavailable"))
    await act(async () =>
      activated.forEach((listener) => listener({ tabId: 9, windowId: 1 }))
    )
    expect(tracked).toEqual({ tabId: undefined, activeUrl: undefined })
    await act(async () =>
      updated.forEach((listener) => listener(9, { url: tabs[0].url }, tabs[0]))
    )
    expect(tracked).toEqual({ tabId: 9, activeUrl: "https://example.com/9" })
  })
})
