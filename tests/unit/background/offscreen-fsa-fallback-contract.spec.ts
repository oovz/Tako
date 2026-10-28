import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  DestinationService,
  type DestinationBlockResult,
} from "@/entrypoints/background/destination"
import type { DownloadTaskState } from "@/src/domain/queue/state"

const mocks = vi.hoisted(() => ({
  loadDownloadRootHandle: vi.fn(),
  queryFsaPermission: vi.fn(),
  notifyDestinationActionRequired: vi.fn(),
  blockTaskForDestination: vi.fn(),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: mocks.loadDownloadRootHandle,
  queryFsaPermission: mocks.queryFsaPermission,
  DOWNLOAD_ROOT_HANDLE_ID: "download-root",
}))

describe("DestinationService explicit destination contract", () => {
  let service: DestinationService

  beforeEach(() => {
    vi.clearAllMocks()
    let committedIssueId: string | undefined
    mocks.blockTaskForDestination.mockImplementation(async (input) => {
      if (input.destinationIssue.id === committedIssueId) {
        return {
          outcome: "unchanged",
          reason: "already-blocked",
        } satisfies DestinationBlockResult
      }
      committedIssueId = input.destinationIssue.id
      return {
        outcome: "applied",
        task: {} as DownloadTaskState,
      } satisfies DestinationBlockResult
    })
    service = new DestinationService({
      queueRepository: {
        blockTaskForDestination: mocks.blockTaskForDestination,
      },
      settingsReader: {
        getSettings: async () => ({
          notifications: true,
          downloads: { customDirectoryHandleId: "selected-id" },
        }),
      },
      notifier: {
        notifyDestinationActionRequired: mocks.notifyDestinationActionRequired,
      },
    })
  })

  it("keeps a frozen Downloads API task independent from FSA state", async () => {
    const context = {
      taskId: "task-downloads",
      destination: { kind: "downloads-api" as const },
    }

    await expect(service.preflight(context)).resolves.toEqual({ ready: true })
    await expect(service.getEffectiveDestination(context)).resolves.toEqual({
      kind: "downloads",
    })
    expect(mocks.loadDownloadRootHandle).not.toHaveBeenCalled()
  })

  it("reports a missing custom destination before the queue owner commits it", async () => {
    mocks.loadDownloadRootHandle.mockResolvedValue(undefined)
    const context = {
      taskId: "task-fsa",
      chapterId: "chapter-1",
      destination: {
        kind: "file-system-access" as const,
        handleId: "test-folder",
      },
    }

    await expect(
      service.getEffectiveDestination(context)
    ).rejects.toMatchObject({
      name: "DestinationPreflightError",
      context,
      result: { ready: false, reason: "not_configured" },
    })
    expect(mocks.blockTaskForDestination).not.toHaveBeenCalled()

    await service.blockForPreflight(context, {
      ready: false,
      reason: "not_configured",
    })
    expect(mocks.blockTaskForDestination).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-fsa",
        destinationIssue: expect.objectContaining({
          taskId: "task-fsa",
          chapterId: "chapter-1",
          kind: "fsa_folder_missing",
        }),
      })
    )
  })

  it("resolves the selected persisted download-root handle for an authorized FSA task", async () => {
    const handle = { name: "Downloads" } as FileSystemDirectoryHandle
    mocks.loadDownloadRootHandle.mockResolvedValue(handle)
    mocks.queryFsaPermission.mockResolvedValue("granted")

    await expect(
      service.getEffectiveDestination({
        taskId: "task-fsa",
        destination: {
          kind: "file-system-access" as const,
          handleId: "test-folder",
        },
      })
    ).resolves.toEqual({
      kind: "custom",
      handleId: "test-folder",
      handle,
    })
  })

  it("notifies once after an atomic destination block", async () => {
    const context = {
      taskId: "task-fsa",
      chapterId: "chapter-1",
      destination: {
        kind: "file-system-access" as const,
        handleId: "test-folder",
      },
    }
    const failure = { ready: false, reason: "permission_denied" } as const

    await service.blockForPreflight(context, failure)
    await service.blockForPreflight(context, failure)

    expect(mocks.notifyDestinationActionRequired).toHaveBeenCalledOnce()
  })
})
