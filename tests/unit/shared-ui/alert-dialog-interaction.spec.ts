// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

describe("shared destructive dialog interaction", () => {
  let root: Root
  let container: HTMLDivElement
  const onAction = vi.fn()

  async function render(disabled = false) {
    await act(async () =>
      root.render(
        createElement(
          AlertDialog,
          { defaultOpen: true },
          createElement(
            AlertDialogContent,
            null,
            createElement(
              AlertDialogHeader,
              null,
              createElement(AlertDialogTitle, null, "Remove task?"),
              createElement(
                AlertDialogDescription,
                null,
                "Downloaded files are kept."
              )
            ),
            createElement(
              AlertDialogFooter,
              null,
              createElement(AlertDialogCancel, { type: "button" }, "Keep"),
              createElement(
                AlertDialogAction,
                { type: "button", disabled, onClick: onAction },
                "Remove"
              )
            )
          )
        )
      )
    )
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
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("names the modal, focuses cancel, and closes only after an enabled action", async () => {
    await render(true)
    const dialog = document.querySelector('[role="alertdialog"]')!
    const [cancel, confirm] = dialog.querySelectorAll("button")
    expect(
      document.getElementById(dialog.getAttribute("aria-labelledby")!)
        ?.textContent
    ).toBe("Remove task?")
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby")!)
        ?.textContent
    ).toBe("Downloaded files are kept.")
    expect(document.activeElement).toBe(cancel)
    act(() => confirm.click())
    expect(onAction).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    await render()
    await act(async () => confirm.click())
    expect(onAction).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it("closes through cancel without invoking the destructive action", async () => {
    await render()
    const cancel = document.querySelector(
      '[role="alertdialog"] button'
    ) as HTMLButtonElement
    await act(async () => cancel.click())
    expect(onAction).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })
})
