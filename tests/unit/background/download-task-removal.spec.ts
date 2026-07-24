import { describe, expect, it, vi } from "vitest"

import { handleRemoveDownloadTask } from "@/entrypoints/background/action-handlers/download-task-handlers"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"

const pendingUndoMocks = vi.hoisted(() => ({
  schedulePendingUndoAction: vi.fn(async () => undefined),
  restorePendingUndoAndCleanup: vi.fn(),
}))

vi.mock(
  "@/entrypoints/background/pending-undo-coordinator",
  () => pendingUndoMocks
)

describe("handleRemoveDownloadTask", () => {
  it("hides terminal history and returns a durable Undo receipt", async () => {
    const undo = {
      token: "undo-history-task",
      type: "remove_history" as const,
      expiresAt: 6_000,
    }
    const removeTerminalDownloadTask = vi.fn(async () => ({
      success: true as const,
      undo,
    }))
    const getGlobalState = vi.fn(async () => ({
      settings: { advanced: { logLevel: "info" } },
    }))
    const stateManager = {
      removeTerminalDownloadTask,
      getGlobalState,
    } as unknown as CentralizedStateManager

    await expect(
      handleRemoveDownloadTask(stateManager, { taskId: "history-task" })
    ).resolves.toEqual({ success: true, data: { undo } })
    expect(pendingUndoMocks.schedulePendingUndoAction).toHaveBeenCalledWith(
      stateManager,
      undo
    )
  })

  it("rejects removal of a non-terminal task without changing the queue", async () => {
    const removeTerminalDownloadTask = vi.fn(async () => ({
      success: false as const,
      reason: "invalid-status" as const,
      currentStatus: "downloading" as const,
    }))
    const stateManager = {
      removeTerminalDownloadTask,
    } as unknown as CentralizedStateManager

    await expect(
      handleRemoveDownloadTask(stateManager, { taskId: "active-task" })
    ).resolves.toEqual({
      success: false,
      error:
        "Only completed, failed, partial-success, or canceled tasks can be removed.",
    })
    expect(removeTerminalDownloadTask).toHaveBeenCalledWith("active-task")
  })
})
