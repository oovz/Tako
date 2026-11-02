// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useUiPreferences } from "@/src/ui/shared/hooks/useUiPreferences"

type StorageListener = Parameters<
  typeof chrome.storage.onChanged.addListener
>[0]

describe("preference query lifetime", () => {
  let root: Root
  let container: HTMLDivElement
  let state: ReturnType<typeof useUiPreferences>
  const listeners = new Set<StorageListener>()
  const sendMessage = vi.fn()
  const preferences = (uiLanguage: "ja" | "ko") => ({
    success: true,
    data: { motionPreference: "reduce", uiLanguage },
  })

  function View() {
    state = useUiPreferences()
    return createElement("output", null, state.value.uiLanguage)
  }

  async function change(
    area: chrome.storage.AreaName = "local",
    key = "settings:global"
  ) {
    await act(async () => {
      listeners.forEach((listener) => listener({ [key]: {} }, area))
    })
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
      storage: {
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
    vi.unstubAllGlobals()
  })

  it("hydrates failures, retains known preferences, and recovers on relevant settings changes", async () => {
    sendMessage.mockRejectedValue("Offline")
    await act(async () => root.render(createElement(View)))
    expect(state.hydrated).toBe(true)
    expect(state.error).toBeInstanceOf(Error)
    expect(container.textContent).toBe("auto")

    sendMessage.mockResolvedValue(preferences("ja"))
    await change("session")
    await change("local", "other-setting")
    expect(sendMessage).toHaveBeenCalledTimes(1)
    await change()
    expect(state.error).toBeNull()
    expect(container.textContent).toBe("ja")

    const failure = new Error("Unavailable")
    sendMessage.mockRejectedValue(failure)
    await change()
    expect(state.error).toBe(failure)
    expect(container.textContent).toBe("ja")
  })

  it.each(["success", "failure"])(
    "ignores an older query's delayed %s",
    async (outcome) => {
      const older = Promise.withResolvers<unknown>()
      sendMessage.mockReturnValueOnce(older.promise)
      await act(async () => root.render(createElement(View)))
      expect(state.hydrated).toBe(false)

      sendMessage.mockResolvedValue(preferences("ko"))
      await change()
      await act(async () => {
        if (outcome === "success") older.resolve(preferences("ja"))
        else older.reject(new Error("Old query"))
      })
      expect(state.hydrated).toBe(true)
      expect(state.error).toBeNull()
      expect(container.textContent).toBe("ko")
    }
  )

  it("releases its storage subscription and ignores a result after unmount", async () => {
    const pending = Promise.withResolvers<unknown>()
    sendMessage.mockReturnValue(pending.promise)
    await act(async () => root.render(createElement(View)))
    const mountedState = state
    expect(listeners.size).toBe(1)
    await act(async () => root.render(null))
    expect(listeners.size).toBe(0)
    await act(async () => pending.resolve(preferences("ja")))
    expect(state).toBe(mountedState)
    expect(state.hydrated).toBe(false)
  })
})
