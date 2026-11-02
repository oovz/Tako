// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

describe.each([
  {
    name: "dialog",
    Modal: Dialog,
    Content: DialogContent,
    Header: DialogHeader,
    Footer: DialogFooter,
    Title: DialogTitle,
    Description: DialogDescription,
    Close: DialogClose,
  },
  {
    name: "alert dialog",
    Modal: AlertDialog,
    Content: AlertDialogContent,
    Header: AlertDialogHeader,
    Footer: AlertDialogFooter,
    Title: AlertDialogTitle,
    Description: AlertDialogDescription,
    Close: AlertDialogCancel,
  },
])(
  "$name layout",
  ({ Modal, Content, Header, Footer, Title, Description, Close }) => {
    let root: Root
    let container: HTMLDivElement

    beforeEach(() => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
      container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
    })

    afterEach(async () => {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    })

    it("forwards header and action attributes while preserving accessible modal children", async () => {
      const onHeaderClick = vi.fn()
      const onFooterClick = vi.fn()
      await act(async () =>
        root.render(
          createElement(
            Modal,
            { defaultOpen: true },
            createElement(
              Content,
              null,
              createElement(
                Header,
                {
                  id: "dialog-heading",
                  className: "consumer-heading",
                  title: "Details",
                  onClick: onHeaderClick,
                },
                createElement(Title, null, "Review selection"),
                createElement(Description, null, "Review before continuing.")
              ),
              createElement(
                Footer,
                {
                  id: "dialog-actions",
                  className: "consumer-actions",
                  role: "group",
                  "aria-label": "Selection actions",
                  style: { order: 2 },
                  onClick: onFooterClick,
                },
                createElement(Close, { type: "button" }, "Back")
              )
            )
          )
        )
      )

      const modal = document.querySelector(
        '[role="dialog"], [role="alertdialog"]'
      )!
      const header = document.getElementById("dialog-heading")!
      const footer = document.getElementById("dialog-actions")!
      const title = document.getElementById(
        modal.getAttribute("aria-labelledby")!
      )!
      const description = document.getElementById(
        modal.getAttribute("aria-describedby")!
      )!
      expect(header.tagName).toBe("DIV")
      expect(header.title).toBe("Details")
      expect(header.classList.contains("consumer-heading")).toBe(true)
      expect(title.parentElement).toBe(header)
      expect(title.textContent).toBe("Review selection")
      expect(description.parentElement).toBe(header)
      expect(description.textContent).toBe("Review before continuing.")
      expect(footer.tagName).toBe("DIV")
      expect(footer.classList.contains("consumer-actions")).toBe(true)
      expect(footer.getAttribute("role")).toBe("group")
      expect(footer.getAttribute("aria-label")).toBe("Selection actions")
      expect(footer.style.order).toBe("2")
      await act(async () => header.click())
      expect(onHeaderClick).toHaveBeenCalledOnce()
      await act(async () => footer.querySelector("button")!.click())
      expect(onFooterClick).toHaveBeenCalledOnce()
      expect(modal.isConnected).toBe(false)
    })
  }
)
