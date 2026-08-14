import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  sendRuntimeMessage: vi.fn(),
  sendRuntimeMessageWithRetry: vi.fn(),
  createCommandEnvelope: vi.fn(() => ({
    commandId: "00000000-0000-4000-8000-000000000001",
    issuedAt: 123,
  })),
}))

vi.mock("@/src/runtime/send-runtime-message", () => ({
  sendRuntimeMessage: mocks.sendRuntimeMessage,
  sendRuntimeMessageWithRetry: mocks.sendRuntimeMessageWithRetry,
}))

vi.mock("@/src/runtime/command-envelope", () => ({
  createCommandEnvelope: mocks.createCommandEnvelope,
}))

import { queueCommandClient } from "@/src/ui/shared/queue-command-client"

const undo = {
  token: "undo-1",
  type: "cancel_queued" as const,
  expiresAt: 456,
}

describe("queueCommandClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendRuntimeMessage.mockResolvedValue({ success: true })
    mocks.sendRuntimeMessageWithRetry.mockResolvedValue({ success: true })
  })

  it("maps queued and active cancellation responses to semantic results", async () => {
    mocks.sendRuntimeMessageWithRetry
      .mockResolvedValueOnce({ success: true, data: { undo } })
      .mockResolvedValueOnce({ success: true })

    await expect(queueCommandClient.cancelTask("task-1")).resolves.toEqual({
      kind: "queued",
      undo,
    })
    await expect(queueCommandClient.cancelTask("task-2")).resolves.toEqual({
      kind: "active",
    })
    expect(mocks.sendRuntimeMessageWithRetry).toHaveBeenNthCalledWith(
      1,
      {
        target: "background",
        type: "CANCEL_TASK",
        commandId: "00000000-0000-4000-8000-000000000001",
        issuedAt: 123,
        payload: { taskId: "task-1" },
      },
      { retentionKey: "CANCEL_TASK:task-1" }
    )
  })

  it("returns the required Undo receipt from terminal removal", async () => {
    mocks.sendRuntimeMessageWithRetry.mockResolvedValue({
      success: true,
      data: { undo },
    })

    await expect(queueCommandClient.removeTask("task-1")).resolves.toBe(undo)
  })

  it("rejects failed command responses without retry or fallback", async () => {
    mocks.sendRuntimeMessageWithRetry.mockResolvedValue({
      success: false,
      error: "rejected",
    })

    await expect(
      queueCommandClient.retryFailedChapters("task-1")
    ).rejects.toThrow("rejected")
    expect(mocks.sendRuntimeMessageWithRetry).toHaveBeenCalledOnce()
  })

  it("owns the fixed destination, Undo, reorder, restart, and clear messages", async () => {
    await queueCommandClient.retryDestination("task-1")
    await queueCommandClient.continueDownload("task-1")
    await queueCommandClient.undoQueueAction("undo-1")
    await queueCommandClient.moveTaskToTop("task-1")
    await queueCommandClient.restartTask("task-1")
    await queueCommandClient.clearTerminalHistory()

    expect(
      mocks.sendRuntimeMessageWithRetry.mock.calls.map(
        ([message]) => message.type
      )
    ).toEqual([
      "RETRY_DESTINATION",
      "CONTINUE_DOWNLOAD",
      "UNDO_QUEUE_ACTION",
      "RESTART_TASK",
    ])
    expect(
      mocks.sendRuntimeMessage.mock.calls.map(([message]) => message.type)
    ).toEqual(["MOVE_TASK_TO_TOP", "CLEAR_ALL_HISTORY"])
  })

  it("sends reorder, clear, and forget once because they can broaden on replay", async () => {
    mocks.sendRuntimeMessage
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, surrendered: 1 })

    await queueCommandClient.moveTaskToTop("task-1")
    await queueCommandClient.clearTerminalHistory()
    await expect(
      queueCommandClient.forgetUnobservableOutputs("task-1")
    ).resolves.toEqual({ surrendered: 1 })

    expect(mocks.sendRuntimeMessage).toHaveBeenCalledTimes(3)
    expect(mocks.sendRuntimeMessageWithRetry).not.toHaveBeenCalled()
  })
})
