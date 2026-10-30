// @vitest-environment happy-dom
import { act, createElement, StrictMode, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { CommandCenterTaskRow } from "@/entrypoints/sidepanel/components/CommandCenterTaskRow"
import type { ActiveTaskProgress } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"

type RowProps = ComponentProps<typeof CommandCenterTaskRow>

const task: QueueTaskSummary = {
  id: "task-one",
  seriesKey: "mangadex#one",
  seriesTitle: "Series One",
  siteIntegration: "mangadex",
  destination: { kind: "downloads-api" },
  status: "downloading",
  chapters: { total: 4, completed: 1, unsuccessful: 0 },
  timestamps: { created: 1 },
}

const progress: ActiveTaskProgress = {
  generation: "one",
  revision: 1,
  updatedAt: 1,
  taskId: "task-one",
  status: "downloading",
  stage: "downloading",
  phaseFraction: 0,
  outputCommitted: false,
  imagesProcessed: 5,
  totalImages: 10,
  activeChapterCount: 1,
  activeChapters: [],
}

describe("task row progress lifetime", () => {
  let root: Root
  let container: HTMLDivElement
  let mounted: boolean

  function render(overrides: Partial<RowProps> = {}, strict = false) {
    const props: RowProps = {
      task,
      isCanceling: false,
      isRetrying: false,
      isRestarting: false,
      isRemoving: false,
      isMoving: false,
      isConfirmingCancel: false,
      cancelError: null,
      activeTaskProgress: progress,
      showActiveProgress: true,
      onBeginCancel: vi.fn(),
      onConfirmCancel: vi.fn(),
      onDismissCancel: vi.fn(),
      ...overrides,
    }
    const view = createElement(
      TooltipProvider,
      null,
      createElement(CommandCenterTaskRow, props)
    )
    act(() =>
      root.render(strict ? createElement(StrictMode, null, view) : view)
    )
  }

  function advance(milliseconds: number) {
    act(() => vi.advanceTimersByTime(milliseconds))
  }

  function expectProgress(visible: boolean) {
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(
      visible ? 2 : 0
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: { getURL: (path: string) => path },
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    mounted = true
  })

  afterEach(() => {
    if (mounted) act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("shows only matching active progress and holds a short update through the 500 ms boundary", () => {
    render({ activeTaskProgress: null })
    expectProgress(false)
    render({ activeTaskProgress: { ...progress, taskId: "another-task" } })
    expectProgress(false)
    render({ showActiveProgress: false })
    expectProgress(false)
    render()
    expectProgress(true)
    advance(100)
    render({ activeTaskProgress: null })
    expectProgress(true)
    expect(container.textContent).toContain("1/4")
    advance(399)
    expectProgress(true)
    advance(1)
    expectProgress(false)
  })

  it("cancels a pending hide when progress resumes while keeping the original visible-since time", () => {
    render()
    advance(100)
    render({ showActiveProgress: false })
    expect(vi.getTimerCount()).toBe(1)
    advance(100)
    render({ activeTaskProgress: { ...progress, revision: 2 } })
    expect(vi.getTimerCount()).toBe(0)
    advance(500)
    expectProgress(true)
    render({ showActiveProgress: false })
    expectProgress(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("starts a new visibility window after the preceding progress display has closed", () => {
    render()
    advance(600)
    render({ activeTaskProgress: null })
    expectProgress(false)
    render()
    advance(10)
    render({ activeTaskProgress: null })
    advance(489)
    expectProgress(true)
    advance(1)
    expectProgress(false)
  })

  it("releases a pending hide timer when its mounted row is removed", () => {
    render()
    advance(100)
    render({ activeTaskProgress: null })
    expect(vi.getTimerCount()).toBe(1)
    act(() => root.unmount())
    mounted = false
    expect(vi.getTimerCount()).toBe(0)
    advance(1000)
  })

  it("retains action focus when the row receives another live progress revision", () => {
    const onCancelTask = vi.fn()
    render({ onCancelTask })
    const cancel = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Cancel download"]'
    )!
    cancel.focus()
    expect(document.activeElement).toBe(cancel)
    render({
      onCancelTask,
      activeTaskProgress: { ...progress, revision: 2, imagesProcessed: 6 },
    })
    expect(
      container.querySelector('button[aria-label="Cancel download"]')
    ).toBe(cancel)
    expect(document.activeElement).toBe(cancel)
  })

  it("retains one clock lifetime through StrictMode subscription replay", () => {
    render({}, true)
    expectProgress(true)
    expect(vi.getTimerCount()).toBe(0)
    advance(100)
    render({ activeTaskProgress: null }, true)
    expect(vi.getTimerCount()).toBe(1)
    advance(399)
    expectProgress(true)
    advance(1)
    expectProgress(false)
    render({}, true)
    advance(100)
    render({ activeTaskProgress: null }, true)
    act(() => root.unmount())
    mounted = false
    expect(vi.getTimerCount()).toBe(0)
  })
})
