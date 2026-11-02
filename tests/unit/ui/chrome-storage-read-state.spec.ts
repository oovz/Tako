// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useChromeStorageValue } from "@/src/ui/shared/hooks/useChromeStorageValue"

type StorageListener = Parameters<
  typeof chrome.storage.onChanged.addListener
>[0]
const parse = (raw: unknown): string[] => {
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    throw new Error("Invalid projection")
  }
  return raw
}

describe("rendered storage subscription", () => {
  let root: Root
  let container: HTMLDivElement
  let state: ReturnType<typeof useChromeStorageValue<string[]>>
  const listeners = new Set<StorageListener>()
  const get = vi.fn()
  const addListener = vi.fn((listener: StorageListener) =>
    listeners.add(listener)
  )

  function View() {
    state = useChromeStorageValue({
      areaName: "session",
      key: "queue",
      initialValue: [],
      parse,
    })
    return createElement(
      "output",
      null,
      `${state.status}: ${state.value.join(",")}`
    )
  }

  async function mount() {
    await act(async () => {
      root.render(createElement(View))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }

  async function change() {
    await act(async () => {
      listeners.forEach((listener) => listener({ queue: {} }, "session"))
    })
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      storage: {
        session: { get },
        onChanged: {
          addListener,
          removeListener: (listener: StorageListener) =>
            listeners.delete(listener),
        },
      },
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    listeners.clear()
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(["read", "parse"])(
    "distinguishes initial %s failure from a successfully empty projection and recovers",
    async (failure) => {
      if (failure === "read")
        get.mockRejectedValue(new Error("private storage failure"))
      else get.mockResolvedValue({ queue: "malformed" })
      await mount()
      expect(container.textContent).toBe("error: ")
      expect(state.hydrated).toBe(true)
      get.mockResolvedValue({ queue: [] })
      await act(async () => state.refresh())
      expect(container.textContent).toBe("ready: ")
      expect(state.hydrated).toBe(true)
    }
  )

  it("keeps a pending initial read in the loading state", async () => {
    const pending = Promise.withResolvers<Record<string, unknown>>()
    get.mockReturnValue(pending.promise)
    await mount()
    expect(container.textContent).toBe("loading: ")
    expect(state.hydrated).toBe(false)
    await act(async () => pending.resolve({ queue: [] }))
    expect(container.textContent).toBe("ready: ")
  })

  it.each(["read", "parse"])(
    "retains the last successful snapshot after a %s failure",
    async (failure) => {
      get.mockResolvedValue({ queue: ["Known task"] })
      await mount()
      expect(container.textContent).toBe("ready: Known task")
      if (failure === "read")
        get.mockRejectedValue(new Error("Storage unavailable"))
      else get.mockResolvedValue({ queue: { malformed: true } })
      await change()
      expect(container.textContent).toBe("stale: Known task")
      get.mockResolvedValue({ queue: ["Recovered task"] })
      await act(async () => state.refresh())
      expect(container.textContent).toBe("ready: Recovered task")
    }
  )

  it("retries a failed subscription before accepting a new read", async () => {
    addListener.mockImplementationOnce(() => {
      throw new Error("Subscription failed")
    })
    get.mockResolvedValue({ queue: [] })
    await mount()
    expect(container.textContent).toBe("error: ")
    await act(async () => state.refresh())
    expect(container.textContent).toBe("ready: ")
    get.mockResolvedValue({ queue: ["New task"] })
    await change()
    expect(container.textContent).toBe("ready: New task")
  })

  it.each(["success", "failure"])(
    "ignores an older read's delayed %s",
    async (outcome) => {
      get.mockResolvedValue({ queue: [] })
      await mount()
      const older = Promise.withResolvers<Record<string, unknown>>()
      get.mockReturnValueOnce(older.promise)
      await change()
      get.mockResolvedValue({ queue: ["Latest task"] })
      await change()
      await act(async () => {
        if (outcome === "success") older.resolve({ queue: ["Old task"] })
        else older.reject(new Error("Old failure"))
      })
      expect(container.textContent).toBe("ready: Latest task")
    }
  )
})
