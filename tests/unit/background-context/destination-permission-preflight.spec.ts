import { afterEach, describe, expect, it, vi } from "vitest"
import { DestinationService } from "@/entrypoints/background/destination"

function exposeStoredDirectory(directory: object) {
  const read = vi.fn((handleId: string) => {
    const request = {
      result: handleId === "selected-folder" ? directory : undefined,
      onsuccess: undefined as (() => void) | undefined,
    }
    queueMicrotask(() => {
      request.onsuccess?.()
      transaction.oncomplete?.()
    })
    return request
  })
  const transaction = {
    objectStore: () => ({ get: read }),
    oncomplete: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
  }
  const database = {
    transaction: () => transaction,
    close: vi.fn(),
    onversionchange: undefined,
  }
  vi.stubGlobal("indexedDB", {
    open: () => {
      const opening = {
        result: database,
        onsuccess: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
      }
      queueMicrotask(() => opening.onsuccess?.())
      return opening
    },
  })
  return { read, database }
}

afterEach(() => vi.unstubAllGlobals())

describe("captured directory write permission", () => {
  it("rejects a readable directory whose write permission was denied", async () => {
    const queryPermission = vi.fn(async ({ mode }: { mode: string }) =>
      mode === "readwrite" ? "denied" : "granted"
    )
    const requestPermission = vi.fn()
    const storage = exposeStoredDirectory({
      kind: "directory",
      name: "Selected folder",
      queryPermission,
      requestPermission,
    })
    await expect(
      new DestinationService().preflight({
        taskId: "task",
        destination: {
          kind: "file-system-access",
          handleId: "selected-folder",
        },
      })
    ).resolves.toEqual({ ready: false, reason: "permission_denied" })
    expect(storage.read).toHaveBeenCalledExactlyOnceWith("selected-folder")
    expect(queryPermission).toHaveBeenCalledExactlyOnceWith({
      mode: "readwrite",
    })
    expect(requestPermission).not.toHaveBeenCalled()
    expect(storage.database.close).toHaveBeenCalledOnce()
  })

  it("accepts the captured directory when write permission is granted", async () => {
    const queryPermission = vi.fn(async () => "granted")
    const requestPermission = vi.fn()
    exposeStoredDirectory({
      kind: "directory",
      name: "Selected folder",
      queryPermission,
      requestPermission,
    })
    await expect(
      new DestinationService().preflight({
        taskId: "task",
        destination: {
          kind: "file-system-access",
          handleId: "selected-folder",
        },
      })
    ).resolves.toEqual({ ready: true })
    expect(queryPermission).toHaveBeenCalledExactlyOnceWith({
      mode: "readwrite",
    })
    expect(requestPermission).not.toHaveBeenCalled()
  })
})
