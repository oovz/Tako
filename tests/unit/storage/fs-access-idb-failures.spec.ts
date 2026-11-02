import { describe, expect, it, vi } from "vitest"
import { saveDownloadRootHandle } from "@/src/storage/fs-access"

function transactionHarness() {
  const request = {
    error: null as DOMException | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  }
  const transaction = {
    error: null as DOMException | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    oncomplete: null as (() => void) | null,
    objectStore: () => ({ add: () => request }),
  }
  const database = {
    transaction: vi.fn(() => transaction),
    close: vi.fn(),
    onversionchange: null,
  }
  const opening = {
    result: database,
    error: null as DOMException | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  }
  vi.stubGlobal("indexedDB", { open: () => opening })
  return { request, transaction, database, opening }
}

describe("directory capability persistence failures", () => {
  const handle = { kind: "directory" } as FileSystemDirectoryHandle

  it("propagates database opening failure before starting a transaction", async () => {
    const harness = transactionHarness()
    const failure = new DOMException("database unavailable", "UnknownError")
    const pending = saveDownloadRootHandle(handle, "selected")
    const rejected = expect(pending).rejects.toBe(failure)
    harness.opening.error = failure
    harness.opening.onerror?.()
    await rejected
    expect(harness.database.transaction).not.toHaveBeenCalled()
    expect(harness.database.close).not.toHaveBeenCalled()
  })

  it.each([new Error("cannot transact"), "cannot transact"])(
    "closes an opened database when constructing the transaction fails",
    async (failure) => {
      const harness = transactionHarness()
      harness.database.transaction.mockImplementation(() => {
        throw failure
      })
      const pending = saveDownloadRootHandle(handle, "selected")
      const rejected = expect(pending).rejects.toBeInstanceOf(Error)
      harness.opening.onsuccess?.()
      await rejected
      expect(harness.database.close).toHaveBeenCalledOnce()
    }
  )

  it.each(["oncomplete", "onerror", "onabort"] as const)(
    "retains the request error when the transaction emits %s",
    async (event) => {
      const harness = transactionHarness()
      const failure = new DOMException("ID already bound", "ConstraintError")
      const pending = saveDownloadRootHandle(handle, "selected")
      const rejected = expect(pending).rejects.toBe(failure)
      harness.opening.onsuccess?.()
      await vi.waitFor(() =>
        expect(harness.request.onerror).toBeTypeOf("function")
      )
      harness.request.error = failure
      harness.request.onerror?.()
      harness.transaction.error = new DOMException(
        "transaction stopped",
        "AbortError"
      )
      harness.transaction[event]?.()
      await rejected
      harness.transaction.oncomplete?.()
      expect(harness.database.close).toHaveBeenCalledOnce()
    }
  )

  it.each(["onerror", "onabort"] as const)(
    "rejects a transaction %s event even if the browser supplied no error object",
    async (event) => {
      const harness = transactionHarness()
      const pending = saveDownloadRootHandle(handle, "selected")
      const rejected = expect(pending).rejects.toBeInstanceOf(Error)
      harness.opening.onsuccess?.()
      await vi.waitFor(() =>
        expect(harness.transaction[event]).toBeTypeOf("function")
      )
      harness.transaction[event]?.()
      await rejected
      expect(harness.database.close).toHaveBeenCalledOnce()
    }
  )
})
