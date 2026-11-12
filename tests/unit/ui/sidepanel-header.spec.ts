import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import {
  formatSidePanelCount,
  SidePanelHeader,
} from "@/entrypoints/sidepanel/components/SidePanelHeader"
import type { OptionsActionItemSeverity } from "@/src/runtime/options-action-items"

function renderHeader(
  optionsActionSeverity: OptionsActionItemSeverity | null
): string {
  return renderToStaticMarkup(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(SidePanelHeader, {
        activeCount: 0,
        queuedCount: 0,
        optionsActionSeverity,
        onOpenSettings: () => undefined,
      })
    )
  )
}

describe("SidePanelHeader options action indicator", () => {
  it("caps large queue counts without widening the 360px header", () => {
    expect(formatSidePanelCount(null)).toBe("—")
    expect(formatSidePanelCount(99)).toBe("99")
    expect(formatSidePanelCount(100)).toBe("99+")
    expect(formatSidePanelCount(10_000)).toBe("99+")
  })

  it("renders the settings gear without an action indicator by default", () => {
    const html = renderHeader(null)

    expect(html).toContain('aria-label="Open Options (Advanced Settings)"')
    expect(html).not.toContain('data-testid="options-action-indicator"')
  })

  it("renders a warning indicator on the settings gear for warning items", () => {
    const html = renderHeader("warning")

    expect(html).toContain('aria-label="Open Options (Action item available)"')
    expect(html).toContain('data-severity="warning"')
    expect(html).toContain("bg-amber-500")
  })

  it("renders an error indicator on the settings gear for error items", () => {
    const html = renderHeader("error")

    expect(html).toContain('data-severity="error"')
    expect(html).toContain("bg-destructive")
  })
})
