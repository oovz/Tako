import { beforeEach, describe, expect, it, vi } from "vitest"

import { CentralizedStateManager } from "@/src/runtime/centralized-state"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import {
  makeDownloadTask,
  mockLocalStorage,
  resetCentralizedStateTestEnvironment,
} from "./centralized-state-test-setup"

describe("pending Undo task transactions", () => {
  beforeEach(() => {
    resetCentralizedStateTestEnvironment()
  })

  it("restores a queued cancellation at its exact queue position", async () => {
    const stateManager = new CentralizedStateManager()
    await stateManager.initialize()
    for (const id of ["task-a", "task-b", "task-c"]) {
      await stateManager.addDownloadTask(
        makeDownloadTask({ id, mangaId: id, seriesTitle: id })
      )
    }
    const cancellation = await stateManager.cancelDownloadTaskAtomically(
      "task-b",
      1_000
    )

    expect(cancellation.success && cancellation.undo).toMatchObject({
      type: "cancel_queued",
      expiresAt: 6_000,
    })
    expect(
      (await stateManager.getGlobalState()).downloadQueue.map((task) => task.id)
    ).toEqual(["task-a", "task-c"])
    const originalSnapshot = (await stateManager.getPendingUndoActions())[0]
      .taskSnapshot

    const token = cancellation.success ? cancellation.undo?.token : undefined
    expect(token).toBeTypeOf("string")
    const restored = await stateManager.restorePendingUndoAction(
      token as string,
      5_999
    )

    expect(restored).toMatchObject({ success: true })
    const restoredQueue = (await stateManager.getGlobalState()).downloadQueue
    expect(restoredQueue.map((task) => task.id)).toEqual([
      "task-a",
      "task-b",
      "task-c",
    ])
    expect(restoredQueue[1]).toEqual(originalSnapshot)
    expect(await stateManager.getPendingUndoActions()).toEqual([])
  })

  it("restores an immediately hidden terminal history record", async () => {
    const stateManager = new CentralizedStateManager()
    await stateManager.initialize()
    const completedTask = makeDownloadTask({
      id: "completed-task",
      mangaId: "completed-task",
      status: "completed",
      completed: 500,
    })
    await stateManager.addDownloadTask(completedTask)

    const removal = await stateManager.removeTerminalDownloadTask(
      completedTask.id
    )

    expect(removal).toMatchObject({
      success: true,
      undo: { type: "remove_history" },
    })
    expect((await stateManager.getGlobalState()).downloadQueue).toEqual([])
    const originalSnapshot = (await stateManager.getPendingUndoActions())[0]
      .taskSnapshot
    if (!removal.success) throw new Error("Expected removal to succeed")

    await expect(
      stateManager.restorePendingUndoAction(
        removal.undo.token,
        removal.undo.expiresAt - 1
      )
    ).resolves.toMatchObject({ success: true })
    expect((await stateManager.getGlobalState()).downloadQueue).toEqual([
      originalSnapshot,
    ])
  })

  it("rejects late Undo and normalizes a queued cancellation into history", async () => {
    const stateManager = new CentralizedStateManager()
    await stateManager.initialize()
    await stateManager.addDownloadTask(
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
    const cancellation = await stateManager.cancelDownloadTaskAtomically(
      "expiring-task",
      2_000
    )
    if (!cancellation.success || !cancellation.undo) {
      throw new Error("Expected queued cancellation Undo receipt")
    }

    const lateUndo = await stateManager.restorePendingUndoAction(
      cancellation.undo.token,
      cancellation.undo.expiresAt
    )

    expect(lateUndo).toMatchObject({ success: false, reason: "expired" })
    expect(
      (await stateManager.getGlobalState()).downloadQueue[0]
    ).toMatchObject({
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
    expect(await stateManager.getPendingUndoActions()).toEqual([])
  })

  it("reconciles expired actions while retaining unexpired restart state", async () => {
    const stateManager = new CentralizedStateManager()
    await stateManager.initialize()
    await stateManager.addDownloadTask(
      makeDownloadTask({ id: "old-task", mangaId: "old-task" })
    )
    await stateManager.addDownloadTask(
      makeDownloadTask({ id: "new-task", mangaId: "new-task" })
    )
    await stateManager.cancelDownloadTaskAtomically("old-task", 1_000)
    await stateManager.cancelDownloadTaskAtomically("new-task", 5_000)

    const recovery =
      await stateManager.reconcileExpiredPendingUndoActions(7_000)

    expect(recovery.finalized).toHaveLength(1)
    expect(recovery.finalized[0]).toMatchObject({
      taskSnapshot: { id: "old-task" },
    })
    expect(recovery.pending).toHaveLength(1)
    expect(recovery.pending[0]).toMatchObject({
      taskSnapshot: { id: "new-task" },
    })
    expect((await stateManager.getGlobalState()).downloadQueue).toEqual([
      expect.objectContaining({ id: "old-task", status: "canceled" }),
    ])
  })

  it("does not expose either half when the atomic Undo staging commit fails", async () => {
    const stateManager = new CentralizedStateManager()
    await stateManager.initialize()
    await stateManager.addDownloadTask(
      makeDownloadTask({ id: "atomic-task", mangaId: "atomic-task" })
    )
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
      new Error("Undo staging write failed")
    )

    await expect(
      stateManager.cancelDownloadTaskAtomically("atomic-task", 1_000)
    ).rejects.toThrow("Undo staging write failed")

    expect((await stateManager.getGlobalState()).downloadQueue).toEqual([
      expect.objectContaining({ id: "atomic-task", status: "queued" }),
    ])
    expect(
      mockLocalStorage[LOCAL_STORAGE_KEYS.pendingUndoActions]
    ).toBeUndefined()
  })
})
