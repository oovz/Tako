import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { InlineConfirmation } from "@/src/ui/shared/components/InlineConfirmation"

describe("InlineConfirmation", () => {
  it("keeps controls disabled and exposes an inline error while an action is pending", () => {
    const html = renderToStaticMarkup(
      React.createElement(InlineConfirmation, {
        title: "Cancel this download?",
        description: "Downloaded files are kept.",
        confirmLabel: "Cancel download",
        pendingLabel: "Canceling download",
        isPending: true,
        errorMessage: "The download has already completed.",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      })
    )

    expect(html).toContain("Canceling download")
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain("The download has already completed.")
    expect(html).toContain('role="group"')
    expect(html).not.toContain("aria-modal")
    expect(html).toMatch(/aria-labelledby="[^"]+"/)
    expect(html).toMatch(/aria-describedby="[^"]+"/)
    expect(html).toContain("flex-wrap")
  })
})
