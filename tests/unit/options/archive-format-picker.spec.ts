import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  CheckCircle2: () =>
    createElement("span", { "data-testid": "selected-format" }),
  Circle: () => null,
  FileArchive: () => null,
  Files: () => null,
  FileType: () => null,
}))

vi.mock("@/src/runtime/i18n", () => ({
  t: (key: string) => key,
}))

import { ArchiveFormatPicker } from "@/entrypoints/options/components/ArchiveFormatPicker"

describe("ArchiveFormatPicker", () => {
  it.each(["cbz", "zip", "none"] as const)(
    "shows one selected marker for %s",
    (value) => {
      const markup = renderToStaticMarkup(
        createElement(ArchiveFormatPicker, {
          showNoArchiveWarning: false,
          value,
          onValueChange: vi.fn(),
        })
      )

      expect(markup.match(/data-testid="selected-format"/g)).toHaveLength(1)
    }
  )
})
