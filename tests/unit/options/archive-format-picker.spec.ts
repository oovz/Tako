// @vitest-environment happy-dom
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/src/runtime/i18n", () => ({
  t: (key: string) => key,
}))

import { ArchiveFormatPicker } from "@/entrypoints/options/components/ArchiveFormatPicker"

describe("ArchiveFormatPicker", () => {
  it.each(["cbz", "zip", "none"] as const)(
    "reports only %s as selected",
    (value) => {
      const markup = renderToStaticMarkup(
        createElement(ArchiveFormatPicker, {
          showNoArchiveWarning: false,
          value,
          onValueChange: vi.fn(),
        })
      )

      const container = document.createElement("div")
      container.innerHTML = markup
      const checked = container.querySelectorAll(
        '[role="radio"][aria-checked="true"]'
      )
      expect(checked).toHaveLength(1)
      expect(checked[0]?.getAttribute("value")).toBe(value)
    }
  )
})
