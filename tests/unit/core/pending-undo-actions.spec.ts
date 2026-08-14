import { beforeEach, describe, expect, it, vi } from "vitest"

import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { QueueRepository as BaseQueueRepository } from "@/src/storage/queue-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import {
  makeDownloadTask,
  mockLocalStorage,
  resetQueueRepositoryTestEnvironment,
} from "./queue-repository-test-setup"

class QueueRepository extends BaseQueueRepository {
  constructor() {
    super(new QueueProjectionService())
  }
}

describe("pending Undo task persistence", () => {
  beforeEach(() => {
    resetQueueRepositoryTestEnvironment()
  })

  it("restores a queued cancellation at its exact queue position", async () => {
    const repository = new QueueRepository()
    const tasks = ["task-a", "task-b", "task-c"].map((id) =>
      makeDownloadTask({ id, mangaId: id, seriesTitle: id })
    )
    for (const task of tasks) {
      await repository.enqueueDownloadTask(task)
    }
    const cancellation = await repository.cancelDownloadTask({
      taskId: "task-b",
      undoToken: "undo-task-b",
      now: 1_000,
    })

    expect(cancellation.outcome).toBe("applied")
    if (cancellation.outcome !== "applied" || !cancellation.undo) {
      throw new Error("Expected queued cancellation Undo receipt")
    }
    expect(cancellation.undo).toMatchObject({
      type: "cancel_queued",
      expiresAt: 6_000,
    })
    expect((await repository.getQueue()).map((task) => task.id)).toEqual([
      "task-a",
      "task-c",
    ])
    const token = cancellation.undo.token
    expect(token).toBeTypeOf("string")
    const restored = await repository.restorePendingUndoAction({
      token,
      now: 5_999,
    })

    expect(restored).toMatchObject({ outcome: "applied", restored: true })
    const restoredQueue = await repository.getQueue()
    expect(restoredQueue.map((task) => task.id)).toEqual([
      "task-a",
      "task-b",
      "task-c",
    ])
    expect(restoredQueue[1]).toEqual(tasks[1])
    await expect(
      repository.restorePendingUndoAction({ token, now: 5_999 })
    ).resolves.toMatchObject({ outcome: "rejected", reason: "undo-not-found" })
  })

  it("restores an immediately hidden terminal history record", async () => {
    const repository = new QueueRepository()
    const completedTask = makeDownloadTask({
      id: "completed-task",
      mangaId: "completed-task",
      status: "completed",
      completed: 500,
    })
    await repository.enqueueDownloadTask(completedTask)

    const removal = await repository.removeTerminalDownloadTask({
      taskId: completedTask.id,
      undoToken: "undo-completed-task",
      now: 1_000,
    })

    expect(removal).toMatchObject({
      outcome: "applied",
      undo: { type: "remove_history" },
    })
    expect(await repository.getQueue()).toEqual([])
    if (removal.outcome !== "applied") {
      throw new Error("Expected removal to succeed")
    }

    await expect(
      repository.restorePendingUndoAction({
        token: removal.undo.token,
        now: removal.undo.expiresAt - 1,
      })
    ).resolves.toMatchObject({ outcome: "applied", restored: true })
    expect(await repository.getQueue()).toEqual([completedTask])
  })

  it("rejects late Undo and normalizes a queued cancellation into history", async () => {
    const repository = new QueueRepository()
    await repository.enqueueDownloadTask(
      makeDownloadTask({
        id: "expiring-task",
        mangaId: "expiring-task",
        chapters: [
          {
            id: "chapter-1",
            url: "chapter-1",
            title: "Chapter 1",
            index: 1,
            status: "queued",
            lastUpdated: 1,
          },
        ],
      })
    )
    const cancellation = await repository.cancelDownloadTask({
      taskId: "expiring-task",
      undoToken: "undo-expiring-task",
      now: 2_000,
    })
    if (cancellation.outcome !== "applied" || !cancellation.undo) {
      throw new Error("Expected queued cancellation Undo receipt")
    }

    const lateUndo = await repository.restorePendingUndoAction({
      token: cancellation.undo.token,
      now: cancellation.undo.expiresAt,
    })

    expect(lateUndo).toMatchObject({
      outcome: "applied",
      restored: false,
      reason: "expired",
    })
    expect((await repository.getQueue())[0]).toMatchObject({
      id: "expiring-task",
      status: "canceled",
      completed: 2_000,
      chapters: [
        expect.objectContaining({
          status: "skipped",
          errorMessage: "Skipped after task cancellation",
        }),
      ],
    })
    await expect(
      repository.restorePendingUndoAction({
        token: cancellation.undo.token,
        now: cancellation.undo.expiresAt,
      })
    ).resolves.toMatchObject({ outcome: "rejected", reason: "undo-not-found" })
  })

  it("reconciles expired actions while retaining unexpired restart state", async () => {
    const repository = new QueueRepository()
    await repository.enqueueDownloadTask(
      makeDownloadTask({ id: "old-task", mangaId: "old-task" })
    )
    await repository.enqueueDownloadTask(
      makeDownloadTask({ id: "new-task", mangaId: "new-task" })
    )
    await repository.cancelDownloadTask({
      taskId: "old-task",
      undoToken: "undo-old-task",
      now: 1_000,
    })
    await repository.cancelDownloadTask({
      taskId: "new-task",
      undoToken: "undo-new-task",
      now: 5_000,
    })

    const recovery = await repository.reconcileExpiredPendingUndoActions(7_000)

    expect(recovery.outcome).toBe("applied")
    expect(recovery.finalized).toHaveLength(1)
    expect(recovery.finalized[0]).toMatchObject({
      taskSnapshot: { id: "old-task" },
    })
    expect(recovery.pending).toHaveLength(1)
    expect(recovery.pending[0]).toMatchObject({
      taskSnapshot: { id: "new-task" },
    })
    expect(await repository.getQueue()).toEqual([
      expect.objectContaining({ id: "old-task", status: "canceled" }),
    ])
  })

  it("does not expose either half when the serialized Undo staging write fails", async () => {
    const repository = new QueueRepository()
    await repository.enqueueDownloadTask(
      makeDownloadTask({ id: "atomic-task", mangaId: "atomic-task" })
    )
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
      new Error("Undo staging write failed")
    )

    await expect(
      repository.cancelDownloadTask({
        taskId: "atomic-task",
        undoToken: "undo-atomic-task",
        now: 1_000,
      })
    ).rejects.toThrow("Undo staging write failed")

    expect(await repository.getQueue()).toEqual([
      expect.objectContaining({ id: "atomic-task", status: "queued" }),
    ])
    expect(
      mockLocalStorage[LOCAL_STORAGE_KEYS.pendingUndoActions]
    ).toBeUndefined()
  })
})
