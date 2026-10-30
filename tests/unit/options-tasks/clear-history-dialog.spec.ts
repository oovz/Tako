// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { ClearHistoryDialog } from "@/entrypoints/options/components/ClearHistoryDialog"

it("retains the history confirmation on failure and prevents duplicate pending submissions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const pending = Promise.withResolvers<boolean>()
  const confirm = vi.fn(async () => true).mockReturnValueOnce(pending.promise)
  const change = vi.fn()
  try {
    await act(async () =>
      root.render(
        createElement(ClearHistoryDialog, {
          open: true,
          onOpenChange: change,
          onConfirm: confirm,
          title: "Clear history",
          description: "Delete saved history",
          confirmLabel: "Clear",
        })
      )
    )
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.textContent === "Clear"
    )!
    await act(async () => button.click())
    expect(button.disabled).toBe(true)
    await act(async () => button.click())
    expect(confirm).toHaveBeenCalledOnce()
    await act(async () => pending.resolve(false))
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    expect(change).not.toHaveBeenCalled()
    await act(async () => button.click())
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(change).toHaveBeenCalledExactlyOnceWith(false)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
