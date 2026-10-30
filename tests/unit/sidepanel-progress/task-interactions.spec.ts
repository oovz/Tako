// @vitest-environment happy-dom

import { act, createElement, type ComponentProps, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { CommandCenterQueue } from "@/entrypoints/sidepanel/components/CommandCenterQueue"
import { CommandCenterTaskActions } from "@/entrypoints/sidepanel/components/CommandCenterTaskActions"
import type { QueueTaskSummary } from "@/src/domain/queue/state"

const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError } }))

function task(
  id: string,
  status: QueueTaskSummary["status"]
): QueueTaskSummary {
  return {
    id,
    seriesKey: `mangadex#${id}`,
    seriesTitle: `Series ${id}`,
    siteIntegration: "mangadex",
    destination: { kind: "downloads-api" },
    status,
    chapters: { total: 2, completed: 1, unsuccessful: 1 },
    timestamps: { created: 1 },
  }
}

describe("task actions through mounted components", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: { getURL: (path: string) => path },
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function render(element: ReactNode) {
    await act(async () =>
      root.render(createElement(TooltipProvider, null, element))
    )
  }

  function button(label: string) {
    const result = Array.from(document.querySelectorAll("button")).find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent === label
    )
    expect(result, label).toBeDefined()
    return result!
  }

  async function click(label: string) {
    await act(async () => button(label).click())
  }

  it("routes queued controls to their task and blocks only the pending action", async () => {
    const onMoveTaskToTop = vi.fn()
    const onBeginCancel = vi.fn()
    const props: ComponentProps<typeof CommandCenterTaskActions> = {
      taskId: "queued",
      status: "queued",
      isCanceling: false,
      isMoving: true,
      canCancel: true,
      canRetryFailed: false,
      canRestart: false,
      canMoveToTop: true,
      canRemove: false,
      onBeginCancel,
      onMoveTaskToTop,
    }
    await render(createElement(CommandCenterTaskActions, props))
    await click("Move task to top")
    await click("Cancel download")
    expect(onMoveTaskToTop).not.toHaveBeenCalled()
    expect(onBeginCancel).toHaveBeenCalledWith("queued")
    await render(
      createElement(CommandCenterTaskActions, { ...props, isMoving: false })
    )
    await click("Move task to top")
    expect(onMoveTaskToTop).toHaveBeenCalledWith("queued")
  })

  it("keeps retry primary and dispatches uncertain restart from the overflow menu", async () => {
    const onRetryFailed = vi.fn()
    const onRestartTask = vi.fn()
    const onRemoveTask = vi.fn()
    const props: ComponentProps<typeof CommandCenterTaskActions> = {
      taskId: "partial",
      status: "partial_success",
      outputUncertain: true,
      isCanceling: false,
      isRestarting: true,
      canCancel: false,
      canRetryFailed: true,
      canRestart: true,
      canMoveToTop: false,
      canRemove: true,
      onBeginCancel: vi.fn(),
      onRetryFailed,
      onRestartTask,
      onRemoveTask,
    }
    await render(createElement(CommandCenterTaskActions, props))
    await click("Retry failed chapters (may create duplicates)")
    await click("Remove")
    expect(onRetryFailed).toHaveBeenCalledWith("partial")
    expect(onRemoveTask).toHaveBeenCalledWith("partial")
    await act(async () =>
      button("More actions").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    )
    const restart = document.querySelector('[role="menuitem"]')
    expect(restart?.textContent).toBe(
      "Retry all chapters (may create duplicates)"
    )
    expect(restart?.getAttribute("aria-disabled")).toBe("true")
    await act(async () =>
      restart?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    )
    expect(onRestartTask).not.toHaveBeenCalled()
    await render(
      createElement(CommandCenterTaskActions, { ...props, isRestarting: false })
    )
    expect(restart?.getAttribute("aria-disabled")).toBeNull()
    await act(async () =>
      restart?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    )
    expect(onRestartTask).toHaveBeenCalledWith("partial")
  })

  it("reports queued cancellation failure without opening confirmation", async () => {
    const onCancelTask = vi.fn(async () => ({
      kind: "failed" as const,
      message: "Try again",
    }))
    await render(
      createElement(CommandCenterQueue, {
        tasks: [task("queued", "queued")],
        onCancelTask,
      })
    )
    await click("Cancel download")
    expect(onCancelTask).toHaveBeenCalledWith("queued")
    expect(toastError).toHaveBeenCalledWith("Try again")
    expect(container.querySelector('[role="group"]')).toBeNull()
  })

  it("retains active confirmation after failure or pending, then dismisses after success", async () => {
    const onCancelTask = vi
      .fn()
      .mockResolvedValueOnce({ kind: "failed", message: "Try again" })
      .mockResolvedValueOnce({ kind: "already-pending" })
      .mockResolvedValueOnce({ kind: "completed" })
    await render(
      createElement(CommandCenterQueue, {
        tasks: [task("active", "downloading")],
        onCancelTask,
      })
    )
    await click("Cancel download")
    expect(onCancelTask).not.toHaveBeenCalled()
    const confirmLabel = button("Yes").textContent!
    await click(confirmLabel)
    expect(container.textContent).toContain("Try again")
    await click(confirmLabel)
    expect(container.querySelector('[role="group"]')).not.toBeNull()
    await click(confirmLabel)
    expect(container.querySelector('[role="group"]')).toBeNull()
    expect(onCancelTask).toHaveBeenCalledTimes(3)
    await click("Cancel download")
    expect(container.textContent).not.toContain("Try again")
    await click("No")
    expect(container.querySelector('[role="group"]')).toBeNull()
  })
})
