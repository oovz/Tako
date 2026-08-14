import { beforeEach, describe, expect, it, vi } from "vitest"

import { createBackgroundSettingsUiMessageHandlers } from "@/entrypoints/background/background-settings-ui-message-handlers"
import { dispatchRuntimeMessage } from "@/src/runtime/runtime-message-dispatcher"
import { clearPersistentError, getPersistentErrors } from "@/src/runtime/errors"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"

describe("persistent errors query", () => {
  const storageGet = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    storageGet.mockReset()
    vi.stubGlobal("chrome", {
      storage: { local: { get: storageGet } },
    })
  })

  it("treats an absent durable document as an empty list", async () => {
    storageGet.mockResolvedValue({})

    await expect(getPersistentErrors()).resolves.toEqual([])
    expect(storageGet).toHaveBeenCalledWith(LOCAL_STORAGE_KEYS.persistentErrors)
  })

  it.each([
    { persistent_errors: [{ code: "missing-rest" }] },
    {
      persistent_errors: [
        {
          code: "unknown-field",
          message: "message",
          severity: "error",
          ts: 1,
          extra: true,
        },
      ],
    },
    { persistent_errors: "not-an-array" },
  ])("rejects malformed durable records %#", async (document) => {
    storageGet.mockResolvedValue(document)

    await expect(getPersistentErrors()).rejects.toBeInstanceOf(
      InvalidDurableStateError
    )
  })

  it("reads strict records through the exact Side Panel query handler", async () => {
    const errors = [
      {
        code: "QUEUE_RECOVERY_FAILED",
        message: "Queue recovery failed",
        severity: "error" as const,
        ts: 1,
      },
    ]
    storageGet.mockResolvedValue({ persistent_errors: errors })
    const handlers = createBackgroundSettingsUiMessageHandlers({} as never)

    await expect(
      handlers.GET_PERSISTENT_ERRORS({} as never, {} as never)
    ).resolves.toEqual({ success: true, data: errors })

    const request = {
      target: "background",
      type: "GET_PERSISTENT_ERRORS",
    } as const
    await expect(
      dispatchRuntimeMessage(
        request,
        {},
        {
          target: "background",
          handlers: handlers as never,
          classifySender: () => "options",
          waitForReadiness: vi.fn(async () => undefined),
        }
      )
    ).resolves.toEqual({
      success: false,
      error: "GET_PERSISTENT_ERRORS is not authorized for options",
    })
  })

  it("does not clear a durable error when its strict read fails", async () => {
    storageGet.mockResolvedValue({
      persistent_errors: [{ code: "invalid" }],
    })
    const storageSet = vi.fn()
    vi.stubGlobal("chrome", {
      storage: { local: { get: storageGet, set: storageSet } },
    })

    await expect(clearPersistentError("invalid")).rejects.toBeInstanceOf(
      InvalidDurableStateError
    )

    expect(storageSet).not.toHaveBeenCalled()
  })

  it("propagates a durable read failure without attempting a write", async () => {
    const storageError = new Error("read failed")
    storageGet.mockRejectedValue(storageError)
    const storageSet = vi.fn()
    vi.stubGlobal("chrome", {
      storage: { local: { get: storageGet, set: storageSet } },
    })

    await expect(clearPersistentError("failed-read")).rejects.toThrow(
      "read failed"
    )
    expect(storageSet).not.toHaveBeenCalled()
  })

  it("propagates a failed durable write through the acknowledgement handler", async () => {
    storageGet.mockResolvedValue({
      persistent_errors: [
        { code: "failed", message: "failure", severity: "error", ts: 1 },
      ],
    })
    const storageSet = vi.fn().mockRejectedValue(new Error("write failed"))
    vi.stubGlobal("chrome", {
      storage: { local: { get: storageGet, set: storageSet } },
    })
    const handlers = createBackgroundSettingsUiMessageHandlers({} as never)

    await expect(
      handlers.ACKNOWLEDGE_ERROR(
        { payload: { code: "failed" } } as never,
        {} as never
      )
    ).rejects.toThrow("write failed")
    expect(storageSet).toHaveBeenCalledTimes(1)
  })

  it("serializes concurrent clears so a later acknowledgement cannot resurrect an error", async () => {
    const first = {
      code: "first",
      message: "first",
      severity: "error" as const,
      ts: 1,
    }
    const second = {
      code: "second",
      message: "second",
      severity: "error" as const,
      ts: 2,
    }
    let stored = [first, second]
    let releaseFirstWrite!: () => void
    let writeCount = 0
    storageGet.mockImplementation(async () => ({
      persistent_errors: structuredClone(stored),
    }))
    const storageSet = vi.fn(
      async (items: { persistent_errors: typeof stored }) => {
        writeCount += 1
        if (writeCount === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstWrite = resolve
          })
        }
        stored = structuredClone(items.persistent_errors)
      }
    )
    vi.stubGlobal("chrome", {
      storage: { local: { get: storageGet, set: storageSet } },
    })

    const firstClear = clearPersistentError("first")
    await vi.waitFor(() => expect(storageSet).toHaveBeenCalledTimes(1))
    const secondClear = clearPersistentError("second")
    await Promise.resolve()
    expect(storageGet).toHaveBeenCalledTimes(1)

    releaseFirstWrite()
    await Promise.all([firstClear, secondClear])

    expect(stored).toEqual([])
    expect(storageSet).toHaveBeenCalledTimes(2)
  })
})
