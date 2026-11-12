// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import {
  PanelFeedbackProvider,
  usePanelFeedback,
} from "@/entrypoints/sidepanel/components/PanelFeedback"
import { PanelFeedbackRegion } from "@/entrypoints/sidepanel/components/PanelFeedbackRegion"

vi.mock("@/entrypoints/sidepanel/hooks/useErrors", () => ({
  useErrors: () => ({ errors: [], acknowledgeError: vi.fn() }),
}))
vi.mock("@/entrypoints/sidepanel/hooks/useInitFailure", () => ({
  useInitFailure: () => ({ initFailed: false }),
}))

function FeedbackControls() {
  const report = usePanelFeedback()
  return createElement(
    Fragment,
    null,
    createElement("button", { onClick: () => report("queued") }, "Add"),
    createElement(
      "button",
      { onClick: () => report("settingsOpenFailed") },
      "Reject settings"
    ),
    createElement(PanelFeedbackRegion)
  )
}

it("stacks independent messages, expires success sooner, and pauses a focused dismissal", () => {
  vi.useFakeTimers()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    act(() =>
      root.render(
        createElement(PanelFeedbackProvider, {
          children: createElement(FeedbackControls),
        })
      )
    )
    const [add, rejectSettings] = container.querySelectorAll("button")
    act(() => {
      add.click()
      rejectSettings.click()
    })
    const feedback = container.querySelector("[data-panel-feedback]")!
    expect(feedback.querySelector('[role="status"]')?.textContent).toContain(
      "Added to Queue"
    )
    expect(feedback.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not open Settings"
    )
    act(() => vi.advanceTimersByTime(4000))
    expect(feedback.querySelector('[role="status"]')).toBeNull()
    const dismiss = feedback.querySelector("button")!
    act(() => dismiss.focus())
    act(() => vi.advanceTimersByTime(8000))
    expect(feedback.querySelector('[role="alert"]')).not.toBeNull()
    act(() => add.focus())
    act(() => vi.advanceTimersByTime(4000))
    expect(feedback.querySelector('[role="alert"]')).toBeNull()
  } finally {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
