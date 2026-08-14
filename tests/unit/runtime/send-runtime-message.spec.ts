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

  beforeEach(() => {
    sendMessage = vi.fn(async () => ({ success: true }))
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
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

  it("retries once by default", async () => {
    sendMessage
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ success: true })

    await expect(sendRuntimeMessage(message)).rejects.toThrow("transient")
    await expect(sendRuntimeMessageWithRetry(message)).resolves.toEqual({
      success: true,
    })
  })
})
