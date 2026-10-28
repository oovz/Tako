// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { useActiveTaskProgress } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"

it("opens the live progress connection after an initial storage read failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const connect = vi.fn(() => ({
    onMessage: { addListener: vi.fn() },
    onDisconnect: { addListener: vi.fn() },
    disconnect: vi.fn(),
  }))
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: vi.fn().mockRejectedValue(new Error("Storage unavailable")),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { connect },
  })
  function Progress() {
    const state = useActiveTaskProgress()
    return createElement(
      "output",
      null,
      state.hydrated ? "initialized" : "loading"
    )
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(Progress)))
    expect(container.textContent).toBe("initialized")
    expect(connect).toHaveBeenCalledWith({ name: "tako-active-task-progress" })
  } finally {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
