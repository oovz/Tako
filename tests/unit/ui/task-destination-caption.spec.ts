// @vitest-environment happy-dom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DownloadTaskCard } from "@/entrypoints/options/components/DownloadTaskCard"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import type { DownloadTaskState } from "@/src/domain/queue/state"

const load = vi.hoisted(() => vi.fn())
vi.mock("@/src/storage/fs-access", () => ({ loadDownloadRootHandle: load }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  load.mockReset()
  load.mockImplementation(async (id: string) => ({
    name: id === "captured" ? "Task folder" : "New default folder",
  }))
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function task(handleId: string | null): DownloadTaskState {
  return {
    id: "task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    status: "failed",
    created: 1,
    completed: 2,
    chapters: [
      {
        id: "chapter",
        url: "https://mangadex.org/chapter/chapter",
        title: "Chapter",
        index: 0,
        status: "failed",
        lastUpdated: 2,
        requestedPath: "Captured/Chapter.cbz",
        errorCategory: "folder_permission_required",
      },
    ],
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
      destination: { kind: "file-system-access", handleId },
    },
  }
}
async function render(handleId: string | null) {
  await act(async () =>
    root.render(
      React.createElement(DownloadTaskCard, {
        task: task(handleId),
        onCancel: vi.fn(async () => ({ success: true as const })),
        onRetry: vi.fn(async () => undefined),
        onRestart: vi.fn(async () => undefined),
        onRemove: vi.fn(async () => undefined),
      })
    )
  )
}
describe("captured task destination presentation", () => {
  it("shows the exact task folder and requested path beside recovery controls", async () => {
    await render("captured")
    expect(load).toHaveBeenCalledExactlyOnceWith("captured")
    expect(
      container.querySelector("[data-task-destination]")?.textContent
    ).toBe("Task folder/Captured/Chapter.cbz")
    expect(container.textContent).not.toContain("New default folder")
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        /Restart task/.test(button.textContent ?? "")
      )
    ).toBe(true)
  })
  it("explains an unrecoverable historical target and keeps removal available", async () => {
    await render(null)
    expect(load).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Create a new task")
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        /Restart task/.test(button.textContent ?? "")
      )
    ).toBe(false)
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        /Remove/.test(button.textContent ?? "")
      )
    ).toBe(true)
  })
})
