import { describe, expect, it, vi } from "vitest"

import { writeBlobToPath } from "@/src/storage/fs-access"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

function createNamedError(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

type DirectoryHandleOptions = Partial<FileSystemDirectoryHandle> & {
  queryPermission?: (descriptor: {
    mode: "read" | "readwrite"
  }) => Promise<PermissionState>
  requestPermission?: (descriptor: {
    mode: "read" | "readwrite"
  }) => Promise<PermissionState>
}

function createDirectoryHandle(
  getFileHandle: (name: string) => Promise<unknown> = async () => {
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

describe("writeBlobToPath collision policy", () => {
  it("aborts a failed new write and removes its empty entry", async () => {
    const failure = new Error("disk full")
    const files = new Set<string>()
    const abort = vi.fn(async () => undefined)
    const dir = createDirectoryHandle(
      async (name, options?: { create?: boolean }) => {
        if (!files.has(name) && !options?.create) {
          throw createNamedError("NotFoundError")
        }
        files.add(name)
        return {
          createWritable: async () => ({
            write: async () => {
              throw failure
            },
            close: async () => undefined,
            abort,
          }),
        }
      },
      {
        removeEntry: async (name) => {
          files.delete(name)
        },
      }
    )

    await expect(
      writeBlobToPath(dir, "chapter.cbz", new Blob(["chapter"]), "overwrite")
    ).rejects.toBe(failure)
    expect(abort).toHaveBeenCalledOnce()
    expect(files.size).toBe(0)
  })

  it.each(["open", "write", "close", "cancel"] as const)(
    "preserves a complete target after %s failure",
    async (stage) => {
      const original = new Error(`${stage} failed`)
      const controller = new AbortController()
      let content = "previous complete chapter"
      const abort = vi.fn(async () => undefined)
      const removeEntry = vi.fn(async () => undefined)
      const dir = createDirectoryHandle(
        async () => ({
          createWritable: async () => {
            if (stage === "open") throw original
            return {
              write: async () => {
                if (stage === "write") throw original
              },
              close: async () => {
                if (stage === "close") throw original
                content = "replacement"
              },
              abort,
            }
          },
        }),
        { removeEntry }
      )

      await expect(
        writeBlobToPath(
          dir,
          "chapter.cbz",
          new Blob(["replacement"]),
          "overwrite",
          {
            signal: controller.signal,
            onBytesWritten:
              stage === "cancel" ? () => controller.abort(original) : undefined,
          }
        )
      ).rejects.toBe(original)
      expect(content).toBe("previous complete chapter")
      expect(removeEntry).not.toHaveBeenCalled()
      if (stage !== "open") expect(abort).toHaveBeenCalledOnce()
    }
  )

  it.each(["open", "close", "cancel"] as const)(
    "removes a new entry after %s failure even when abort rejects",
    async (stage) => {
      const original = new Error(`${stage} failed`)
      const controller = new AbortController()
      const entries = new Set<string>()
      const dir = createDirectoryHandle(
        async (name, options?: { create?: boolean }) => {
          if (!entries.has(name) && !options?.create)
            throw createNamedError("NotFoundError")
          entries.add(name)
          return {
            createWritable: async () => {
              if (stage === "open") throw original
              return {
                write: async () => undefined,
                close: async () => {
                  if (stage === "close") throw original
                },
                abort: async () => {
                  throw new Error("abort unavailable")
                },
              }
            },
          }
        },
        {
          removeEntry: async (name) => {
            entries.delete(name)
          },
        }
      )

      await expect(
        writeBlobToPath(
          dir,
          "chapter.cbz",
          new Blob(["replacement"]),
          "overwrite",
          {
            signal: controller.signal,
            onBytesWritten:
              stage === "cancel" ? () => controller.abort(original) : undefined,
          }
        )
      ).rejects.toBe(original)
      expect(entries.size).toBe(0)
    }
  )

  it("preserves the save error when removing a failed new entry also fails", async () => {
    const original = new Error("disk full")
    const dir = createDirectoryHandle(
      async (_name, options?: { create?: boolean }) => {
        if (!options?.create) throw createNamedError("NotFoundError")
        return {
          createWritable: async () => {
            throw original
          },
        }
      },
      {
        removeEntry: async () => {
          throw new Error("folder unavailable")
        },
      }
    )

    await expect(
      writeBlobToPath(dir, "chapter.cbz", new Blob(["chapter"]), "overwrite")
    ).rejects.toBe(original)
  })

  it("uniquifies an existing filename while preserving its extension", async () => {
    const write = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    const createWritable = vi.fn(async () => ({ write, close }))
    const getFileHandle = vi.fn(
      async (name: string, options?: { create?: boolean }) => {
        if (!options?.create && name === "Chapter 001 (2).cbz") {
          throw createNamedError("NotFoundError")
        }
        return { createWritable }
      }
    )
    const dir = createDirectoryHandle(getFileHandle)

    await expect(
      writeBlobToPath(dir, "Chapter 001.cbz", new Blob(["chapter"]), "uniquify")
    ).resolves.toEqual({ status: "written" })

    expect(getFileHandle).toHaveBeenNthCalledWith(1, "Chapter 001.cbz")
    expect(getFileHandle).toHaveBeenNthCalledWith(2, "Chapter 001 (1).cbz")
    expect(getFileHandle).toHaveBeenNthCalledWith(3, "Chapter 001 (2).cbz")
    expect(getFileHandle).toHaveBeenNthCalledWith(4, "Chapter 001 (2).cbz", {
      create: true,
    })
    expect(createWritable).toHaveBeenCalledWith({ keepExistingData: false })
  })

  it("writes the original filename when uniquify finds no existing file", async () => {
    const write = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    const createWritable = vi.fn(async () => ({ write, close }))
    const getFileHandle = vi.fn(
      async (_name: string, options?: { create?: boolean }) => {
        if (!options?.create) {
          throw createNamedError("NotFoundError")
        }
        return { createWritable }
      }
    )
    const dir = createDirectoryHandle(getFileHandle)
    const blob = new Blob(["chapter"])

    await expect(
      writeBlobToPath(dir, "Chapter 001.cbz", blob, "uniquify")
    ).resolves.toEqual({ status: "written" })

    expect(getFileHandle).toHaveBeenNthCalledWith(1, "Chapter 001.cbz")
    expect(getFileHandle).toHaveBeenNthCalledWith(2, "Chapter 001.cbz", {
      create: true,
    })
    expect(createWritable).toHaveBeenCalledWith({ keepExistingData: false })
    expect(write).toHaveBeenCalledWith(blob)
    expect(close).toHaveBeenCalledOnce()
  })

  it("replaces an existing file at the original filename", async () => {
    const write = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    const createWritable = vi.fn(async () => ({ write, close }))
    const getFileHandle = vi.fn(async () => ({ createWritable }))
    const dir = createDirectoryHandle(getFileHandle)
    const blob = new Blob(["replacement"])

    await expect(
      writeBlobToPath(dir, "Chapter 001.cbz", blob, "overwrite")
    ).resolves.toEqual({ status: "written" })

    expect(getFileHandle).toHaveBeenCalledWith("Chapter 001.cbz")
    expect(getFileHandle).toHaveBeenCalledWith("Chapter 001.cbz", {
      create: true,
    })
    expect(createWritable).toHaveBeenCalledWith({ keepExistingData: false })
    expect(write).toHaveBeenCalledWith(blob)
    expect(close).toHaveBeenCalledOnce()
  })

  it("does not report a successful write before close resolves", async () => {
    let resolveClose!: () => void
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve
        })
    )
    const dir = createDirectoryHandle(async () => ({
      createWritable: async () => ({
        write: vi.fn(async () => undefined),
        close,
      }),
    }))
    let settled = false

    const pendingWrite = writeBlobToPath(
      dir,
      "Chapter 001.cbz",
      new Blob(["chapter"]),
      "overwrite"
    ).finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(settled).toBe(false)

    resolveClose()
    await expect(pendingWrite).resolves.toEqual({ status: "written" })
  })

  it("propagates non-missing lookup failures in uniquify mode", async () => {
    const dir = createDirectoryHandle(async () => {
      throw createNamedError("NotAllowedError")
    })

    await expect(
      writeBlobToPath(dir, "Chapter 001.cbz", new Blob(["chapter"]), "uniquify")
    ).rejects.toMatchObject({ name: "NotAllowedError" })
  })
})
