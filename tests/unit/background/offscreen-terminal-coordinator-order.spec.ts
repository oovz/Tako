import { describe, expect, it, vi } from "vitest"

import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import type { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"

const gate = vi.hoisted(() => ({ active: false }))

vi.mock("@/entrypoints/background/download-task-side-effect-gate", () => ({
  runTaskSideEffectExclusive: async <T>(
    _taskId: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    gate.active = true
    try {
      return await operation()
    } finally {
      gate.active = false
    }
  },
}))

describe("offscreen terminal coordinator ordering", () => {
  it("runs native reconciliation only after releasing the task gate", async () => {
    const payload = {
      jobId: "job-1",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
      fingerprint: "a".repeat(64),
      documentInstanceId: "document-1",
      sequence: 2,
      stage: "saving",
      terminalAt: 100,
      outcome: {
        status: "completed",
        outputsRequested: 1,
        outputsCommitted: 1,
        outputsFailedBeforeHandoff: 0,
      },
    } satisfies RuntimeMessageRequest<"OFFSCREEN_JOB_TERMINAL">["payload"]
    const afterSettlement = vi.fn(async () => {
      expect(gate.active).toBe(false)
    })
    const deps = {
      queueRepository: {
        getTask: vi.fn(async () => ({
          status: "downloading",
          chapters: [{ id: payload.chapterId, status: "downloading" }],
        })),
        renewDispatchLease: vi.fn(async () => ({
          outcome: "applied" as const,
          lease: {},
        })),
      } as unknown as QueueRepository,
      terminalCoordinator: {
        settle: vi.fn(async () => "native-output-pending" as const),
        afterSettlement,
      } as unknown as OffscreenJobTerminalCoordinator,
    } as BackgroundRuntimeHandlerDependencies
    const handler = createBackgroundOffscreenEventMessageHandlers(deps)

    await handler.OFFSCREEN_JOB_TERMINAL(
      { target: "background", type: "OFFSCREEN_JOB_TERMINAL", payload },
      { documentId: undefined }
    )

    expect(afterSettlement).toHaveBeenCalledWith(
      payload.taskId,
      "native-output-pending"
    )
  })

  it("routes an exact terminal event after durable task cancellation", async () => {
    const payload = {
      jobId: "job-1",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
      fingerprint: "a".repeat(64),
      documentInstanceId: "document-1",
      sequence: 3,
      stage: "saving",
      terminalAt: 101,
      outcome: {
        status: "completed",
        outputsRequested: 1,
        outputsCommitted: 1,
        outputsFailedBeforeHandoff: 0,
      },
    } satisfies RuntimeMessageRequest<"OFFSCREEN_JOB_TERMINAL">["payload"]
    const settle = vi.fn(async () => "terminal-owner-released" as const)
    const afterSettlement = vi.fn(async () => undefined)
    const deps = {
      queueRepository: {
        getTask: vi.fn(async () => ({
          status: "canceled",
          chapters: [{ id: payload.chapterId, status: "failed" }],
        })),
        renewDispatchLease: vi.fn(async () => ({
          outcome: "applied" as const,
          lease: {},
        })),
      } as unknown as QueueRepository,
      terminalCoordinator: {
        settle,
        afterSettlement,
      } as unknown as OffscreenJobTerminalCoordinator,
    } as BackgroundRuntimeHandlerDependencies
    const handler = createBackgroundOffscreenEventMessageHandlers(deps)

    await expect(
      handler.OFFSCREEN_JOB_TERMINAL(
        { target: "background", type: "OFFSCREEN_JOB_TERMINAL", payload },
        { documentId: undefined }
      )
    ).resolves.toEqual({ success: true, disposition: "renewed" })

    expect(settle).toHaveBeenCalledWith(payload)
    expect(afterSettlement).toHaveBeenCalledWith(
      payload.taskId,
      "terminal-owner-released"
    )
  })
})
