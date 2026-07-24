import { afterEach, describe, expect, it, vi } from "vitest"

import { detectFsaCapabilities } from "@/src/storage/fs-access"

describe("File System Access capability detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("requires the picker, IndexedDB, permission methods, and writable files", () => {
    class TestFileSystemHandle {
      queryPermission() {
        return Promise.resolve("granted")
      }
      requestPermission() {
        return Promise.resolve("granted")
      }
    }
    class TestFileSystemFileHandle {
      createWritable() {
        return Promise.resolve({})
      }
    }
    vi.stubGlobal("showDirectoryPicker", vi.fn())
    vi.stubGlobal("indexedDB", {})
    vi.stubGlobal("FileSystemHandle", TestFileSystemHandle)
    vi.stubGlobal("FileSystemFileHandle", TestFileSystemFileHandle)

    expect(detectFsaCapabilities()).toEqual({
      directoryPicker: true,
      indexedDb: true,
      handlePermissionQuery: true,
      handlePermissionRequest: true,
      writableFile: true,
    })
  })

  it("reports each unavailable browser surface independently", () => {
    vi.stubGlobal("showDirectoryPicker", undefined)
    vi.stubGlobal("indexedDB", undefined)
    vi.stubGlobal("FileSystemHandle", undefined)
    vi.stubGlobal("FileSystemFileHandle", undefined)

    expect(detectFsaCapabilities()).toEqual({
      directoryPicker: false,
      indexedDb: false,
      handlePermissionQuery: false,
      handlePermissionRequest: false,
      writableFile: false,
    })
  })
})
