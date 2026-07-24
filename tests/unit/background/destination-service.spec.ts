import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  DestinationService,
  clearDestinationIssuesForTask,
  getDestinationIssues,
  recordDestinationIssue,
  recordDestinationRuntimeIssue,
} from "@/entrypoints/background/destination"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"

const mocks = vi.hoisted(() => ({
  detectFsaCapabilities: vi.fn(),
  loadDownloadRootHandle: vi.fn(),
  queryFsaPermission: vi.fn(),
  getSettings: vi.fn(),
  notifyDestinationActionRequired: vi.fn(),
}))

vi.mock("@/src/storage/fs-access", () => ({
  DOWNLOAD_ROOT_HANDLE_ID: "download-root",
  detectFsaCapabilities: mocks.detectFsaCapabilities,
  loadDownloadRootHandle: mocks.loadDownloadRootHandle,
  queryFsaPermission: mocks.queryFsaPermission,
}))

vi.mock("@/src/storage/settings-service", () => ({
  settingsService: { getSettings: mocks.getSettings },
}))

vi.mock("@/entrypoints/background/notification-service", () => ({
  getNotificationService: () => ({
    notifyDestinationActionRequired: mocks.notifyDestinationActionRequired,
  }),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe("destination service", () => {
  let storage: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    storage = {}
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
          set: vi.fn(async (updates: Record<string, unknown>) => {
            Object.assign(storage, updates)
          }),
        },
      },
    })
    mocks.getSettings.mockResolvedValue({ notifications: true })
    mocks.detectFsaCapabilities.mockReturnValue({
      directoryPicker: true,
      handlePermissionQuery: true,
      handlePermissionRequest: true,
    })
    mocks.loadDownloadRootHandle.mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    mocks.queryFsaPermission.mockResolvedValue("granted")
  })

  it("deduplicates a repeated issue and notification by task, chapter, and kind", async () => {
    const context = {
      taskId: "task-1",
      chapterId: "chapter-1",
      destination: "file-system-access" as const,
    }

    const first = await recordDestinationIssue(context, {
      ready: false,
      reason: "permission_prompt",
    })
    const second = await recordDestinationIssue(context, {
      ready: false,
      reason: "permission_denied",
    })

    expect(second).toEqual(first)
    expect(await getDestinationIssues()).toEqual([first])
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1)
    expect(mocks.notifyDestinationActionRequired).toHaveBeenCalledTimes(1)
  })

  it("keeps different runtime failures as independently actionable issues", async () => {
    const context = {
      taskId: "task-1",
      chapterId: "chapter-1",
      destination: "file-system-access" as const,
    }

    await recordDestinationRuntimeIssue(context, "fsa_write_failed")
    await recordDestinationRuntimeIssue(context, "disk_full")

    expect((await getDestinationIssues()).map((issue) => issue.kind)).toEqual([
      "fsa_write_failed",
      "disk_full",
    ])
    expect(mocks.notifyDestinationActionRequired).toHaveBeenCalledTimes(2)
  })

  it("filters malformed persisted entries and clears every issue for a task", async () => {
    storage[LOCAL_STORAGE_KEYS.destinationIssues] = [
      { invalid: true },
      {
        id: "task-1::fsa_folder_missing",
        taskId: "task-1",
        kind: "fsa_folder_missing",
        occurredAt: 1,
      },
      {
        id: "task-2::disk_full",
        taskId: "task-2",
        kind: "disk_full",
        occurredAt: 2,
      },
    ]

    await clearDestinationIssuesForTask("task-1")

    expect(await getDestinationIssues()).toEqual([
      expect.objectContaining({ taskId: "task-2", kind: "disk_full" }),
    ])
  })

  it("bypasses File System Access checks for an explicit Downloads override", async () => {
    const result = await new DestinationService().preflight({
      taskId: "task-1",
      destination: "file-system-access",
      destinationOverride: "downloads-api",
    })

    expect(result).toEqual({ ready: true })
    expect(mocks.detectFsaCapabilities).not.toHaveBeenCalled()
    expect(mocks.loadDownloadRootHandle).not.toHaveBeenCalled()
  })

  it("reports unsupported when the stored handle cannot expose permission state", async () => {
    mocks.queryFsaPermission.mockResolvedValue("unsupported")

    await expect(
      new DestinationService().preflight({
        taskId: "task-1",
        destination: "file-system-access",
      })
    ).resolves.toEqual({ ready: false, reason: "unsupported" })
    expect(mocks.loadDownloadRootHandle).toHaveBeenCalledTimes(1)
  })

  it("reports a missing custom-folder handle without requesting permission", async () => {
    mocks.loadDownloadRootHandle.mockResolvedValue(undefined)

    await expect(
      new DestinationService().preflight({
        taskId: "task-1",
        destination: "file-system-access",
      })
    ).resolves.toEqual({ ready: false, reason: "not_configured" })
    expect(mocks.queryFsaPermission).not.toHaveBeenCalled()
  })

  it.each([
    ["prompt", "permission_prompt"],
    ["denied", "permission_denied"],
  ] as const)(
    "preserves the %s permission state as %s action-required",
    async (permission, reason) => {
      mocks.queryFsaPermission.mockResolvedValue(permission)

      await expect(
        new DestinationService().preflight({
          taskId: "task-1",
          destination: "file-system-access",
        })
      ).resolves.toEqual({ ready: false, reason })
    }
  )
})
