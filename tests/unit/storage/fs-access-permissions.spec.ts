import { describe, expect, it, vi } from "vitest"
import {
  checkPermissionBeforeWrite,
  verifyPermission,
} from "@/src/storage/fs-access"

describe("stored directory permission boundaries", () => {
  it("requests read permission and probes the values iterator when entries is unavailable", async () => {
    const next = vi.fn(async () => ({ done: true }))
    const queryPermission = vi.fn(async () => "denied")
    const requestPermission = vi.fn(async () => "granted")
    const handle = {
      queryPermission,
      requestPermission,
      values: () => ({ next }),
    } as unknown as FileSystemDirectoryHandle
    await expect(verifyPermission(handle, false)).resolves.toBe(true)
    expect(queryPermission).toHaveBeenCalledExactlyOnceWith({ mode: "read" })
    expect(requestPermission).toHaveBeenCalledExactlyOnceWith({ mode: "read" })
    expect(next).toHaveBeenCalledOnce()
  })

  it("does not enumerate a directory after the permission request is denied", async () => {
    const entries = vi.fn()
    const handle = {
      queryPermission: async () => "prompt",
      requestPermission: async () => "denied",
      entries,
    } as unknown as FileSystemDirectoryHandle
    await expect(verifyPermission(handle)).resolves.toBe(false)
    expect(entries).not.toHaveBeenCalled()
  })

  it("reports unavailable permission methods without probing the directory", async () => {
    const entries = vi.fn()
    await expect(
      verifyPermission({ entries } as unknown as FileSystemDirectoryHandle)
    ).resolves.toBe(false)
    expect(entries).not.toHaveBeenCalled()
    await expect(
      checkPermissionBeforeWrite({
        entries,
      } as unknown as FileSystemDirectoryHandle)
    ).rejects.toBeInstanceOf(Error)
    expect(entries).not.toHaveBeenCalled()
  })

  it("recognizes a grant even when this handle exposes no enumeration methods", async () => {
    await expect(
      verifyPermission({
        queryPermission: async () => "granted",
      } as unknown as FileSystemDirectoryHandle)
    ).resolves.toBe(true)
  })

  it("classifies permission revoked between query and enumeration", async () => {
    const revoked = new DOMException("revoked", "NotAllowedError")
    const handle = {
      queryPermission: async () => "granted",
      entries: () => ({
        next: async () => {
          throw revoked
        },
      }),
    } as unknown as FileSystemDirectoryHandle
    await expect(checkPermissionBeforeWrite(handle)).rejects.toMatchObject({
      name: "PermissionExpiredError",
      originalError: revoked,
    })
  })

  it.each([new Error("device unavailable"), "device unavailable"])(
    "wraps unexpected directory failures with their original cause",
    async (failure) => {
      const handle = {
        queryPermission: async () => "granted",
        entries: () => ({
          next: async () => {
            throw failure
          },
        }),
      } as unknown as FileSystemDirectoryHandle
      await expect(checkPermissionBeforeWrite(handle)).rejects.toMatchObject({
        cause: failure,
      })
    }
  )
})
