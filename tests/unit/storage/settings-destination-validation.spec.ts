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
    ).resolves.toEqual({
      isValid: false,
      error: "Custom download mode requires a folder. Please select one first.",
    })
    expect(mocks.verifyPermission).not.toHaveBeenCalled()
  })

  it("rejects a custom destination when permission is not granted", async () => {
    const handle = { kind: "directory" } as FileSystemDirectoryHandle
    mocks.loadDownloadRootHandle.mockResolvedValue(handle)
    mocks.verifyPermission.mockResolvedValue(false)
    await expect(
      validateSettingsDestination("file-system-access")
    ).resolves.toEqual({
      isValid: false,
      error:
        "Permission was denied for the selected folder. Choose another folder or grant access.",
    })
    expect(mocks.verifyPermission).toHaveBeenCalledWith(handle, true)
  })

  it("validates a passed handleOverride directly without querying IndexedDB", async () => {
    const handle = { kind: "directory" } as FileSystemDirectoryHandle
    mocks.verifyPermission.mockResolvedValue(true)
    await expect(
      validateSettingsDestination("file-system-access", handle)
    ).resolves.toEqual({ isValid: true })
    expect(mocks.loadDownloadRootHandle).not.toHaveBeenCalled()
    expect(mocks.verifyPermission).toHaveBeenCalledWith(handle, true)
  })

  it("rejects when handleOverride is not a directory", async () => {
    const fileHandle = { kind: "file" } as unknown as FileSystemDirectoryHandle
    await expect(
      validateSettingsDestination("file-system-access", fileHandle)
    ).resolves.toEqual({
      isValid: false,
      error: "Custom download mode requires a folder. Please select one first.",
    })
    expect(mocks.verifyPermission).not.toHaveBeenCalled()
  })

  it("rejects when handleOverride is null", async () => {
    await expect(
      validateSettingsDestination("file-system-access", null)
    ).resolves.toEqual({
      isValid: false,
      error: "Custom download mode requires a folder. Please select one first.",
    })
    expect(mocks.loadDownloadRootHandle).not.toHaveBeenCalled()
  })

  it("rejects a custom destination when the folder was deleted on disk", async () => {
    const notFoundError = new Error("The directory could not be found")
    notFoundError.name = "NotFoundError"
    const handle = {
      kind: "directory",
      entries: () => ({
        next: async () => {
          throw notFoundError
        },
      }),
    } as unknown as FileSystemDirectoryHandle
    mocks.verifyPermission.mockResolvedValue(false)
    await expect(
      validateSettingsDestination("file-system-access", handle)
    ).resolves.toEqual({
      isValid: false,
      error:
        "The selected download folder does not exist or was deleted. Please select a valid folder.",
    })
  })
})
