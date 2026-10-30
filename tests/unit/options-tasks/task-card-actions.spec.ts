// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DownloadTaskSection } from "@/entrypoints/options/components/DownloadTaskSection"
import { DownloadTaskCard } from "@/entrypoints/options/components/DownloadTaskCard"
import type { DownloadTaskCardProps } from "@/entrypoints/options/components/DownloadTaskCard"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { t } from "@/src/runtime/i18n"
import type { DownloadTaskState } from "@/src/domain/queue/state"

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
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

function makeTask(status: DownloadTaskState["status"]): DownloadTaskState {
  return {
    id: "task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    status,
    created: 1,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
    chapters: [
      {
        id: "one",
        title: "Chapter one",
        index: 0,
        url: "https://example.com/one",
        requestedPath: "Series/one.cbz",
        status: "completed",
        lastUpdated: 1,
        totalImages: 2,
        saveConfirmedAt: 1,
      },
      {
        id: "two",
        title: "Chapter two",
        index: 1,
        url: "https://example.com/two",
        requestedPath: "Series/two.cbz",
        status: "failed",
        lastUpdated: 1,
        totalImages: 3,
        imagesFailed: 1,
        errorCategory: "network_unavailable",
      },
    ],
  }
}
function callbacks() {
  return {
    onCancel: vi.fn<DownloadTaskCardProps["onCancel"]>(async () => ({
      success: true,
    })),
    onRetry: vi.fn<DownloadTaskCardProps["onRetry"]>(async () => undefined),
    onRestart: vi.fn<DownloadTaskCardProps["onRestart"]>(async () => undefined),
    onRemove: vi.fn<DownloadTaskCardProps["onRemove"]>(async () => undefined),
  }
}
async function render(props: DownloadTaskCardProps) {
  await act(async () => root.render(createElement(DownloadTaskCard, props)))
}
function button(label: string, parent: ParentNode = container) {
  const found = [...parent.querySelectorAll("button")].find(
    (item) => item.textContent === label
  )
  expect(found, `button ${label}`).toBeDefined()
  return found!
}

describe("task card controls", () => {
  it.each(["rejected", "unsuccessful"])(
    "retries queued cancellation after a %s result",
    async (outcome) => {
      const actions = callbacks()
      const pending =
        Promise.withResolvers<Awaited<ReturnType<typeof actions.onCancel>>>()
      actions.onCancel.mockReturnValueOnce(pending.promise)
      await render({ task: makeTask("queued"), ...actions })
      await act(async () => button("Cancel").click())
      expect(button(t("sidepanel_cancelingDownload")).disabled).toBe(true)
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
      await act(async () => {
        if (outcome === "rejected") pending.reject(new Error("transport"))
        else pending.resolve({ success: false, error: "cancel failed" })
      })
      expect(container.textContent).toContain(t("options_toastCancelFailed"))
      await act(async () => button("Cancel").click())
      expect(actions.onCancel).toHaveBeenNthCalledWith(2, "task")
      expect(container.textContent).not.toContain(
        t("options_toastCancelFailed")
      )
    }
  )

  it("requires confirmation for an active task and keeps failure retryable", async () => {
    const actions = callbacks()
    actions.onCancel.mockResolvedValueOnce({
      success: false,
      error: "cancel failed",
    })
    await render({ task: makeTask("downloading"), ...actions })
    await act(async () => button("Cancel").click())
    expect(actions.onCancel).not.toHaveBeenCalled()
    let confirmation = container.querySelector('[role="group"]')!
    expect(confirmation.getAttribute("aria-labelledby")).toBeTruthy()
    await act(async () => button("Yes", confirmation).click())
    expect(confirmation.textContent).toContain(t("options_toastCancelFailed"))
    await act(async () => button("No", confirmation).click())
    expect(container.querySelector('[role="group"]')).toBeNull()
    await act(async () => button("Cancel").click())
    confirmation = container.querySelector('[role="group"]')!
    expect(confirmation.textContent).not.toContain(
      t("options_toastCancelFailed")
    )
    await act(async () => button("Yes", confirmation).click())
    expect(actions.onCancel).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="group"]')).toBeNull()
  })

  it("holds recovery and removal controls pending until the submitted action settles", async () => {
    const actions = callbacks()
    const pending = Promise.withResolvers<void>()
    actions.onRetry.mockReturnValueOnce(pending.promise)
    await render({ task: makeTask("partial_success"), ...actions })
    await act(async () => button("Retry failed chapters").click())
    expect(button("Retry failed chapters").disabled).toBe(true)
    expect(button("Restart task").disabled).toBe(true)
    expect(button("Remove").disabled).toBe(true)
    await act(async () => pending.resolve())
    expect(button("Remove").disabled).toBe(false)
    await act(async () => button("Remove").click())
    expect(actions.onRetry).toHaveBeenCalledExactlyOnceWith("task")
    expect(actions.onRemove).toHaveBeenCalledExactlyOnceWith("task")
    await act(async () => button("Restart task").click())
    expect(actions.onRestart).toHaveBeenCalledExactlyOnceWith("task")
  })

  it("retains chapter row identity when the expanded task changes order", async () => {
    const task = makeTask("partial_success")
    const actions = callbacks()
    await render({ task, ...actions })
    const toggle =
      container.querySelector<HTMLButtonElement>("[aria-expanded]")!
    await act(async () => toggle.click())
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    const table = container.querySelector('[role="table"]')!
    expect(table.id).toBe(toggle.getAttribute("aria-controls"))
    const original = [
      ...table.querySelectorAll('[role="rowgroup"] [role="row"]'),
    ]
    expect(original[1].textContent).toContain(
      "The network connection is unavailable."
    )
    await render({
      task: { ...task, chapters: [...task.chapters].reverse() },
      ...actions,
    })
    const reordered = [
      ...table.querySelectorAll('[role="rowgroup"] [role="row"]'),
    ]
    expect(reordered).toEqual([original[1], original[0]])
  })
})

it("retains expanded chapters when a virtual task scrolls out and returns or the section becomes short", async () => {
  // Supply browser layout dimensions while keeping the real virtualizer and cards.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(120)
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(600)
  const actions = callbacks()
  const tasks = Array.from({ length: 51 }, (_, index) => ({
    ...makeTask("queued"),
    id: `task-${index}`,
    seriesTitle: `Series ${index}`,
  }))
  const renderSection = async (nextTasks: DownloadTaskState[]) => {
    await act(async () =>
      root.render(
        createElement(DownloadTaskSection, {
          tasks: nextTasks,
          title: "Queued",
          icon: null,
          ...actions,
        })
      )
    )
  }
  await renderSection(tasks)
  const toggles = () => [
    ...container.querySelectorAll<HTMLButtonElement>("[aria-expanded]"),
  ]
  expect(toggles().length).toBeGreaterThan(0)
  expect(toggles().length).toBeLessThan(tasks.length)
  await act(async () => toggles()[0].click())
  expect(toggles()[0].getAttribute("aria-expanded")).toBe("true")
  const viewport = container.querySelector<HTMLDivElement>(".overflow-auto")!
  await act(async () => {
    viewport.scrollTop = 2400
    viewport.dispatchEvent(new Event("scroll"))
  })
  expect(container.textContent).not.toContain("Series 0")
  await act(async () => {
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event("scroll"))
  })
  expect(toggles()[0].getAttribute("aria-expanded")).toBe("true")
  await renderSection([tasks[1], tasks[0]])
  expect(
    toggles().map((toggle) => toggle.getAttribute("aria-expanded"))
  ).toEqual(["false", "true"])
})
