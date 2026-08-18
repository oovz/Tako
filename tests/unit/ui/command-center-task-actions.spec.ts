import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { CommandCenterTaskActions } from "@/entrypoints/sidepanel/components/CommandCenterTaskActions"
import { TooltipProvider } from "@/components/ui/tooltip"

describe("CommandCenterTaskActions accessibility", () => {
  it("names the disabled canceling state button", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(CommandCenterTaskActions, {
          taskId: "task-1",
          status: "downloading",
          isCanceling: true,
          canCancel: true,
          canForgetUnobservable: false,
          canRetryFailed: false,
          canRestart: false,
          canMoveToTop: false,
          canRemove: false,
          onBeginCancel: vi.fn(),
        })
      )
    )

    expect(html).toContain('aria-label="Canceling download"')
    expect(html).toContain('disabled=""')
  })

  it("renders inline retry and remove with restart in overflow for partial_success", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(CommandCenterTaskActions, {
          taskId: "task-1",
          status: "partial_success",
          isCanceling: false,
          isRetrying: true,
          isRestarting: false,
          isRemoving: false,
          canCancel: false,
          canForgetUnobservable: false,
          canRetryFailed: true,
          canRestart: true,
          canMoveToTop: false,
          canRemove: true,
          onBeginCancel: vi.fn(),
          onRetryFailed: vi.fn(),
          onRestartTask: vi.fn(),
          onRemoveTask: vi.fn(),
        })
      )
    )

    expect(html.match(/disabled=""/g)).toHaveLength(1)
    expect(html.match(/animate-spin/g)).toHaveLength(1)
    expect(html).toContain('aria-label="More actions"')
    expect(html.match(/<button/g)).toHaveLength(3)
  })

  it("renders inline remove button directly for completed history tasks", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(CommandCenterTaskActions, {
          taskId: "task-1",
          status: "completed",
          isCanceling: false,
          isRetrying: false,
          isRestarting: false,
          isRemoving: false,
          canCancel: false,
          canForgetUnobservable: false,
          canRetryFailed: false,
          canRestart: false,
          canMoveToTop: false,
          canRemove: true,
          onBeginCancel: vi.fn(),
          onRemoveTask: vi.fn(),
        })
      )
    )

    expect(html).toContain('aria-label="Remove"')
    expect(html).not.toContain('aria-label="More actions"')
    expect(html.match(/<button/g)).toHaveLength(1)
  })

  it("renders inline move-to-top and cancel buttons for queued tasks", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(CommandCenterTaskActions, {
          taskId: "task-1",
          status: "queued",
          isCanceling: false,
          isRetrying: false,
          isRestarting: false,
          isRemoving: false,
          canCancel: true,
          canForgetUnobservable: false,
          canRetryFailed: false,
          canRestart: false,
          canMoveToTop: true,
          canRemove: false,
          onBeginCancel: vi.fn(),
          onMoveTaskToTop: vi.fn(),
        })
      )
    )

    expect(html).toContain('aria-label="Move task to top"')
    expect(html).toContain('aria-label="Cancel download"')
    expect(html).not.toContain('aria-label="More actions"')
    expect(html.match(/<button/g)).toHaveLength(2)
  })
})
