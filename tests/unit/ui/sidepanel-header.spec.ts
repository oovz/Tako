import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import {
  formatSidePanelCount,
  SidePanelHeader,
} from "@/entrypoints/sidepanel/components/SidePanelHeader"

function renderHeader(hasOptionsActionItems: boolean): string {
  return renderToStaticMarkup(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(SidePanelHeader, {
        activeCount: 0,
        queuedCount: 0,
        hasOptionsActionItems,
        onOpenSettings: () => undefined,
      })
    )
  )
}

describe("SidePanelHeader options action indicator", () => {
  it("caps large queue counts without widening the 360px header", () => {
    expect(formatSidePanelCount(99)).toBe("99")
    expect(formatSidePanelCount(100)).toBe("99+")
    expect(formatSidePanelCount(10_000)).toBe("99+")
  })

  it("renders the settings gear without an action indicator by default", () => {
    const html = renderHeader(false)

    expect(html).toContain('aria-label="Open Options (Advanced Settings)"')
    expect(html).not.toContain('data-testid="options-action-indicator"')
  })

  it("renders an accessible action indicator on the settings gear", () => {
    const html = renderHeader(true)

    expect(html).toContain('aria-label="Open Options (Action item available)"')
    expect(html).toContain('data-testid="options-action-indicator"')
  })
})
