import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  sendRuntimeMessage: vi.fn(),
  createCommandEnvelope: vi.fn(() => ({
    commandId: "00000000-0000-4000-8000-000000000001",
    issuedAt: 123,
  })),
}))

vi.mock("@/src/runtime/send-runtime-message", () => ({
  sendRuntimeMessage: mocks.sendRuntimeMessage,
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
  })

  it("maps queued and active cancellation responses to semantic results", async () => {
    mocks.sendRuntimeMessage
      .mockResolvedValueOnce({ success: true, data: { undo } })
      .mockResolvedValueOnce({ success: true })

    await expect(queueCommandClient.cancelTask("task-1")).resolves.toEqual({
      kind: "queued",
      undo,
    })
    await expect(queueCommandClient.cancelTask("task-2")).resolves.toEqual({
      kind: "active",
    })
    expect(mocks.sendRuntimeMessage).toHaveBeenNthCalledWith(1, {
      target: "background",
      type: "CANCEL_TASK",
      commandId: "00000000-0000-4000-8000-000000000001",
      issuedAt: 123,
      payload: { taskId: "task-1" },
    })
  })

  it("returns the required Undo receipt from terminal removal", async () => {
    mocks.sendRuntimeMessage.mockResolvedValue({
      success: true,
      data: { undo },
    })

    await expect(queueCommandClient.removeTask("task-1")).resolves.toBe(undo)
  })

  it("rejects failed command responses without retry or fallback", async () => {
    mocks.sendRuntimeMessage.mockResolvedValue({
      success: false,
      error: "rejected",
    })

    await expect(
      queueCommandClient.retryFailedChapters("task-1")
    ).rejects.toThrow("rejected")
    expect(mocks.sendRuntimeMessage).toHaveBeenCalledOnce()
  })

  it("owns the fixed destination, Undo, reorder, restart, and clear messages", async () => {
    mocks.sendRuntimeMessage.mockResolvedValue({ success: true })

    await queueCommandClient.retryDestination("task-1")
    await queueCommandClient.continueDownload("task-1")
    await queueCommandClient.undoQueueAction("undo-1")
    await queueCommandClient.moveTaskToTop("task-1")
    await queueCommandClient.restartTask("task-1")
    await queueCommandClient.clearTerminalHistory()

    expect(
      mocks.sendRuntimeMessage.mock.calls.map(([message]) => message.type)
    ).toEqual([
      "RETRY_DESTINATION",
      "CONTINUE_DOWNLOAD",
      "UNDO_QUEUE_ACTION",
      "MOVE_TASK_TO_TOP",
      "RESTART_TASK",
      "CLEAR_ALL_HISTORY",
    ])
  })
})
