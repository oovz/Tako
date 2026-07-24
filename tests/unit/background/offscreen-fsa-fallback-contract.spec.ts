import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  DestinationService,
  getDestinationIssues,
  recordDestinationIssue,
} from "@/entrypoints/background/destination"
import { DOWNLOAD_ROOT_HANDLE_ID } from "@/src/storage/fs-access"

const mocks = vi.hoisted(() => ({
  loadDownloadRootHandle: vi.fn(),
  detectFsaCapabilities: vi.fn(() => ({
    directoryPicker: true,
    handlePermissionQuery: true,
    handlePermissionRequest: true,
  })),
  queryFsaPermission: vi.fn(),
  notifyDestinationActionRequired: vi.fn(),
}))

vi.mock("@/src/storage/settings-service", () => ({
  settingsService: {
    getSettings: vi.fn(async () => ({ notifications: true })),
  },
}))

vi.mock("@/entrypoints/background/notification-service", () => ({
  getNotificationService: () => ({
    notifyDestinationActionRequired: mocks.notifyDestinationActionRequired,
  }),
}))

vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: mocks.loadDownloadRootHandle,
  detectFsaCapabilities: mocks.detectFsaCapabilities,
  queryFsaPermission: mocks.queryFsaPermission,
  DOWNLOAD_ROOT_HANDLE_ID: "download-root",
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

describe("DestinationService explicit destination contract", () => {
  let storage: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    storage = {}
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => {
            Object.assign(storage, value)
          }),
        },
      },
    })
  })

  it("keeps a frozen Downloads API task independent from FSA state", async () => {
    const service = new DestinationService()
    const context = {
      taskId: "task-downloads",
      destination: "downloads-api" as const,
    }

    await expect(service.preflight(context)).resolves.toEqual({ ready: true })
    await expect(service.getEffectiveDestination(context)).resolves.toEqual({
      kind: "downloads",
    })
    expect(mocks.loadDownloadRootHandle).not.toHaveBeenCalled()
  })

  it("reports a missing custom destination without changing global settings", async () => {
    mocks.loadDownloadRootHandle.mockResolvedValue(undefined)
    const service = new DestinationService()
    const context = {
      taskId: "task-fsa",
      chapterId: "chapter-1",
      destination: "file-system-access" as const,
    }

    await expect(service.preflight(context)).resolves.toEqual({
      ready: false,
      reason: "not_configured",
    })
    expect(await getDestinationIssues()).toEqual([])
  })

  it("resolves the fixed persisted download-root handle for an authorized FSA task", async () => {
    const handle = { name: "Downloads" } as FileSystemDirectoryHandle
    mocks.loadDownloadRootHandle.mockResolvedValue(handle)
    mocks.queryFsaPermission.mockResolvedValue("granted")
    const context = {
      taskId: "task-fsa",
      destination: "file-system-access" as const,
    }

    await expect(
      new DestinationService().getEffectiveDestination(context)
    ).resolves.toEqual({
      kind: "custom",
      handleId: DOWNLOAD_ROOT_HANDLE_ID,
      handle,
    })
  })

  it("honors an explicit task-scoped Downloads API override", async () => {
    const context = {
      taskId: "task-fsa",
      destination: "file-system-access" as const,
      destinationOverride: "downloads-api" as const,
    }

    await expect(
      new DestinationService().getEffectiveDestination(context)
    ).resolves.toEqual({ kind: "downloads" })
    expect(mocks.loadDownloadRootHandle).not.toHaveBeenCalled()
  })

  it("deduplicates a repeated issue without resetting its timestamp", async () => {
    const context = {
      taskId: "task-fsa",
      chapterId: "chapter-1",
      destination: "file-system-access" as const,
    }
    const failure = { ready: false, reason: "permission_denied" } as const

    const original = await recordDestinationIssue(context, failure)
    expect(mocks.notifyDestinationActionRequired).toHaveBeenCalledOnce()
    const repeated = await recordDestinationIssue(context, failure)

    expect(repeated).toEqual(original)
    expect(repeated.occurredAt).toBe(original.occurredAt)
    expect(await getDestinationIssues()).toHaveLength(1)
    expect(mocks.notifyDestinationActionRequired).toHaveBeenCalledOnce()
  })
})
