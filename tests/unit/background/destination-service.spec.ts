import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  DestinationService,
  type DestinationBlockResult,
} from "@/entrypoints/background/destination"
import type { DownloadTaskState } from "@/src/domain/queue/state"

const mocks = vi.hoisted(() => ({
  loadDownloadRootHandle: vi.fn(),
  queryFsaPermission: vi.fn(),
  getSettings: vi.fn(),
  notifyDestinationActionRequired: vi.fn(),
  blockTaskForDestination: vi.fn(),
}))

vi.mock("@/src/storage/fs-access", () => ({
  DOWNLOAD_ROOT_HANDLE_ID: "download-root",
  loadDownloadRootHandle: mocks.loadDownloadRootHandle,
  queryFsaPermission: mocks.queryFsaPermission,
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
  let service: DestinationService
  let task: {
    id: string
    status: "queued" | "downloading"
    activeBlock?: "destination_action_required"
    destinationIssue?: unknown
  }

  beforeEach(() => {
    vi.clearAllMocks()
    task = { id: "task-1", status: "downloading" }
    mocks.getSettings.mockResolvedValue({ notifications: true })
    mocks.blockTaskForDestination.mockImplementation(async (input) => {
      if (
        task.activeBlock === "destination_action_required" &&
        (task.destinationIssue as { id?: string } | undefined)?.id ===
          input.destinationIssue.id
      ) {
        return {
          outcome: "unchanged",
          reason: "already-blocked",
        } satisfies DestinationBlockResult
      }
      task = {
        ...task,
        status: "queued",
        activeBlock: "destination_action_required",
        destinationIssue: input.destinationIssue,
      }
      return {
        outcome: "applied",
        task: task as unknown as DownloadTaskState,
      } satisfies DestinationBlockResult
    })
    service = new DestinationService({
      queueRepository: {
        blockTaskForDestination: mocks.blockTaskForDestination,
      },
      settingsReader: { getSettings: mocks.getSettings },
      notifier: {
        notifyDestinationActionRequired: mocks.notifyDestinationActionRequired,
      },
    })
    mocks.loadDownloadRootHandle.mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    mocks.queryFsaPermission.mockResolvedValue("granted")
  })

  it("commits the repair issue through the queue transition", async () => {
    const context = {
      taskId: "task-1",
      chapterId: "chapter-1",
      destination: "file-system-access" as const,
    }

    const result = await service.blockForPreflight(context, {
      ready: false,
      reason: "permission_prompt",
    })

    expect(result.outcome).toBe("applied")
    expect(task).toMatchObject({
      status: "queued",
      activeBlock: "destination_action_required",
      destinationIssue: {
        taskId: "task-1",
        chapterId: "chapter-1",
        kind: "fsa_permission_required",
      },
    })
    expect(mocks.notifyDestinationActionRequired).toHaveBeenCalledOnce()
  })

  it("keeps repeated repair transitions idempotent", async () => {
    const context = {
      taskId: "task-1",
      chapterId: "chapter-1",
      destination: "file-system-access" as const,
    }

    await service.blockForPreflight(context, {
      ready: false,
      reason: "permission_prompt",
    })
    await service.blockForPreflight(context, {
      ready: false,
      reason: "permission_denied",
    })

    expect(mocks.blockTaskForDestination).toHaveBeenCalledTimes(2)
    expect(mocks.notifyDestinationActionRequired).toHaveBeenCalledOnce()
  })

  it("notifies after a committed runtime destination failure", async () => {
    await service.blockForRuntimeIssue({
      context: {
        taskId: "task-1",
        chapterId: "chapter-1",
        destination: "file-system-access",
      },
      kind: "fsa_write_failed",
      errorCategory: "folder_write_failed",
    })

    expect(mocks.notifyDestinationActionRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({ kind: "fsa_write_failed" }),
        notificationsEnabled: true,
      })
    )
  })

  it("retains the committed issue when notification fails", async () => {
    mocks.notifyDestinationActionRequired.mockRejectedValueOnce(
      new Error("notification failed")
    )

    await expect(
      service.blockForPreflight(
        { taskId: "task-1", destination: "file-system-access" },
        { ready: false, reason: "not_configured" }
      )
    ).resolves.toMatchObject({ outcome: "applied" })
    expect(task.destinationIssue).toEqual(
      expect.objectContaining({ kind: "fsa_folder_missing" })
    )
  })

  it("bypasses File System Access checks for an explicit Downloads override", async () => {
    await expect(
      service.preflight({
        taskId: "task-1",
        destination: "file-system-access",
        destinationOverride: "downloads-api",
      })
    ).resolves.toEqual({ ready: true })
    expect(mocks.loadDownloadRootHandle).not.toHaveBeenCalled()
  })

  it("reports unsupported when the stored handle cannot expose permission state", async () => {
    mocks.queryFsaPermission.mockResolvedValue("unsupported")

    await expect(
      service.preflight({
        taskId: "task-1",
        destination: "file-system-access",
      })
    ).resolves.toEqual({ ready: false, reason: "unsupported" })
  })

  it("reports a missing custom-folder handle without requesting permission", async () => {
    mocks.loadDownloadRootHandle.mockResolvedValue(undefined)

    await expect(
      service.preflight({
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
        service.preflight({
          taskId: "task-1",
          destination: "file-system-access",
        })
      ).resolves.toEqual({ ready: false, reason })
    }
  )
})
