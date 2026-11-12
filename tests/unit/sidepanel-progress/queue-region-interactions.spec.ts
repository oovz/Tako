// @vitest-environment happy-dom

import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { SidePanelQueueRegion } from "@/entrypoints/sidepanel/components/SidePanelQueueRegion"
import type { QueueTaskSummary } from "@/src/domain/queue/state"
import { queueCommandClient } from "@/src/ui/shared/queue-command-client"

function task(index: number): QueueTaskSummary {
  return {
    id: `task-${index}`,
    seriesKey: `mangadex#${index}`,
    seriesTitle: `Series ${index}`,
    siteIntegration: "mangadex",
    destination: { kind: "downloads-api" },
    status: "queued",
    chapters: { total: 1, completed: 0, unsuccessful: 0 },
    timestamps: { created: 1 },
  }
}

const baseProps: ComponentProps<typeof SidePanelQueueRegion> = {
  queueTasks: [],
  historyTasks: [],
  isLoading: false,
  readStatus: "ready",
  onRefresh: async () => {},
  cancelingTaskIds: new Set(),
  retryingTaskIds: new Set(),
  restartingTaskIds: new Set(),
  removingTaskIds: new Set(),
  movingTaskIds: new Set(),
  activeTaskProgress: null,
  showActiveProgress: false,
  onCancelTask: () => ({ kind: "completed" }),
  onRetryFailed: () => {},
  onRestartTask: () => {},
  onMoveTaskToTop: () => {},
  onRemoveTask: () => {},
}

describe("mounted queue region", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: {
        getURL: (path: string) => path,
        sendMessage: vi.fn(async () => ({ success: true, task: null })),
      },
      storage: {
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    })
    // happy-dom has no layout engine. Supply the viewport and measured row size
    // at the DOM boundary while exercising the real TanStack virtualizer.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-queue-scroll-container") ? 156 : 78
      }
    )
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-queue-scroll-container") ? 156 : 78
      }
    )
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => vi.runOnlyPendingTimersAsync())
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function render(overrides: Partial<typeof baseProps>) {
    await act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(SidePanelQueueRegion, { ...baseProps, ...overrides })
        )
      )
    )
  }

  function row(id: string) {
    const element = container.querySelector(`[data-queue-task-id="${id}"]`)
    expect(element, id).not.toBeNull()
    return element!
  }

  it("renders a bounded viewport, retains task identity on reorder, and scrolls to later rows", async () => {
    const tasks = Array.from({ length: 30 }, (_, index) => task(index))
    const onMoveTaskToTop = vi.fn()
    await render({ queueTasks: tasks, onMoveTaskToTop })
    const visibleCount = container.querySelectorAll(
      "[data-queue-task-id]"
    ).length
    expect(visibleCount).toBeGreaterThan(0)
    expect(visibleCount).toBeLessThan(tasks.length)
    const firstRow = row("task-0")
    const cancelButton = firstRow.querySelector<HTMLButtonElement>(
      '[aria-label="Cancel download"]'
    )!
    cancelButton.focus()
    expect(firstRow.querySelector('[aria-label="Move task to top"]')).toBeNull()
    await render({
      queueTasks: [tasks[1]!, tasks[0]!, ...tasks.slice(2)],
      onMoveTaskToTop,
    })
    expect(row("task-0")).toBe(firstRow)
    expect(document.activeElement).toBe(cancelButton)
    const viewport = container.querySelector<HTMLDivElement>(
      "[data-queue-scroll-container]"
    )!
    await act(async () => {
      viewport.scrollTop = 78 * 20
      viewport.dispatchEvent(new Event("scroll"))
    })
    expect(row("task-20").textContent).toContain("Series 20")
    expect(container.querySelector('[data-queue-task-id="task-0"]')).toBeNull()
  })

  it("moves from accessible loading to queue rows", async () => {
    const tasks = [task(0)]
    await render({ queueTasks: tasks, isLoading: true })
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelector(".waiting-tasks")).toBeNull()
    await render({ queueTasks: tasks })
    expect(row("task-0").textContent).toContain("Series 0")
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it("shows reorder conflicts in the Queue notice and refreshes its projection", async () => {
    const onRefresh = vi.fn(async () => {})
    vi.spyOn(queueCommandClient, "reorderQueuedTasks").mockRejectedValueOnce(
      new Error("stale-order")
    )
    await render({ queueTasks: [task(0), task(1)], onRefresh })
    await act(async () =>
      row("task-0").querySelector<HTMLButtonElement>(".task-grip")!.click()
    )
    await act(async () =>
      row("task-0")
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    )

    const notice = container.querySelector(".queue-panel-notice")!
    expect(notice.querySelector('[role="alert"]')?.textContent).toBe(
      "The queue changed. Try moving the task again."
    )
    expect(onRefresh).toHaveBeenCalledOnce()
    await act(async () =>
      notice.querySelector<HTMLButtonElement>("button")!.click()
    )
    expect(notice.querySelector('[role="alert"]')).toBeNull()
  })

  it("keeps failed tasks in their last live lanes, including a previously started task that requeued", async () => {
    const active = {
      ...task(0),
      status: "downloading" as const,
      queueIndex: 0,
      timestamps: { created: 1, started: 2 },
    }
    const first = { ...task(1), queueIndex: 1 }
    const requeued = {
      ...task(2),
      queueIndex: 2,
      timestamps: { created: 1, started: 2 },
    }
    const last = { ...task(3), queueIndex: 3 }
    const canceled = { ...task(4), queueIndex: 4 }
    await render({ queueTasks: [active, first, requeued, last, canceled] })
    const previousActiveRow = row("task-0")
    const previousMiddleRow = row("task-2")

    await render({
      queueTasks: [first, last],
      historyTasks: [
        { ...canceled, status: "canceled" },
        { ...requeued, status: "failed" },
        { ...active, status: "failed" },
        { ...task(5), status: "completed", saveConfirmedAt: 10 },
      ],
    })
    expect(row("task-0")).toBe(previousActiveRow)
    expect(row("task-2")).toBe(previousMiddleRow)
    expect(row("task-0").closest(".queue-current")).not.toBeNull()
    const waitingRows = container.querySelectorAll(
      ".waiting-tasks [data-queue-task-id]"
    )
    expect(
      Array.from(waitingRows, (element) =>
        element.getAttribute("data-queue-task-id")
      )
    ).toEqual(["task-1", "task-2", "task-3"])
    expect(container.querySelector('[data-queue-task-id="task-4"]')).toBeNull()
    expect(container.querySelector('[data-queue-task-id="task-5"]')).toBeNull()
    expect(row("task-2").querySelector('[data-queued="true"]')).toBeNull()
    expect(row("task-3").querySelector(".queue-position")?.textContent).toBe(
      "02"
    )
  })
})
