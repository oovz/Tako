import { beforeEach, describe, expect, it, vi } from "vitest"

import { validateSettingsDestination } from "@/src/storage/settings-destination-validation"

const mocks = vi.hoisted(() => ({
  loadDownloadRootHandle: vi.fn(),
  verifyPermission: vi.fn(),
}))

vi.mock("@/src/storage/fs-access", () => ({
  loadDownloadRootHandle: mocks.loadDownloadRootHandle,
  verifyPermission: mocks.verifyPermission,
}))

describe("settings destination validation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("accepts the browser download destination without filesystem access", async () => {
    await expect(validateSettingsDestination("downloads-api")).resolves.toEqual(
      {
        isValid: true,
      }
    )
    expect(mocks.loadDownloadRootHandle).not.toHaveBeenCalled()
  })

  it("rejects a custom destination without a stored handle", async () => {
    mocks.loadDownloadRootHandle.mockResolvedValue(undefined)
    await expect(
      validateSettingsDestination("file-system-access")
    ).resolves.toMatchObject({ isValid: false })
    expect(mocks.verifyPermission).not.toHaveBeenCalled()
  })

  it("rejects a custom destination when permission is not granted", async () => {
    const handle = {} as FileSystemDirectoryHandle
    mocks.loadDownloadRootHandle.mockResolvedValue(handle)
    mocks.verifyPermission.mockResolvedValue(false)
    await expect(
      validateSettingsDestination("file-system-access")
    ).resolves.toMatchObject({ isValid: false })
    expect(mocks.verifyPermission).toHaveBeenCalledWith(handle, true)
  })
})
