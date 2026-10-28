import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DestinationService,
  DestinationPreflightError,
} from "@/entrypoints/background/destination"
const mocks = vi.hoisted(() => ({ load: vi.fn(), permission: vi.fn() }))
vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: mocks.load,
  queryFsaPermission: mocks.permission,
}))
const context = {
  taskId: "task",
  destination: {
    kind: "file-system-access" as const,
    handleId: "captured-folder",
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.load.mockResolvedValue({ name: "Folder" })
  mocks.permission.mockResolvedValue("granted")
})
describe("task destination preflight", () => {
  it("checks the captured folder once before production", async () => {
    expect(await new DestinationService().preflight(context)).toEqual({
      ready: true,
    })
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith("captured-folder")
    expect(mocks.permission).toHaveBeenCalledOnce()
  })
  it.each([
    ["prompt", "permission_prompt"],
    ["denied", "permission_denied"],
    ["unsupported", "unsupported"],
    ["error", "folder_unavailable"],
  ] as const)(
    "reports %s without requesting permission",
    async (permission, reason) => {
      mocks.permission.mockResolvedValue(permission)
      expect(await new DestinationService().preflight(context)).toEqual({
        ready: false,
        reason,
      })
    }
  )
  it("preserves a storage failure cause", async () => {
    mocks.load.mockRejectedValue(new Error("IndexedDB read failed"))
    const result = await new DestinationService().preflight(context)
    expect(result).toEqual({
      ready: false,
      reason: "folder_unavailable",
      message: "IndexedDB read failed",
    })
    if (!result.ready)
      expect(new DestinationPreflightError(context, result).message).toBe(
        "IndexedDB read failed"
      )
  })
  it("leaves Chrome tasks independent of folder settings", async () => {
    expect(
      await new DestinationService().preflight({
        taskId: "task",
        destination: { kind: "downloads-api" },
      })
    ).toEqual({ ready: true })
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
