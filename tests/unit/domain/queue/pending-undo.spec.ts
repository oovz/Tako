import { describe, expect, it } from "vitest"

import {
  applyExpiredPendingUndoAction,
  createPendingUndoAction,
  isPendingUndoReceipt,
  materializeExpiredCancellationTask,
  partitionPendingUndoActions,
  PENDING_UNDO_WINDOW_MS,
  reinsertPendingUndoTask,
  toPendingUndoReceipt,
} from "@/src/domain/queue/pending-undo"
import type {
  DownloadTaskState,
  PendingUndoAction,
} from "@/src/domain/queue/state"

function createTask(
  id: string,
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  return {
    id,
    siteIntegrationId: "mangadex",
    mangaId: id,
    seriesTitle: id,
    chapters: [
      {
        id: `${id}-queued`,
        url: `https://example.com/${id}/queued`,
        title: "Queued",
        index: 1,
        status: "queued",
        lastUpdated: 10,
      },
    ],
    status: "queued",
    created: 1,
    settingsSnapshot: {} as DownloadTaskState["settingsSnapshot"],
    ...overrides,
  }
}

function createAction(
  overrides: Partial<PendingUndoAction> = {}
): PendingUndoAction {
  return {
    token: "undo-1",
    type: "cancel_queued",
    taskSnapshot: createTask("restored"),
    previousQueuePosition: 1,
    createdAt: 1_000,
    expiresAt: 6_000,
    ...overrides,
  }
}

describe("pending Undo domain formulas", () => {
  it("creates a detached action from explicit identity and time inputs", () => {
    const task = createTask("task-1")
    const action = createPendingUndoAction({
      token: "token-1",
      type: "cancel_queued",
      taskSnapshot: task,
      previousQueuePosition: 3,
      now: 2_000,
    })

    expect(action).toEqual({
      token: "token-1",
      type: "cancel_queued",
      taskSnapshot: task,
      previousQueuePosition: 3,
      createdAt: 2_000,
      expiresAt: 2_000 + PENDING_UNDO_WINDOW_MS,
    })
    expect(action.taskSnapshot).not.toBe(task)
    task.chapters[0]!.title = "mutated after materialization"
    expect(action.taskSnapshot.chapters[0]?.title).toBe("Queued")
  })

  it("creates the public receipt without leaking the task snapshot", () => {
    expect(toPendingUndoReceipt(createAction())).toEqual({
      token: "undo-1",
      type: "cancel_queued",
      expiresAt: 6_000,
    })
  })

  it.each([
    [{ token: "x", type: "cancel_queued", expiresAt: 1 }, true],
    [{ token: "x", type: "remove_history", expiresAt: 1 }, true],
    [{ token: 1, type: "cancel_queued", expiresAt: 1 }, false],
    [{ token: "x", type: "unknown", expiresAt: 1 }, false],
    [{ token: "x", type: "cancel_queued", expiresAt: "1" }, false],
    [
      {
        token: "x",
        type: "cancel_queued",
        expiresAt: Number.POSITIVE_INFINITY,
      },
      false,
    ],
    [null, false],
  ] as const)("validates receipt %j as %s", (value, expected) => {
    expect(isPendingUndoReceipt(value)).toBe(expected)
  })

  it.each([
    [0, ["restored", "a", "b"]],
    [1, ["a", "restored", "b"]],
    [99, ["a", "b", "restored"]],
  ] as const)(
    "reinserts at prior position %s without mutating the source",
    (position, expectedIds) => {
      const queue = [createTask("a"), createTask("b")]
      const action = createAction({ previousQueuePosition: position })
      const before = structuredClone(queue)

      const next = reinsertPendingUndoTask(queue, action, action.taskSnapshot)

      expect(next.map((task) => task.id)).toEqual(expectedIds)
      expect(next.find((task) => task.id === "restored")).not.toBe(
        action.taskSnapshot
      )
      expect(queue).toEqual(before)
    }
  )

  it("does not insert a duplicate task identity", () => {
    const queue = [createTask("restored")]
    const next = reinsertPendingUndoTask(
      queue,
      createAction(),
      createTask("restored", { seriesTitle: "duplicate" })
    )

    expect(next).toEqual(queue)
    expect(next).not.toBe(queue)
    expect(next[0]).not.toBe(queue[0])
  })

  it("materializes an expired queued cancellation across every chapter status", () => {
    const task = createTask("restored", {
      status: "queued",
      activeBlock: "destination_action_required",
      errorMessage: "stale task error",
      errorCategory: "unknown",
      completed: 99,
      chapters: (
        [
          "queued",
          "downloading",
          "completed",
          "partial_success",
          "failed",
          "canceled",
          "skipped",
        ] as const
      ).map((status, index) => ({
        id: `chapter-${status}`,
        url: `https://example.com/${status}`,
        title: status,
        index,
        status,
        lastUpdated: 10,
      })),
    })
    const action = createAction({ taskSnapshot: task, createdAt: 1_000 })
    const before = structuredClone(action)

    const canceled = materializeExpiredCancellationTask(action)

    expect(canceled).toMatchObject({
      status: "canceled",
      activeBlock: undefined,
      errorMessage: undefined,
      errorCategory: undefined,
      completed: 1_000,
    })
    expect(canceled.chapters.map((chapter) => chapter.status)).toEqual([
      "skipped",
      "canceled",
      "completed",
      "partial_success",
      "failed",
      "canceled",
      "skipped",
    ])
    expect(canceled.chapters[0]).toMatchObject({
      errorMessage: "Skipped after task cancellation",
      lastUpdated: 1_000,
    })
    expect(canceled.chapters[1]).toMatchObject({
      errorMessage: "Canceled by user",
      lastUpdated: 1_000,
    })
    expect(action).toEqual(before)
  })

  it("applies only expired queued cancellation materialization", () => {
    const queue = [createTask("a"), createTask("b")]
    const canceled = applyExpiredPendingUndoAction(queue, createAction())
    const historyOnly = applyExpiredPendingUndoAction(
      queue,
      createAction({ type: "remove_history" })
    )

    expect(canceled.map((task) => [task.id, task.status])).toEqual([
      ["a", "queued"],
      ["restored", "canceled"],
      ["b", "queued"],
    ])
    expect(historyOnly).toEqual(queue)
    expect(historyOnly).not.toBe(queue)
  })

  it("partitions expiry at the exact deadline without mutating actions", () => {
    const expiredBefore = createAction({ token: "before", expiresAt: 5_999 })
    const expiredAt = createAction({ token: "at", expiresAt: 6_000 })
    const pending = createAction({ token: "after", expiresAt: 6_001 })
    const actions = [expiredBefore, expiredAt, pending]

    expect(partitionPendingUndoActions(actions, 6_000)).toEqual({
      finalized: [expiredBefore, expiredAt],
      pending: [pending],
    })
    expect(actions).toEqual([expiredBefore, expiredAt, pending])
  })
})
