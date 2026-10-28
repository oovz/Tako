import { describe, expect, it, vi } from "vitest"

import {
  checkPermissionBeforeWrite,
  verifyPermission,
  writeBlobToPath,
} from "@/src/storage/fs-access"
import {
  DirectoryNotFoundError,
  PermissionExpiredError,
} from "@/src/types/errors"

type FileLookup = (name: string) => Promise<unknown>

type DirectoryHandleOptions = Partial<
  Omit<FileSystemDirectoryHandle, "entries">
> & {
  entries?: unknown
  queryPermission?: (descriptor: {
    mode: "read" | "readwrite"
  }) => Promise<PermissionState>
  requestPermission?: (descriptor: {
    mode: "read" | "readwrite"
  }) => Promise<PermissionState>
}
function createDirectoryHandle(
  getFileHandle: FileLookup = async () => {
    throw createNamedError("NotFoundError")
  },
  options: DirectoryHandleOptions = {}
): FileSystemDirectoryHandle {
  return {
    name: "downloads",
    getFileHandle,
    entries: async function* () {
      yield ["existing", {} as FileSystemFileHandle]
    },
    ...options,
  } as FileSystemDirectoryHandle
}

function createNamedError(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

describe("File System Access helpers", () => {
  describe("verifyPermission", () => {
    it("uses readwrite permission when checking writable access", async () => {
      const calls: Array<{ mode: string }> = []
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async (descriptor) => {
          calls.push(descriptor)
          return "granted"
        },
      })

      await expect(verifyPermission(dir)).resolves.toBe(true)
      expect(calls).toEqual([{ mode: "readwrite" }])
    })

    it("requests permission when the current state is not already granted", async () => {
      const requests: Array<{ mode: string }> = []
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => "prompt",
        requestPermission: async (descriptor) => {
          requests.push(descriptor)
          return "granted"
        },
      })

      await expect(verifyPermission(dir)).resolves.toBe(true)
      expect(requests).toEqual([{ mode: "readwrite" }])
    })

    it("returns false when permission checks fail", async () => {
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => {
          throw createNamedError("NotAllowedError")
        },
      })

      await expect(verifyPermission(dir)).resolves.toBe(false)
    })

    it("returns false when the directory handle points to a deleted folder", async () => {
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => "granted",
        entries: async function* () {
          yield await Promise.reject(createNamedError("NotFoundError"))
        },
      })

      await expect(verifyPermission(dir)).resolves.toBe(false)
    })
  })

  describe("checkPermissionBeforeWrite", () => {
    it("returns when the directory exists and write permission is already granted", async () => {
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => "granted",
      })

      await expect(checkPermissionBeforeWrite(dir)).resolves.toBeUndefined()
    })

    it("rejects with a permission error when write permission is in prompt state", async () => {
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => "prompt",
      })

      await expect(checkPermissionBeforeWrite(dir)).rejects.toBeInstanceOf(
        PermissionExpiredError
      )
    })

    it("rejects with a permission error when write access is denied", async () => {
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => "denied",
      })

      await expect(checkPermissionBeforeWrite(dir)).rejects.toBeInstanceOf(
        PermissionExpiredError
      )
    })

    it("does not misreport a permission-query failure as expired access", async () => {
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => {
          throw new Error("handle store unavailable")
        },
      })

      await expect(checkPermissionBeforeWrite(dir)).rejects.toThrow(
        "Unable to query directory write permission"
      )
    })

    it("rejects with a directory error when the stored handle no longer resolves", async () => {
      const callOrder: string[] = []
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => {
          callOrder.push("permission")
          return "granted"
        },
        entries: (() =>
          ({
            async next() {
              callOrder.push("entries")
              throw createNamedError("NotFoundError")
            },
            [Symbol.asyncIterator]() {
              return this
            },
          }) as unknown as ReturnType<
            FileSystemDirectoryHandle["entries"]
          >) as FileSystemDirectoryHandle["entries"],
      })

      await expect(checkPermissionBeforeWrite(dir)).rejects.toBeInstanceOf(
        DirectoryNotFoundError
      )
      expect(callOrder).toEqual(["permission", "entries"])
    })

    it("reports revoked access as expired permission without enumerating", async () => {
      const entries = vi.fn()
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => "denied",
        entries,
      })

      await expect(checkPermissionBeforeWrite(dir)).rejects.toBeInstanceOf(
        PermissionExpiredError
      )
      expect(entries).not.toHaveBeenCalled()
    })

    it("preserves an abort raised by the directory operation", async () => {
      const abortError = createNamedError("AbortError")
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => "granted",
        entries: (() =>
          ({
            async next() {
              throw abortError
            },
            [Symbol.asyncIterator]() {
              return this
            },
          }) as unknown as ReturnType<
            FileSystemDirectoryHandle["entries"]
          >) as FileSystemDirectoryHandle["entries"],
      })

      await expect(checkPermissionBeforeWrite(dir)).rejects.toBe(abortError)
    })
  })

  describe("writeBlobToPath", () => {
    it("creates nested directories and writes the blob to the leaf file", async () => {
      const written: Blob[] = []
      const closed: string[] = []
      const createdDirectories: string[] = []
      const requestedFiles: string[] = []
      const dir = createDirectoryHandle(
        async (name) => {
          requestedFiles.push(name)
          return {
            createWritable: async () => ({
              write: async (blob: Blob) => {
                written.push(blob)
              },
              close: async () => {
                closed.push(name)
              },
            }),
          }
        },
        {
          getDirectoryHandle: async (name) => {
            createdDirectories.push(name)
            return dir
          },
        }
      )
      const blob = new Blob(["chapter"])

      await expect(
        writeBlobToPath(
          dir,
          "Series/Volume 1/Chapter 001.cbz",
          blob,
          "overwrite"
        )
      ).resolves.toEqual({ status: "written" })

      expect(createdDirectories).toEqual(["Series", "Volume 1"])
      expect(requestedFiles).toEqual(["Chapter 001.cbz", "Chapter 001.cbz"])
      expect(written).toEqual([blob])
      expect(closed).toEqual(["Chapter 001.cbz"])
    })

    it("streams blob writes and reports cumulative bytes when progress is requested", async () => {
      const written: Uint8Array[] = []
      const progress: number[] = []
      const closed: string[] = []
      const aborted: string[] = []
      const dir = createDirectoryHandle(
        async (name) => ({
          createWritable: async () => ({
            write: async (chunk: Uint8Array) => {
              written.push(chunk)
            },
            close: async () => {
              closed.push(name)
            },
            abort: async () => {
              aborted.push(name)
            },
          }),
        }),
        {
          getDirectoryHandle: async () => dir,
        }
      )
      const blob = new Blob([new Uint8Array([1, 2]), new Uint8Array([3, 4])])

      await writeBlobToPath(dir, "Chapter 001.cbz", blob, "overwrite", {
        onBytesWritten: async (bytesWritten) => {
          progress.push(bytesWritten)
        },
      })

      const totalWritten = written.reduce(
        (sum, chunk) => sum + chunk.byteLength,
        0
      )
      expect(totalWritten).toBe(4)
      expect(progress.at(-1)).toBe(4)
      expect(closed).toEqual(["Chapter 001.cbz"])
      expect(aborted).toEqual([])
    })

    it("preserves the native write failure when abort cleanup also fails", async () => {
      const original = new DOMException(
        "Native write lost folder access",
        "NotAllowedError"
      )
      const abort = vi.fn(async () => {
        throw new Error("abort cleanup failed")
      })
      const close = vi.fn(async () => undefined)
      const dir = createDirectoryHandle(async () => ({
        createWritable: async () => ({
          write: async () => {
            throw original
          },
          close,
          abort,
        }),
      }))
      await expect(
        writeBlobToPath(dir, "Chapter.cbz", new Blob(["page"]), "overwrite", {
          signal: new AbortController().signal,
        })
      ).rejects.toBe(original)
      expect(abort).toHaveBeenCalledOnce()
      expect(close).not.toHaveBeenCalled()
    })

    it("propagates file stream closure failures", async () => {
      const original = new DOMException(
        "Native close failed: disk full",
        "QuotaExceededError"
      )
      const dir = createDirectoryHandle(async () => ({
        createWritable: async () => ({
          write: async () => undefined,
          close: async () => {
            throw original
          },
          abort: async () => undefined,
        }),
      }))
      await expect(
        writeBlobToPath(dir, "Chapter.cbz", new Blob(["page"]), "overwrite", {
          signal: new AbortController().signal,
        })
      ).rejects.toBe(original)
    })

    it("uniquifies files without extension or dotfiles correctly", async () => {
      const write = vi.fn(async () => undefined)
      const close = vi.fn(async () => undefined)
      const createWritable = vi.fn(async () => ({ write, close }))
      const getFileHandle = vi.fn(
        async (name: string, options?: { create?: boolean }) => {
          if (
            !options?.create &&
            (name === "README (1)" || name === ".nomedia (1)")
          ) {
            throw createNamedError("NotFoundError")
          }
          return { createWritable }
        }
      )
      const dir = createDirectoryHandle(getFileHandle)

      await expect(
        writeBlobToPath(dir, "README", new Blob(["text"]), "uniquify")
      ).resolves.toEqual({ status: "written" })
      expect(getFileHandle).toHaveBeenNthCalledWith(1, "README")
      expect(getFileHandle).toHaveBeenNthCalledWith(2, "README (1)")
      expect(getFileHandle).toHaveBeenNthCalledWith(3, "README (1)", {
        create: true,
      })

      getFileHandle.mockClear()
      await expect(
        writeBlobToPath(dir, ".nomedia", new Blob([""]), "uniquify")
      ).resolves.toEqual({ status: "written" })
      expect(getFileHandle).toHaveBeenNthCalledWith(1, ".nomedia")
      expect(getFileHandle).toHaveBeenNthCalledWith(2, ".nomedia (1)")
      expect(getFileHandle).toHaveBeenNthCalledWith(3, ".nomedia (1)", {
        create: true,
      })
    })

    it("uniquifies filenames with multiple dots by matching final extension", async () => {
      const write = vi.fn(async () => undefined)
      const close = vi.fn(async () => undefined)
      const createWritable = vi.fn(async () => ({ write, close }))
      const getFileHandle = vi.fn(
        async (name: string, options?: { create?: boolean }) => {
          if (!options?.create && name === "Chapter 01.5 (1).cbz") {
            throw createNamedError("NotFoundError")
          }
          return { createWritable }
        }
      )
      const dir = createDirectoryHandle(getFileHandle)

      await expect(
        writeBlobToPath(
          dir,
          "Chapter 01.5.cbz",
          new Blob(["chapter"]),
          "uniquify"
        )
      ).resolves.toEqual({ status: "written" })
      expect(getFileHandle).toHaveBeenNthCalledWith(1, "Chapter 01.5.cbz")
      expect(getFileHandle).toHaveBeenNthCalledWith(2, "Chapter 01.5 (1).cbz")
      expect(getFileHandle).toHaveBeenNthCalledWith(3, "Chapter 01.5 (1).cbz", {
        create: true,
      })
    })
  })
})
