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

  it("overwrites the original filename without a preflight existence lookup", async () => {
    const write = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    const createWritable = vi.fn(async () => ({ write, close }))
    const getFileHandle = vi.fn(async () => ({ createWritable }))
    const dir = createDirectoryHandle(getFileHandle)
    const blob = new Blob(["replacement"])

    await expect(
      writeBlobToPath(dir, "Chapter 001.cbz", blob, "overwrite")
    ).resolves.toEqual({ status: "written" })

    expect(getFileHandle).toHaveBeenCalledOnce()
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
