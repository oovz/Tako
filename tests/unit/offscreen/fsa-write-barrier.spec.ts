import { describe, expect, it, vi } from "vitest"
import { writeFsaOutput } from "@/entrypoints/offscreen/chapter-processing-fsa"

function folder() {
  const writable = {
    write: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  }
  const createWritable = vi.fn(async () => writable)
  const getFileHandle = vi.fn(async () => ({ createWritable }))
  const getDirectoryHandle = vi.fn(async () => ({ getFileHandle }))
  return {
    root: { getDirectoryHandle } as unknown as FileSystemDirectoryHandle,
    getDirectoryHandle,
    getFileHandle,
    createWritable,
    writable,
  }
}

describe("FSA write permission boundary", () => {
  it("waits for durable permission before creating a subdirectory or file", async () => {
    const f = folder()
    let release!: () => void
    const permit = new Promise<void>((resolve) => {
      release = resolve
    })
    const writing = writeFsaOutput({
      beginFsaWrite: () => permit,
      dir: f.root,
      path: "Series/chapter.cbz",
      blob: new Blob(["content"]),
      collisionPolicy: "overwrite",
    })
    await Promise.resolve()
    expect(f.getDirectoryHandle).not.toHaveBeenCalled()
    expect(f.getFileHandle).not.toHaveBeenCalled()
    release()
    await expect(writing).resolves.toEqual({ status: "written" })
    expect(f.getDirectoryHandle).toHaveBeenCalledWith("Series", {
      create: true,
    })
    expect(f.getFileHandle).toHaveBeenCalledWith("chapter.cbz", {
      create: true,
    })
    expect(f.writable.close).toHaveBeenCalledOnce()
  })

  it("does not mutate when persistence or its acknowledgement fails", async () => {
    const f = folder()
    await expect(
      writeFsaOutput({
        beginFsaWrite: async () => {
          throw new Error("receipt unavailable")
        },
        dir: f.root,
        path: "Series/chapter.cbz",
        blob: new Blob(["content"]),
        collisionPolicy: "overwrite",
      })
    ).rejects.toThrow("receipt unavailable")
    expect(f.getDirectoryHandle).not.toHaveBeenCalled()
    expect(f.getFileHandle).not.toHaveBeenCalled()
  })

  it("observes cancellation after a held receipt before its first mutation", async () => {
    const f = folder()
    const controller = new AbortController()
    let release!: () => void
    const permit = new Promise<void>((resolve) => {
      release = resolve
    })
    const writing = writeFsaOutput({
      beginFsaWrite: () => permit,
      signal: controller.signal,
      dir: f.root,
      path: "Series/chapter.cbz",
      blob: new Blob(["content"]),
      collisionPolicy: "overwrite",
    })
    controller.abort()
    release()
    await expect(writing).rejects.toThrow()
    expect(f.getDirectoryHandle).not.toHaveBeenCalled()
  })
})
