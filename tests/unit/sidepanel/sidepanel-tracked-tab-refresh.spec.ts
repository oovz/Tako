import { describe, expect, it, vi } from "vitest"

import { createTrackedTabRefreshCoordinator } from "@/entrypoints/sidepanel/hooks/useSidepanelTrackedTabId"

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
