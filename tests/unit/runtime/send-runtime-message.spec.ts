import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  sendRuntimeMessage,
  sendRuntimeMessageWithRetry,
} from "@/src/runtime/send-runtime-message"

const message = {
  target: "background",
  type: "MOVE_TASK_TO_TOP",
  commandId: "00000000-0000-4000-8000-000000000001",
  issuedAt: 1,
  payload: { taskId: "task-1" },
} as const

describe("sendRuntimeMessageWithRetry", () => {
  let sendMessage: ReturnType<typeof vi.fn>
  let sessionData: Record<string, unknown>
  let session: {
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    sendMessage = vi.fn(async () => ({ success: true }))
    sessionData = {}
    session = {
      get: vi.fn(async (key: string) =>
        Object.hasOwn(sessionData, key) ? { [key]: sessionData[key] } : {}
      ),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(sessionData, values)
      }),
      remove: vi.fn(async (key: string) => {
        delete sessionData[key]
      }),
    }
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
      storage: { session },
    } as unknown as typeof chrome)
  })

  it("retries a transport failure with the exact same envelope", async () => {
    sendMessage
      .mockRejectedValueOnce(new Error("Extension context invalidated"))
      .mockResolvedValueOnce({ success: true })

    await expect(sendRuntimeMessageWithRetry(message)).resolves.toEqual({
      success: true,
    })
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage.mock.calls[0]?.[0]).toEqual(
      sendMessage.mock.calls[1]?.[0]
    )
  })

  it("gives up after the configured attempt count", async () => {
    sendMessage.mockRejectedValue(new Error("context lost"))

    await expect(
      sendRuntimeMessageWithRetry(message, { attempts: 3 })
    ).rejects.toThrow("context lost")
    expect(sendMessage).toHaveBeenCalledTimes(3)
  })

  it("does not retry a validated logical failure response", async () => {
    sendMessage.mockResolvedValue({ success: false, error: "rejected" })

    await expect(sendRuntimeMessageWithRetry(message)).resolves.toEqual({
      success: false,
      error: "rejected",
    })
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("rejects a malformed request before making any Chrome call", async () => {
    const malformed = {
      ...message,
      payload: { taskId: "" },
    } as unknown as typeof message

    await expect(
      sendRuntimeMessageWithRetry(malformed, { attempts: 3 })
    ).rejects.toThrow(/Invalid MOVE_TASK_TO_TOP request/)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("rejects a malformed response after exactly one Chrome call", async () => {
    sendMessage.mockResolvedValue({ success: true, unexpected: true })

    await expect(
      sendRuntimeMessageWithRetry(message, { attempts: 3 })
    ).rejects.toThrow(/Invalid MOVE_TASK_TO_TOP response/)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("retries once by default", async () => {
    sendMessage
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ success: true })

    await expect(sendRuntimeMessage(message)).rejects.toThrow("transient")
    await expect(sendRuntimeMessageWithRetry(message)).resolves.toEqual({
      success: true,
    })
  })

  it("retains the validated envelope through transport exhaustion and reuses it", async () => {
    sendMessage.mockRejectedValue(new Error("context lost"))
    await expect(
      sendRuntimeMessageWithRetry(message, {
        attempts: 1,
        retentionKey: "MOVE_TASK_TO_TOP:task-1",
      })
    ).rejects.toThrow("context lost")
    expect(session.set).toHaveBeenCalledOnce()

    sendMessage.mockResolvedValue({ success: true })
    const newlyConstructed = {
      ...message,
      commandId: "00000000-0000-4000-8000-000000000002",
      issuedAt: 2,
    }
    await expect(
      sendRuntimeMessageWithRetry(newlyConstructed, {
        attempts: 1,
        retentionKey: "MOVE_TASK_TO_TOP:task-1",
      })
    ).resolves.toEqual({ success: true })
    expect(sendMessage).toHaveBeenLastCalledWith(message)
    expect(session.remove).toHaveBeenCalledWith(
      "runtime-command:MOVE_TASK_TO_TOP:task-1"
    )
  })

  it("clears retained requests for definitive logical failures", async () => {
    sendMessage.mockResolvedValue({ success: false, error: "rejected" })
    await expect(
      sendRuntimeMessageWithRetry(message, {
        attempts: 1,
        retentionKey: "MOVE_TASK_TO_TOP:task-1",
      })
    ).resolves.toEqual({ success: false, error: "rejected" })
    expect(session.remove).toHaveBeenCalledOnce()
    expect(sessionData).toEqual({})
  })

  it("retains the envelope when the response is invalid", async () => {
    sendMessage.mockResolvedValue({ success: true, unexpected: true })
    await expect(
      sendRuntimeMessageWithRetry(message, {
        attempts: 1,
        retentionKey: "MOVE_TASK_TO_TOP:task-1",
      })
    ).rejects.toThrow(/Invalid MOVE_TASK_TO_TOP response/)
    expect(session.remove).not.toHaveBeenCalled()
    expect(sessionData["runtime-command:MOVE_TASK_TO_TOP:task-1"]).toEqual(
      message
    )
  })

  it("fails closed on malformed retained session data", async () => {
    sessionData["runtime-command:MOVE_TASK_TO_TOP:task-1"] = {
      type: "MOVE_TASK_TO_TOP",
      payload: { taskId: "" },
    }
    await expect(
      sendRuntimeMessageWithRetry(message, {
        attempts: 1,
        retentionKey: "MOVE_TASK_TO_TOP:task-1",
      })
    ).rejects.toThrow(/Invalid MOVE_TASK_TO_TOP retained request/)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("propagates cleanup failure after a definitive response", async () => {
    sendMessage.mockResolvedValue({ success: true })
    session.remove.mockRejectedValueOnce(new Error("session cleanup failed"))
    await expect(
      sendRuntimeMessageWithRetry(message, {
        attempts: 1,
        retentionKey: "MOVE_TASK_TO_TOP:task-1",
      })
    ).rejects.toThrow("session cleanup failed")
  })
})
