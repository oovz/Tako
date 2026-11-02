// @vitest-environment happy-dom
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { OptionsDiscardDialog } from "@/entrypoints/options/main-options-discard-dialog"
import { t } from "@/src/runtime/i18n"

let root: Root
let container: HTMLDivElement
const discardChanges = vi.fn<() => Promise<boolean>>()

function Harness() {
  const [open, onOpenChange] = useState(true)
  return createElement(OptionsDiscardDialog, {
    open,
    onOpenChange,
    discardChanges,
  })
}

function button(key: Parameters<typeof t>[0]) {
  return Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent === t(key)
  )!
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it.each([true, false])(
  "keeps confirmation locked until discard settles (%s)",
  async (discarded) => {
    const pending = Promise.withResolvers<boolean>()
    discardChanges.mockReturnValue(pending.promise)
    await act(async () => root.render(createElement(Harness)))
    await act(async () => button("options_discardChanges").click())
    expect(button("common_cancel").disabled).toBe(true)
    expect(button("common_loading").disabled).toBe(true)
    await act(async () => button("common_cancel").click())
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        })
      )
    })
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(discardChanges).toHaveBeenCalledOnce()
    await act(async () => pending.resolve(discarded))
    expect(document.querySelector('[role="alertdialog"]') !== null).toBe(
      !discarded
    )
    if (!discarded) {
      expect(button("options_discardChanges").disabled).toBe(false)
      discardChanges.mockResolvedValue(true)
      await act(async () => button("options_discardChanges").click())
      expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    }
  }
)

it("cancels confirmation without discarding changes", async () => {
  await act(async () => root.render(createElement(Harness)))
  await act(async () => button("common_cancel").click())
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(discardChanges).not.toHaveBeenCalled()
})
