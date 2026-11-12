import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { useErrorsMock, useInitFailureMock } = vi.hoisted(() => ({
  useErrorsMock: vi.fn(),
  useInitFailureMock: vi.fn(),
}))

vi.mock("@/entrypoints/sidepanel/hooks/useErrors", () => ({
  useErrors: useErrorsMock,
}))

vi.mock("@/entrypoints/sidepanel/hooks/useInitFailure", () => ({
  useInitFailure: useInitFailureMock,
}))

import { PanelFeedbackRegion } from "@/entrypoints/sidepanel/components/PanelFeedbackRegion"

describe("panel-wide feedback", () => {
  beforeEach(() => {
    useErrorsMock.mockReturnValue({
      errors: [],
      acknowledgeError: vi.fn(),
    })
    useInitFailureMock.mockReturnValue({
      initFailed: false,
      error: undefined,
    })
  })

  it("renders nothing when there are no persistent or initialization errors", () => {
    const html = renderToStaticMarkup(React.createElement(PanelFeedbackRegion))

    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('role="status"')
  })

  it("renders initialization failure from session state", () => {
    useInitFailureMock.mockReturnValue({
      initFailed: true,
      error: "ERR_STORAGE_CORRUPTION secret-detail",
    })

    const html = renderToStaticMarkup(React.createElement(PanelFeedbackRegion))

    expect(html).toContain("Extension initialization failed")
    expect(html).not.toContain("ERR_STORAGE_CORRUPTION")
    expect(html).not.toContain("secret-detail")
    expect(html).toContain("Reload extension")
  })

  it("renders both initialization failure and persistent errors", () => {
    useInitFailureMock.mockReturnValue({
      initFailed: true,
      error: "Extension initialization failed",
    })
    useErrorsMock.mockReturnValue({
      errors: [
        {
          code: "QUEUE_RECOVERY_FAILED",
          message:
            "Queue recovery failed: https://signed.example/?token=secret",
          severity: "error",
          ts: 1,
        },
      ],
      acknowledgeError: vi.fn(),
    })

    const html = renderToStaticMarkup(React.createElement(PanelFeedbackRegion))

    expect(html).toContain("Extension initialization failed")
    expect(html).toContain(
      "The extension needs attention. See the extension console for technical details."
    )
    expect(html).not.toContain("Queue recovery failed")
    expect(html).not.toContain("token=secret")
  })

  it("maps known download error categories without exposing stored details", () => {
    useErrorsMock.mockReturnValue({
      errors: [
        {
          code: "provider_changed",
          message: "unexpected schema at https://signed.example/?token=secret",
          severity: "error",
          ts: 1,
        },
      ],
      acknowledgeError: vi.fn(),
    })

    const html = renderToStaticMarkup(React.createElement(PanelFeedbackRegion))

    expect(html).toContain("This site may have changed.")
    expect(html).not.toContain("unexpected schema")
    expect(html).not.toContain("token=secret")
  })

  it("omits legacy folder alerts handled by the folder recovery flow", () => {
    useErrorsMock.mockReturnValue({
      errors: [
        {
          code: "FSA_HANDLE_INVALID",
          message: "Folder access is no longer valid",
          severity: "warning",
          ts: 1,
        },
      ],
      acknowledgeError: vi.fn(),
    })

    const html = renderToStaticMarkup(React.createElement(PanelFeedbackRegion))

    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('role="status"')
  })
})
