import { beforeEach, describe, expect, it, vi } from "vitest"

import { handleCancelDownloadTask } from "@/entrypoints/background/action-handlers/download-task-handlers"
import type {
  CancelDownloadTaskTransitionResult,
  CentralizedStateManager,
} from "@/src/runtime/centralized-state"
import type { DownloadTaskState } from "@/src/types/queue-state"

const destinationMocks = vi.hoisted(() => ({
  clearDestinationIssuesForTask: vi.fn(async () => undefined),
}))
const pendingUndoMocks = vi.hoisted(() => ({
  schedulePendingUndoAction: vi.fn(async () => undefined),
  restorePendingUndoAndCleanup: vi.fn(),
}))

vi.mock("@/entrypoints/background/destination", () => ({
  clearDestinationIssuesForTask: destinationMocks.clearDestinationIssuesForTask,
}))

vi.mock(
  "@/entrypoints/background/pending-undo-coordinator",
  () => pendingUndoMocks
)

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe("handleCancelDownloadTask", () => {
  const cancelDownloadTaskAtomically = vi.fn(
    async (): Promise<CancelDownloadTaskTransitionResult> => ({
      success: true,
      task: {
        id: "task-123",
        status: "canceled",
        chapters: [
          {
            id: "chapter-active",
            status: "canceled",
          },
          {
            id: "chapter-queued",
            status: "skipped",
          },
          {
            id: "chapter-complete",
            status: "completed",
          },
        ],
      } as unknown as DownloadTaskState,
      canceledLease: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-123",
        chapterId: "chapter-active",
        stage: "downloading",
        startedAt: 1,
        lastActivityAt: 1,
        leaseExpiresAt: 2,
        sequence: 1,
      },
    })
  )
  const getGlobalState = vi.fn(async () => ({
    settings: {
      advanced: {
        logLevel: "debug",
      },
    },
  }))
  const sendMessage = vi.fn(async () => undefined)

  const stateManager = {
    cancelDownloadTaskAtomically,
    getGlobalState,
  } as unknown as CentralizedStateManager

  beforeEach(() => {
    vi.clearAllMocks()
    cancelDownloadTaskAtomically.mockResolvedValue({
      success: true,
      task: {
        id: "task-123",
        status: "canceled",
        chapters: [],
      } as unknown as DownloadTaskState,
      canceledLease: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-123",
        chapterId: "chapter-active",
        stage: "downloading",
        startedAt: 1,
        lastActivityAt: 1,
        leaseExpiresAt: 2,
        sequence: 1,
      },
    })

    ;(globalThis as unknown as { chrome: typeof chrome }).chrome = {
      runtime: {
        sendMessage,
      },
    } as unknown as typeof chrome
  })

  it("marks task canceled and sends offscreen cancellation signals", async () => {
    const result = await handleCancelDownloadTask(stateManager, {
      taskId: "task-123",
    })

    expect(result).toEqual({ success: true })
    expect(cancelDownloadTaskAtomically).toHaveBeenCalledWith("task-123")
    expect(destinationMocks.clearDestinationIssuesForTask).toHaveBeenCalledWith(
      "task-123"
    )
    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: "OFFSCREEN_CANCEL_JOB",
      payload: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-123",
        chapterId: "chapter-active",
      },
    })
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("returns success even if offscreen messaging fails", async () => {
    sendMessage.mockRejectedValueOnce(new Error("offscreen unavailable"))

    const result = await handleCancelDownloadTask(stateManager, {
      taskId: "task-123",
    })

    expect(result).toEqual({ success: true })
    expect(cancelDownloadTaskAtomically).toHaveBeenCalledWith("task-123")
    expect(destinationMocks.clearDestinationIssuesForTask).toHaveBeenCalledWith(
      "task-123"
    )
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("stages queued cancellation for Undo without clearing issues or signaling offscreen", async () => {
    const undo = {
      token: "undo-queued-task",
      type: "cancel_queued" as const,
      expiresAt: 6_000,
    }
    cancelDownloadTaskAtomically.mockResolvedValueOnce({
      success: true,
      task: {
        id: "task-123",
        status: "queued",
        chapters: [],
      } as unknown as DownloadTaskState,
      canceledLease: null,
      undo,
    })

    const result = await handleCancelDownloadTask(stateManager, {
      taskId: "task-123",
    })

    expect(result).toEqual({ success: true, data: { undo } })
    expect(pendingUndoMocks.schedulePendingUndoAction).toHaveBeenCalledWith(
      stateManager,
      undo
    )
    expect(
      destinationMocks.clearDestinationIssuesForTask
    ).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("returns a typed failure and does not signal offscreen when the task is missing", async () => {
    cancelDownloadTaskAtomically.mockResolvedValueOnce({
      success: false,
      reason: "not-found",
    })

    const result = await handleCancelDownloadTask(stateManager, {
      taskId: "missing-task",
    })

    expect(result).toEqual({
      success: false,
      error: "Download task not found.",
    })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(
      destinationMocks.clearDestinationIssuesForTask
    ).not.toHaveBeenCalled()
  })

  it("rejects cancellation after a task reaches a terminal status", async () => {
    cancelDownloadTaskAtomically.mockResolvedValueOnce({
      success: false,
      reason: "invalid-status",
      currentStatus: "completed",
    })

    const result = await handleCancelDownloadTask(stateManager, {
      taskId: "completed-task",
    })

    expect(result).toEqual({
      success: false,
      error: "Only queued or downloading tasks can be canceled.",
    })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(
      destinationMocks.clearDestinationIssuesForTask
    ).not.toHaveBeenCalled()
  })
})
