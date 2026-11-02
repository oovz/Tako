// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InlineConfirmation } from "@/src/ui/shared/components/InlineConfirmation"

describe("inline confirmation interaction", () => {
  let root: Root
  let container: HTMLDivElement
  let trigger: HTMLButtonElement
  const onCancel = vi.fn()
  const onConfirm = vi.fn()

  async function render(isPending = false) {
    await act(async () =>
      root.render(
        createElement(InlineConfirmation, {
          title: "Remove task?",
          confirmLabel: "Remove",
          pendingLabel: "Removing",
          cancelLabel: "Keep",
          isPending,
          onCancel,
          onConfirm,
        })
      )
    )
  }

  function key(value: string, shiftKey = false) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      shiftKey,
      bubbles: true,
      cancelable: true,
    })
    act(() => document.activeElement?.dispatchEvent(event))
    return event
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    trigger = document.createElement("button")
    document.body.append(trigger)
    trigger.focus()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    trigger.remove()
    container.remove()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("cycles keyboard focus between actions and restores the opening control", async () => {
    await render()
    const [cancel, confirm] = container.querySelectorAll("button")
    expect(document.activeElement).toBe(cancel)
    expect(key("Tab").defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(confirm)
    key("Tab", true)
    expect(document.activeElement).toBe(cancel)
    key("Enter")
    expect(onCancel).not.toHaveBeenCalled()
    key("Escape")
    expect(onCancel).toHaveBeenCalledOnce()
    await act(async () => root.render(null))
    expect(document.activeElement).toBe(trigger)
  })

  it("blocks pending actions and Escape, then permits both actions after settlement", async () => {
    await render()
    await render(true)
    const [cancel, confirm] = container.querySelectorAll("button")
    expect(cancel.disabled).toBe(true)
    expect(confirm.disabled).toBe(true)
    expect(confirm.textContent).toBe("Removing")
    key("Escape")
    act(() => {
      cancel.click()
      confirm.click()
    })
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    await render()
    act(() => {
      cancel.click()
      confirm.click()
    })
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
