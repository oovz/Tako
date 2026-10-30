import { beforeEach, describe, expect, it, vi } from "vitest"
import { validateSettingsDestination } from "@/src/storage/settings-destination-validation"

const mocks = vi.hoisted(() => ({ load: vi.fn(), verify: vi.fn() }))
vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: mocks.load,
  verifyPermission: mocks.verify,
}))

describe("settings destination failure classification", () => {
  beforeEach(() => vi.resetAllMocks())

  it("rejects unknown modes before accessing stored capabilities", async () => {
    expect(await validateSettingsDestination("unknown")).toMatchObject({
      isValid: false,
      error: expect.any(String),
    })
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it("classifies a missing folder reported while loading its handle", async () => {
    mocks.load.mockRejectedValue(new DOMException("deleted", "NotFoundError"))
    const loaded = await validateSettingsDestination("file-system-access")
    const absent = await validateSettingsDestination("file-system-access", null)
    expect(loaded.isValid).toBe(false)
    expect(loaded.error).not.toEqual(absent.error)
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it.each([new Error("storage unavailable"), "unavailable"])(
    "reports handle-loading failures without rejecting the settings validation",
    async (failure) => {
      mocks.load.mockRejectedValue(failure)
      expect(await validateSettingsDestination("file-system-access")).toEqual({
        isValid: false,
        error: expect.any(String),
      })
    }
  )

  it.each(["values", "entries"] as const)(
    "uses %s to distinguish a deleted folder after permission verification fails",
    async (method) => {
      mocks.verify.mockResolvedValue(false)
      const next = vi.fn(async () => {
        throw new DOMException("deleted", "NotFoundError")
      })
      const handle = {
        kind: "directory",
        [method]: () => ({ next }),
      } as unknown as FileSystemDirectoryHandle
      const missing = await validateSettingsDestination(
        "file-system-access",
        handle
      )
      const denied = await validateSettingsDestination("file-system-access", {
        kind: "directory",
      } as FileSystemDirectoryHandle)
      expect(next).toHaveBeenCalledOnce()
      expect(missing.isValid).toBe(false)
      expect(missing.error).not.toEqual(denied.error)
    }
  )

  it("retains permission denial when directory enumeration fails for another reason", async () => {
    mocks.verify.mockResolvedValue(false)
    const handle = {
      kind: "directory",
      entries: () => ({
        next: async () => {
          throw new Error("cannot enumerate")
        },
      }),
    } as unknown as FileSystemDirectoryHandle
    expect(
      await validateSettingsDestination("file-system-access", handle)
    ).toEqual(
      await validateSettingsDestination("file-system-access", {
        kind: "directory",
      } as FileSystemDirectoryHandle)
    )
  })
})
