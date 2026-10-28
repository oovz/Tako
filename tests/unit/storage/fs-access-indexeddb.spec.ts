import { describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"

import {
  loadDownloadRootHandle,
  removeUnusedDownloadRootHandles,
  saveDownloadRootHandle,
} from "@/src/storage/fs-access"

type FakeRequest = {
  result: unknown
  error: DOMException | null
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}

type FakeTransaction = {
  error: DOMException | null
  oncomplete: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
  objectStore: ReturnType<typeof vi.fn>
}

function createRequest(): FakeRequest {
  return {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  }
}

function createIndexedDbHarness() {
  const requests: FakeRequest[] = []
  const transactions: FakeTransaction[] = []
  const objectStore = {
    get: vi.fn(() => {
      const request = createRequest()
      requests.push(request)
      return request
    }),
    put: vi.fn(() => {
      const request = createRequest()
      requests.push(request)
      return request
    }),
    delete: vi.fn(() => {
      const request = createRequest()
      requests.push(request)
      return request
    }),
  }
  const db = {
    objectStoreNames: { contains: vi.fn(() => true) },
    onversionchange: null as (() => void) | null,
    close: vi.fn(),
    transaction: vi.fn(() => {
      const transaction: FakeTransaction = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: vi.fn(() => objectStore),
      }
      transactions.push(transaction)
      return transaction
    }),
  }
  const openRequest = {
    result: db,
    error: null as DOMException | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onupgradeneeded: null as (() => void) | null,
  }
  const indexedDb = {
    open: vi.fn(() => {
      queueMicrotask(() => openRequest.onsuccess?.())
      return openRequest
    }),
  }

  return { db, indexedDb, openRequest, objectStore, requests, transactions }
}

describe("File System Access IndexedDB lifecycle", () => {
  it("reclaims unreferenced capabilities in one completed transaction", async () => {
    const harness = createIndexedDbHarness()
    vi.stubGlobal("indexedDB", harness.indexedDb)
    const pending = removeUnusedDownloadRootHandles(
      new Set(["selected-id", "queued-save-id", "retired-id"]),
      new Set(["selected-id", "queued-save-id"])
    )
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1))
    harness.requests[0].onsuccess?.()
    expect(harness.objectStore.delete).toHaveBeenCalledExactlyOnceWith(
      "retired-id"
    )
    harness.transactions[0].oncomplete?.()
    await expect(pending).resolves.toBeUndefined()
    expect(harness.db.close).toHaveBeenCalledOnce()
  })

  it("loads the capability selected by the committed configuration", async () => {
    const harness = createIndexedDbHarness()
    vi.stubGlobal("indexedDB", harness.indexedDb)
    const previousChrome = globalThis.chrome
    vi.stubGlobal("chrome", {
      ...previousChrome,
      storage: {
        local: {
          get: vi.fn(async () => ({
            "settings:global": {
              ...DEFAULT_SETTINGS,
              downloads: {
                ...DEFAULT_SETTINGS.downloads,
                destination: "file-system-access",
                customDirectoryHandleId: "selected-id",
              },
            },
          })),
        },
      },
    })
    const pending = loadDownloadRootHandle()
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1))
    expect(harness.objectStore.get).toHaveBeenCalledWith("selected-id")
    const handle = { name: "Selected folder" }
    harness.requests[0].result = handle
    harness.requests[0].onsuccess?.()
    harness.transactions[0].oncomplete?.()
    await expect(pending).resolves.toBe(handle)
  })

  it("reports a missing selected capability without reading another key", async () => {
    const harness = createIndexedDbHarness()
    vi.stubGlobal("indexedDB", harness.indexedDb)
    const pending = loadDownloadRootHandle("missing-id")
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1))
    harness.requests[0].onsuccess?.()
    harness.transactions[0].oncomplete?.()
    await expect(pending).resolves.toBeUndefined()
    expect(harness.objectStore.get).toHaveBeenCalledExactlyOnceWith(
      "missing-id"
    )
  })

  it("keeps browser downloads independent of retained folder capabilities", async () => {
    const harness = createIndexedDbHarness()
    vi.stubGlobal("indexedDB", harness.indexedDb)
    await expect(loadDownloadRootHandle(null)).resolves.toBeUndefined()
    expect(harness.indexedDb.open).not.toHaveBeenCalled()
  })

  it("waits for read transaction completion and closes the connection", async () => {
    const harness = createIndexedDbHarness()
    vi.stubGlobal("indexedDB", harness.indexedDb)
    const handle = { name: "downloads" }
    let settled = false

    const pending = loadDownloadRootHandle("folder-id").finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1))
    const [request] = harness.requests
    const [transaction] = harness.transactions
    request.result = handle
    request.onsuccess?.()
    await Promise.resolve()
    expect(settled).toBe(false)

    transaction.oncomplete?.()
    await expect(pending).resolves.toBe(handle)
    expect(harness.db.close).toHaveBeenCalledOnce()
  })

  it.each([
    [
      "save",
      (handle: FileSystemDirectoryHandle) =>
        saveDownloadRootHandle(handle, "folder-id"),
    ],
  ])(
    "closes the connection after %s transaction completion",
    async (_, operation) => {
      const harness = createIndexedDbHarness()
      vi.stubGlobal("indexedDB", harness.indexedDb)

      const pending = operation({
        name: "downloads",
      } as FileSystemDirectoryHandle)
      await vi.waitFor(() => expect(harness.requests).toHaveLength(1))
      const [transaction] = harness.transactions

      transaction.oncomplete?.()
      await expect(pending).resolves.toBeUndefined()
      expect(harness.db.close).toHaveBeenCalledOnce()
    }
  )

  it("closes the connection when a version change is requested", async () => {
    const harness = createIndexedDbHarness()
    vi.stubGlobal("indexedDB", harness.indexedDb)

    const pending = loadDownloadRootHandle("folder-id")
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1))
    harness.db.onversionchange?.()
    expect(harness.db.close).toHaveBeenCalled()

    const [transaction] = harness.transactions
    transaction.oncomplete?.()
    await expect(pending).resolves.toBeUndefined()
  })

  it.each(["onerror", "onabort"] as const)(
    "rejects and closes the connection when a transaction emits %s",
    async (event) => {
      const harness = createIndexedDbHarness()
      vi.stubGlobal("indexedDB", harness.indexedDb)
      const pending = saveDownloadRootHandle(
        {
          name: "downloads",
        } as FileSystemDirectoryHandle,
        "folder-id"
      )
      await vi.waitFor(() => expect(harness.requests).toHaveLength(1))
      const [transaction] = harness.transactions
      const failure = new DOMException(`transaction ${event}`, "AbortError")
      transaction.error = failure

      transaction[event]?.()

      await expect(pending).rejects.toBe(failure)
      expect(harness.db.close).toHaveBeenCalledOnce()
    }
  )
})
