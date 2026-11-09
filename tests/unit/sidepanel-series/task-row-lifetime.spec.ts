// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { CommandCenterTaskRow } from "@/entrypoints/sidepanel/components/CommandCenterTaskRow"
import type { ActiveTaskProgress } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgress"
import type { QueueTaskSummary } from "@/src/domain/queue/state"

type Props = ComponentProps<typeof CommandCenterTaskRow>
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
  phaseFraction: 0.5,
  overallFraction: 0.45,
  outputCommitted: false,
  imagesProcessed: 5,
  totalImages: 10,
  activeChapterCount: 1,
  activeChapters: [],
}
describe("task progress and details lifetime", () => {
  let root: Root
  let container: HTMLDivElement
  const listeners = new Set<unknown>()
  const sendMessage = vi.fn()
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: { getURL: (path: string) => path, sendMessage },
      storage: {
        onChanged: {
          addListener: (listener: unknown) => listeners.add(listener),
          removeListener: (listener: unknown) => listeners.delete(listener),
        },
      },
    })
    sendMessage.mockResolvedValue({ success: true, task: null })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    listeners.clear()
  })
  async function render(overrides: Partial<Props> = {}) {
    await act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(CommandCenterTaskRow, {
            task,
            activeTaskProgress: progress,
            showActiveProgress: true,
            isCanceling: false,
            isRetrying: false,
            isRestarting: false,
            isRemoving: false,
            isMoving: false,
            isConfirmingCancel: false,
            cancelError: null,
            onBeginCancel: vi.fn(),
            onConfirmCancel: vi.fn(),
            onDismissCancel: vi.fn(),
            onCancelTask: vi.fn(),
            ...overrides,
          })
        )
      )
    )
  }
  it("shows task progress and keeps the estimate monotonic while a live projection clears", async () => {
    await render()
    expect(container.querySelector(".ring-percent")?.textContent).toBe("45%")
    const cancel = container.querySelector<HTMLButtonElement>(".task-ring")!
    cancel.focus()
    await render({ activeTaskProgress: null })
    expect(container.querySelector(".ring-percent")?.textContent).toBe("45%")
    expect(document.activeElement).toBe(cancel)
    expect(container.querySelector("progress")).toBeNull()
    await render({
      activeTaskProgress: { ...progress, overallFraction: 0.6, revision: 2 },
    })
    expect(container.querySelector(".ring-percent")?.textContent).toBe("60%")
    expect(document.activeElement).toBe(cancel)
  })
  it("never claims completion before saving is confirmed", async () => {
    await render({
      activeTaskProgress: { ...progress, overallFraction: 1, stage: "saving" },
    })
    expect(container.querySelector(".ring-percent")?.textContent).toBe("99%")
    expect(
      container.querySelector(".task-chapter-status")?.textContent
    ).toContain("Waiting for confirmation")
  })
  it("does not use another task's progress and resets the ring for a new task identity", async () => {
    await render({ activeTaskProgress: { ...progress, taskId: "different" } })
    expect(container.querySelector(".ring-percent")?.textContent).toBe("25%")
    await render({
      task: {
        ...task,
        id: "new",
        chapters: { total: 2, completed: 0, unsuccessful: 0 },
      },
      activeTaskProgress: null,
    })
    expect(container.querySelector(".ring-percent")?.textContent).toBe("0%")
  })
  it("subscribes only for an active or expanded task and releases the subscription", async () => {
    await render({ task: { ...task, status: "queued" } })
    expect(listeners.size).toBe(0)
    expect(sendMessage).not.toHaveBeenCalled()
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".queue-task-toggle")!.click()
    )
    expect(listeners.size).toBe(1)
    expect(sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "GET_SIDEPANEL_TASK",
      payload: { taskId: task.id },
    })
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".queue-task-toggle")!.click()
    )
    expect(listeners.size).toBe(0)
  })
})
