// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { DownloadTaskCard } from "@/entrypoints/options/components/DownloadTaskCard"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import type { DownloadTaskState } from "@/src/domain/queue/state"
const access = vi.hoisted(() =>
  vi.fn(async () => ({ status: "granted" as const }))
)
vi.mock("@/entrypoints/options/controllers/options-fsa-controller", () => ({
  OptionsFsaController: class {
    grantSavedAccess = access
  },
}))
vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: async () => ({ name: "Captured folder" }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
afterEach(() => vi.unstubAllGlobals())
it("renews the task's captured folder without restarting or changing its recorded error", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = "file-system-access"
  settings.downloads.customDirectoryHandleId = "captured-folder"
  const task: DownloadTaskState = {
    id: "task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    status: "failed",
    created: 1,
    completed: 2,
    errorMessage: "Earlier network failure",
    errorCategory: "network_unavailable",
    settingsSnapshot: createTaskSettingsSnapshot(settings, "mangadex"),
    chapters: [
      {
        id: "earlier",
        title: "Earlier chapter",
        index: 0,
        url: "https://example.com/earlier",
        requestedPath: "Series/Earlier.cbz",
        status: "failed",
        lastUpdated: 2,
        errorCategory: "network_unavailable",
      },
      {
        id: "chapter",
        title: "Chapter",
        index: 0,
        url: "https://example.com/chapter",
        requestedPath: "Series/Chapter.cbz",
        status: "failed",
        lastUpdated: 2,
        errorCategory: "folder_permission_required",
      },
    ],
  }
  const restart = vi.fn(async () => undefined)
  const retry = vi.fn(async () => undefined)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(
        createElement(DownloadTaskCard, {
          task,
          onCancel: vi.fn(async () => ({ success: true as const })),
          onRetry: retry,
          onRestart: restart,
          onRemove: vi.fn(async () => undefined),
        })
      )
    })
    const grant = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Grant access again"
    )!
    expect(grant).toBeDefined()
    await act(async () => grant.click())
    expect(access).toHaveBeenCalledExactlyOnceWith("captured-folder")
    expect(retry).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
    expect(task.status).toBe("failed")
    expect(task.errorMessage).toBe("Earlier network failure")
    expect(task.errorCategory).toBe("network_unavailable")
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
