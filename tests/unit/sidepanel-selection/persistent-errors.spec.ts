// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useErrors } from "@/entrypoints/sidepanel/hooks/useErrors"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"

type StorageListener = Parameters<
  typeof chrome.storage.onChanged.addListener
>[0]
const error = (code: string) => ({
  code,
  message: code,
  severity: "error",
  ts: 1,
})

describe("mounted persistent errors", () => {
  let root: Root
  let container: HTMLDivElement
  let errors: ReturnType<typeof useErrors>
  const sendMessage = vi.fn()
  const listeners = new Set<StorageListener>()
  function View() {
    errors = useErrors()
    return createElement(
      "output",
      null,
      errors.errors.map((item) => item.code).join(",")
    )
  }
  async function changed() {
    await act(async () =>
      listeners.forEach((listener) =>
        listener({ [LOCAL_STORAGE_KEYS.persistentErrors]: {} }, "local")
      )
    )
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
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
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    listeners.clear()
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(["success", "failure"])(
    "retains the latest error snapshot when an older read ends in %s",
    async (outcome) => {
      const first = Promise.withResolvers<unknown>()
      sendMessage
        .mockReturnValueOnce(first.promise)
        .mockResolvedValue({ success: true, data: [error("latest")] })
      await act(async () => root.render(createElement(View)))
      await changed()
      await act(async () => {
        if (outcome === "success")
          first.resolve({ success: true, data: [error("stale")] })
        else first.reject(new Error("stale read failed"))
      })
      expect(container.textContent).toBe("latest")
      expect(listeners.size).toBe(1)
      act(() => root.unmount())
      expect(listeners.size).toBe(0)
    }
  )

  it("acknowledges through the background and keeps the snapshot after a failed refresh", async () => {
    sendMessage
      .mockResolvedValueOnce({ success: true, data: [error("visible")] })
      .mockResolvedValueOnce({ success: false, error: "read failed" })
      .mockResolvedValue({ success: true })
    await act(async () => root.render(createElement(View)))
    await changed()
    expect(container.textContent).toBe("visible")
    await act(async () => {
      await errors.acknowledgeError("")
      await errors.acknowledgeError("visible")
    })
    expect(sendMessage).toHaveBeenCalledTimes(3)
    expect(sendMessage.mock.calls[2][0]).toMatchObject({
      type: "ACKNOWLEDGE_ERROR",
      payload: { code: "visible" },
    })
    expect(container.textContent).toBe("visible")
  })
})
