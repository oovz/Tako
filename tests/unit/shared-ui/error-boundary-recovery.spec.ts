// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ErrorBoundary } from "@/src/ui/shared/components/ErrorBoundary"
import logger from "@/src/runtime/logger"

describe("extension page error recovery", () => {
  let root: Root
  let container: HTMLDivElement
  let shouldFail: boolean
  const failure = new Error("Render failed")

  function Content() {
    if (shouldFail) throw failure
    return createElement("output", null, "Page content")
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(logger, "error").mockImplementation(() => {})
    shouldFail = true
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("renders its default recovery action and retries the child after reset", async () => {
    await act(async () =>
      root.render(
        createElement(ErrorBoundary, { children: createElement(Content) })
      )
    )
    expect(container.querySelector("output")).toBeNull()
    const retry = container.querySelector("button")
    expect(retry).not.toBeNull()
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: failure })
    )
    shouldFail = false
    await act(async () => retry!.click())
    expect(container.querySelector("button")).toBeNull()
    expect(container.textContent).toBe("Page content")
  })

  it("passes the captured error and a working reset to a custom fallback", async () => {
    const fallback = vi.fn((error: Error, reset: () => void) =>
      createElement("button", { onClick: reset }, error.message)
    )
    await act(async () =>
      root.render(
        createElement(ErrorBoundary, {
          fallback,
          children: createElement(Content),
        })
      )
    )
    expect(fallback).toHaveBeenCalledWith(failure, expect.any(Function))
    shouldFail = false
    await act(async () => container.querySelector("button")!.click())
    expect(container.textContent).toBe("Page content")
  })
})
