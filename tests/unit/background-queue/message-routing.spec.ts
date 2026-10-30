import { describe, expect, it, vi } from "vitest"

import { createBackgroundQueueMessageHandlers } from "@/entrypoints/background/background-queue-message-handlers"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import type { PendingUndoReceipt } from "@/src/domain/queue/state"
import type { CancelTaskResult } from "@/entrypoints/background/download-task-cancellation-coordinator"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"

function setup() {
  const undo: PendingUndoReceipt = {
    token: "receipt",
    type: "remove_history",
    expiresAt: 10_000,
  }
  const commands = {
    startDownload: vi.fn(async () => ({ taskId: "new-task" })),
    retryFailedChapters: vi.fn(async () => ({ newTaskId: "retry" })),
    restartTask: vi.fn(async () => ({ newTaskId: "restart" })),
    moveTaskToTop: vi.fn(async () => undefined),
    clearTerminalHistory: vi.fn(async () => ({ removedCount: 1 })),
    removeTask: vi.fn(
      async (): Promise<PendingUndoReceipt | undefined> => undo
    ),
    cancelTask: vi.fn(async (): Promise<CancelTaskResult> => ({
      kind: "queued",
      undo,
    })),
    undoQueueAction: vi.fn(async () => ({ restoredQueuedTask: true })),
  }
  const handlers = createBackgroundQueueMessageHandlers({
    queueApplicationCommands: commands,
  } as unknown as BackgroundRuntimeHandlerDependencies)
  return { handlers, commands, undo }
}

const sender: chrome.runtime.MessageSender = {}

describe("queue runtime command routing", () => {
  it("forwards command identity, task identity and Undo tokens to their application operations", async () => {
    const { handlers, commands } = setup()
    const envelope = {
      target: "background",
      commandId: "command-1",
      issuedAt: 1,
      payload: { taskId: "task-1" },
    } satisfies Omit<RuntimeMessageRequest<"RETRY_FAILED_CHAPTERS">, "type">
    await expect(
      handlers.RETRY_FAILED_CHAPTERS(
        { ...envelope, type: "RETRY_FAILED_CHAPTERS" },
        sender
      )
    ).resolves.toEqual({ success: true })
    await expect(
      handlers.RESTART_TASK({ ...envelope, type: "RESTART_TASK" }, sender)
    ).resolves.toEqual({ success: true })
    await expect(
      handlers.MOVE_TASK_TO_TOP(
        { ...envelope, type: "MOVE_TASK_TO_TOP" },
        sender
      )
    ).resolves.toEqual({ success: true })
    await expect(
      handlers.CLEAR_ALL_HISTORY(
        {
          target: "background",
          type: "CLEAR_ALL_HISTORY",
          commandId: "clear-1",
          issuedAt: 1,
          payload: {},
        },
        sender
      )
    ).resolves.toEqual({ success: true })
    await expect(
      handlers.UNDO_QUEUE_ACTION(
        {
          target: "background",
          type: "UNDO_QUEUE_ACTION",
          commandId: "undo-1",
          issuedAt: 1,
          payload: { token: "receipt" },
        },
        sender
      )
    ).resolves.toEqual({ success: true })
    expect(commands.retryFailedChapters).toHaveBeenCalledWith(
      "task-1",
      "command-1"
    )
    expect(commands.restartTask).toHaveBeenCalledWith("task-1", "command-1")
    expect(commands.moveTaskToTop).toHaveBeenCalledWith("task-1")
    expect(commands.clearTerminalHistory).toHaveBeenCalledOnce()
    expect(commands.undoQueueAction).toHaveBeenCalledWith("receipt")
  })

  it("returns a removal receipt once and accepts an already removed task", async () => {
    const { handlers, commands, undo } = setup()
    const message = {
      target: "background",
      type: "REMOVE_TASK",
      commandId: "remove-1",
      issuedAt: 1,
      payload: { taskId: "task-1" },
    } satisfies RuntimeMessageRequest<"REMOVE_TASK">
    await expect(handlers.REMOVE_TASK(message, sender)).resolves.toEqual({
      success: true,
      data: { undo },
    })
    commands.removeTask.mockResolvedValueOnce(undefined)
    await expect(handlers.REMOVE_TASK(message, sender)).resolves.toEqual({
      success: true,
    })
    expect(commands.removeTask).toHaveBeenCalledWith("task-1", "remove-1")
  })

  it("returns Undo only for a queued cancellation", async () => {
    const { handlers, commands, undo } = setup()
    const message = {
      target: "background",
      type: "CANCEL_TASK",
      commandId: "cancel-1",
      issuedAt: 1,
      payload: { taskId: "task-1" },
    } satisfies RuntimeMessageRequest<"CANCEL_TASK">
    await expect(handlers.CANCEL_TASK(message, sender)).resolves.toEqual({
      success: true,
      data: { undo },
    })
    commands.cancelTask.mockResolvedValueOnce({ kind: "active" })
    await expect(handlers.CANCEL_TASK(message, sender)).resolves.toEqual({
      success: true,
    })
    expect(commands.cancelTask).toHaveBeenCalledWith("task-1", "cancel-1")
  })

  it("maps an unexpected start failure to the durable-state failure response", async () => {
    const { handlers, commands } = setup()
    commands.startDownload.mockRejectedValueOnce("storage unavailable")
    const response = await handlers.START_DOWNLOAD(
      {
        target: "background",
        type: "START_DOWNLOAD",
        commandId: "start-1",
        issuedAt: 1,
        payload: {
          sourceWindowId: 1,
          sourceTabId: 2,
          sourceUrl: "https://mangadex.org/title/series",
          siteIntegrationId: "mangadex",
          seriesId: "series",
          seriesRevision: 1,
          selectedChapterIds: ["chapter-1"],
        },
      },
      sender
    )
    expect(response).toMatchObject({
      success: false,
      code: "durable_state_failure",
      error: expect.any(String),
    })
  })

  it("propagates application failure before returning a mutation success", async () => {
    const { handlers, commands } = setup()
    const failure = new Error("write failed")
    commands.restartTask.mockRejectedValueOnce(failure)
    await expect(
      handlers.RESTART_TASK(
        {
          target: "background",
          type: "RESTART_TASK",
          commandId: "restart-1",
          issuedAt: 1,
          payload: { taskId: "task-1" },
        },
        sender
      )
    ).rejects.toBe(failure)
  })
})
