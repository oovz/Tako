// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { DownloadTaskActionResult } from "@/entrypoints/options/types/download-task-actions"
import { DownloadTaskCard } from "@/entrypoints/options/components/DownloadTaskCard"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { t } from "@/src/runtime/i18n"

const boundary = vi.hoisted(() => ({
  load: vi.fn(),
  permission: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: boundary.load,
  verifyPermission: boundary.permission,
  saveDownloadRootHandle: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: { success: boundary.success, error: boundary.error },
}))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.clearAllMocks()
  boundary.load.mockResolvedValue({ name: "Captured folder" })
  boundary.permission.mockResolvedValue(true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it.each(["granted", "missing", "denied", "rejected"])(
  "reports %s folder access without submitting a new task",
  async (outcome) => {
    if (outcome === "missing") boundary.load.mockResolvedValue(null)
    if (outcome === "denied") boundary.permission.mockResolvedValue(false)
    if (outcome === "rejected")
      boundary.permission.mockRejectedValue(new Error("Permission unavailable"))
    const task: DownloadTaskState = {
      id: "captured-task",
      siteIntegrationId: "mangadex",
      mangaId: "series",
      seriesTitle: "Series",
      status: "failed",
      created: 1,
      settingsSnapshot: {
        ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
        destination: {
          kind: "file-system-access",
          handleId: "captured-folder",
        },
      },
      chapters: [
        {
          id: "chapter",
          title: "Chapter",
          index: 0,
          url: "https://example.com/chapter",
          requestedPath: "Captured/Chapter.cbz",
          status: "failed",
          lastUpdated: 1,
          errorCategory: "folder_permission_required",
        },
      ],
    }
    const restart = vi.fn(async () => undefined)
    await act(async () =>
      root.render(
        createElement(DownloadTaskCard, {
          task,
          onCancel: async (): Promise<DownloadTaskActionResult> => ({
            success: true,
          }),
          onRetry: restart,
          onRestart: restart,
          onRemove: async () => undefined,
        })
      )
    )
    const grant = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("folderAccess_grant")
    )!
    const initialLoads = boundary.load.mock.calls.length
    act(() => grant.click())
    expect(boundary.load).toHaveBeenCalledTimes(initialLoads + 1)
    expect(boundary.load).toHaveBeenLastCalledWith("captured-folder")
    await act(async () => {})
    if (outcome === "granted")
      expect(boundary.success).toHaveBeenCalledExactlyOnceWith(
        t("taskFolder_accessGranted")
      )
    else if (outcome === "rejected")
      expect(boundary.error).toHaveBeenCalledExactlyOnceWith(
        t("taskFolder_accessFailed"),
        { description: "Permission unavailable" }
      )
    else
      expect(boundary.error).toHaveBeenCalledExactlyOnceWith(
        t(
          outcome === "missing"
            ? "settings_customFolderNotFound"
            : "options_toastPermissionDenied"
        )
      )
    expect(restart).not.toHaveBeenCalled()
    expect(task.status).toBe("failed")
    expect(grant.disabled).toBe(false)
  }
)
