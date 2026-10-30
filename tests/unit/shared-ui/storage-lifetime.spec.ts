// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useChromeStorageValue } from "@/src/ui/shared/hooks/useChromeStorageValue"

type StorageListener = Parameters<
  typeof chrome.storage.onChanged.addListener
>[0]
const parse = (raw: unknown) => raw as { queue?: string; revision?: number }

describe("storage projection lifetime", () => {
  let root: Root
  let container: HTMLDivElement
  let refresh: () => Promise<void>
  const get = vi.fn()
  const listeners = new Set<StorageListener>()

  function View() {
    const state = useChromeStorageValue({
      areaName: "local",
      key: ["queue", "revision"],
      initialValue: {},
      parse,
    })
    refresh = state.refresh
    return createElement(
      "output",
      null,
      `${state.status}: ${state.value.queue}/${state.value.revision}`
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      storage: {
        local: { get },
        onChanged: {
          addListener: (listener: StorageListener) => listeners.add(listener),
          removeListener: (listener: StorageListener) =>
            listeners.delete(listener),
        },
      },
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    listeners.clear()
    vi.resetAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("reads all requested keys, filters unrelated events, and stops after unmount", async () => {
    get.mockResolvedValue({ queue: "known", revision: 1 })
    await act(async () => root.render(createElement(View)))
    expect(container.textContent).toBe("ready: known/1")
    expect(get).toHaveBeenCalledWith(["queue", "revision"])
    await act(async () => vi.runAllTimersAsync())
    get.mockClear()
    await act(async () =>
      listeners.forEach((listener) => {
        listener({ queue: {} }, "session")
        listener({ other: {} }, "local")
      })
    )
    expect(get).not.toHaveBeenCalled()

    get.mockResolvedValue({ queue: "known", revision: 2 })
    await act(async () =>
      listeners.forEach((listener) => listener({ revision: {} }, "local"))
    )
    expect(container.textContent).toBe("ready: known/2")
    await act(async () => root.render(null))
    expect(listeners.size).toBe(0)
  })

  it("cancels its deferred read and ignores a pending read when the consumer leaves", async () => {
    const pending = Promise.withResolvers<Record<string, unknown>>()
    get.mockReturnValue(pending.promise)
    await act(async () => root.render(createElement(View)))
    expect(container.textContent).toBe("loading: undefined/undefined")
    await act(async () => root.render(null))
    await act(async () => {
      await vi.runAllTimersAsync()
      pending.resolve({ queue: "late", revision: 1 })
    })
    expect(get).toHaveBeenCalledOnce()
    expect(container.textContent).toBe("")
    expect(listeners.size).toBe(0)
  })

  it("keeps the refresh callback and storage subscription through ordinary rerenders", async () => {
    get.mockResolvedValue({ queue: "known", revision: 1 })
    await act(async () => root.render(createElement(View)))
    await act(async () => vi.runAllTimersAsync())
    const initialRefresh = refresh
    const initialListener = [...listeners][0]
    get.mockClear()

    await act(async () => root.render(createElement(View)))
    expect(refresh).toBe(initialRefresh)
    expect([...listeners]).toEqual([initialListener])
    expect(get).not.toHaveBeenCalled()

    get.mockResolvedValue({ queue: "new", revision: 2 })
    await act(async () => initialRefresh())
    expect(container.textContent).toBe("ready: new/2")
  })
})
