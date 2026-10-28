import { reconcileCompletedChapterHistory } from "@/src/storage/completed-chapter-history"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { finalizeDownloadTaskAfterDispatch } from "@/entrypoints/background/download-queue-finalization"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { HistoryRepository } from "@/src/storage/history-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import { createPendingUndoAction } from "@/src/domain/queue/pending-undo"

function task(): DownloadTaskState {
  return {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    status: "downloading",
    created: 100,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
    chapters: [
      {
        requestedPath: "Tako/Chapter.cbz",
        id: "chapter-1",
        title: "Chapter 1",
        url: "https://mangadex.org/chapter/chapter-1",
        chapterNumber: 1,
        index: 0,
        status: "completed",
        lastUpdated: 200,
      },
    ],
  }
}

describe("chapter history retention across task removal", () => {
  let stored: Record<string, unknown>
  let history: HistoryRepository
  let queue: QueueRepository
  let failHistory: boolean

  const settingsRepository = { getSettings: async () => DEFAULT_SETTINGS }

  async function persist(values: Record<string, unknown>): Promise<void> {
    if (failHistory && LOCAL_STORAGE_KEYS.downloadedChapters in values) {
      throw new Error("History storage unavailable")
    }
    Object.assign(stored, structuredClone(values))
  }

  beforeEach(() => {
    stored = { [LOCAL_STORAGE_KEYS.downloadQueue]: [task()] }
    failHistory = false
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (keys: string[]) =>
            Object.fromEntries(
              keys
                .filter((key) => key in stored)
                .map((key) => [key, structuredClone(stored[key])])
            )
          ),
          set: vi.fn(persist),
        },
        session: { set: vi.fn(async () => undefined) },
      },
    })
    history = new HistoryRepository()
    queue = new QueueRepository(new QueueProjectionService(), history)
  })

  async function completeTask(): Promise<void> {
    expect(
      await finalizeDownloadTaskAfterDispatch({
        stateManager: queue,
        taskId: "task-1",
        chapterOutcomesByIndex: [
          { chapterId: "chapter-1", status: "completed" },
        ],
        finalizationDependencies: {
          historyRepository: history,
          settingsRepository,
        },
      })
    ).toMatchObject({ finalized: true, finalStatus: "completed" })
  }

  it("promotes older processed history only from a later confirmed save", async () => {
    const earlier = task()
    earlier.chapters[0]!.lastUpdated = 50
    await reconcileCompletedChapterHistory([earlier], history)
    expect(
      (await history.getDownloadedChapters())[0]?.saveConfirmedAt
    ).toBeUndefined()
    const confirmed = task()
    confirmed.chapters[0]!.outputDestination = "fsa"
    confirmed.chapters[0]!.saveConfirmedAt = 200
    stored[LOCAL_STORAGE_KEYS.downloadQueue] = [confirmed]
    await completeTask()
    const saved = (await history.getDownloadedChapters())[0]!
    expect(saved).toMatchObject({
      downloadedAt: 200,
      saveConfirmedAt: 200,
      outputDestination: "fsa",
    })
    await history.markChapterAsDownloaded({
      ...saved,
      downloadedAt: 300,
      saveConfirmedAt: undefined,
      outputDestination: "downloads-api",
    })
    expect(await new HistoryRepository().getDownloadedChapters()).toEqual([
      saved,
    ])
  })

  it("does not resurrect cleared history when retained tasks later acquire confirmation", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(250)
    try {
      await history.clearAllDownloadHistory()
      const confirmed = task()
      confirmed.chapters[0]!.outputDestination = "fsa"
      confirmed.chapters[0]!.saveConfirmedAt = 200
      stored[LOCAL_STORAGE_KEYS.downloadQueue] = [confirmed]
      await completeTask()
      await queue.clearTerminalHistory()
      expect(await new HistoryRepository().getDownloadedChapters()).toEqual([])
    } finally {
      now.mockRestore()
    }
  })

  it("preserves the last confirmed source when newer retained work has no save proof", async () => {
    const confirmed = {
      ...task(),
      id: "confirmed",
      status: "completed" as const,
    }
    confirmed.chapters[0]!.lastUpdated = 100
    confirmed.chapters[0]!.outputDestination = "fsa"
    confirmed.chapters[0]!.saveConfirmedAt = 100
    const unconfirmed = { ...task(), id: "unconfirmed" }
    unconfirmed.chapters[0]!.title = "Later unconfirmed chapter"
    unconfirmed.settingsSnapshot.archiveFormat = "zip"
    stored[LOCAL_STORAGE_KEYS.downloadQueue] = [confirmed, unconfirmed]
    await reconcileCompletedChapterHistory([unconfirmed], history)
    expect(await history.getDownloadedChapters()).toMatchObject([
      { downloadedAt: 200 },
    ])
    failHistory = true
    await expect(queue.clearTerminalHistory()).rejects.toThrow(
      "History storage unavailable"
    )
    expect((await queue.getQueue()).map((entry) => entry.id)).toEqual([
      "confirmed",
      "unconfirmed",
    ])
    failHistory = false
    await queue.clearTerminalHistory()
    expect(await new HistoryRepository().getDownloadedChapters()).toMatchObject(
      [
        {
          downloadedAt: 100,
          saveConfirmedAt: 100,
          outputDestination: "fsa",
          title: "Chapter 1",
          format: "cbz",
        },
      ]
    )
  })

  it("preserves chapter memory when the first history write fails and terminal tasks are cleared", async () => {
    failHistory = true
    await completeTask()
    expect(await history.getDownloadedChapters()).toEqual([])

    failHistory = false
    expect(await queue.clearTerminalHistory()).toMatchObject({
      removedTaskIds: ["task-1"],
    })

    const coldQueue = new QueueRepository(
      new QueueProjectionService(),
      new HistoryRepository()
    )
    const coldHistory = new HistoryRepository()
    await reconcileCompletedChapterHistory(
      await coldQueue.getQueue(),
      coldHistory
    )
    expect(await coldQueue.getQueue()).toEqual([])
    expect(await coldHistory.getDownloadedChapters()).toMatchObject([
      {
        chapterId: "chapter-1",
        seriesId: "series-1",
        format: "cbz",
      },
    ])
  })

  it("keeps the completed task recoverable while history storage remains unavailable", async () => {
    failHistory = true
    await completeTask()
    await expect(queue.clearTerminalHistory()).rejects.toThrow(
      "History storage unavailable"
    )
    failHistory = false
    const coldHistory = new HistoryRepository()
    const coldQueue = new QueueRepository(
      new QueueProjectionService(),
      coldHistory
    )
    await reconcileCompletedChapterHistory(
      await coldQueue.getQueue(),
      coldHistory
    )
    expect(await coldQueue.getTask("task-1")).toMatchObject({
      status: "completed",
    })
    expect(
      await coldHistory.isChapterDownloaded("mangadex", "series-1", "chapter-1")
    ).toBe(true)
  })

  it.each(["undo", "alarm", "startup", "expired-undo"] as const)(
    "retains chapter history after individual removal and %s",
    async (action) => {
      failHistory = true
      await completeTask()
      failHistory = false
      const removal = await queue.removeTerminalDownloadTask({
        taskId: "task-1",
        undoToken: "remove-1",
        now: 300,
      })
      expect(removal.outcome).toBe("applied")
      expect(await queue.getQueue()).toEqual([])

      const coldHistory = new HistoryRepository()
      const coldQueue = new QueueRepository(
        new QueueProjectionService(),
        coldHistory
      )
      if (action === "alarm") {
        await coldQueue.finalizePendingUndoAction("remove-1")
      } else if (action === "startup") {
        await coldQueue.reconcileExpiredPendingUndoActions(5_300)
      } else {
        expect(
          await coldQueue.restorePendingUndoAction({
            token: "remove-1",
            now: action === "undo" ? 301 : 5_300,
          })
        ).toMatchObject({ restored: action === "undo" })
      }
      await reconcileCompletedChapterHistory(
        await coldQueue.getQueue(),
        coldHistory
      )
      expect(await coldHistory.getDownloadedChapters()).toMatchObject([
        {
          chapterId: "chapter-1",
          chapterNumber: 1,
          format: "cbz",
        },
      ])
      expect(Boolean(await coldQueue.getTask("task-1"))).toBe(action === "undo")
    }
  )

  it.each(["all", "series", "chapter"] as const)(
    "honors an explicit %s history clear before task removal",
    async (scope) => {
      await completeTask()
      if (scope === "all") await history.clearAllDownloadHistory()
      else if (scope === "series")
        await history.clearSeriesDownloadHistory("mangadex", "series-1")
      else
        await history.removeDownloadedChapter(
          "mangadex",
          "series-1",
          "chapter-1"
        )
      failHistory = true
      await queue.clearTerminalHistory()
      const coldHistory = new HistoryRepository()
      expect(await coldHistory.getDownloadedChapters()).toEqual([])
      expect(await queue.getQueue()).toEqual([])
    }
  )

  it.each(["alarm", "startup", "expired-undo"] as const)(
    "preserves a retained Undo repair source when %s cannot persist history",
    async (action) => {
      stored[LOCAL_STORAGE_KEYS.downloadQueue] = []
      stored[LOCAL_STORAGE_KEYS.pendingUndoActions] = [
        createPendingUndoAction({
          token: "retained-removal",
          type: "remove_history",
          taskSnapshot: { ...task(), status: "completed", completed: 200 },
          previousQueuePosition: 0,
          now: 300,
        }),
      ]
      const expire = (repository: QueueRepository) =>
        action === "alarm"
          ? repository.finalizePendingUndoAction("retained-removal")
          : action === "startup"
            ? repository.reconcileExpiredPendingUndoActions(5_300)
            : repository.restorePendingUndoAction({
                token: "retained-removal",
                now: 5_300,
              })
      failHistory = true
      await expect(expire(queue)).rejects.toThrow("History storage unavailable")
      expect(stored[LOCAL_STORAGE_KEYS.pendingUndoActions]).toHaveLength(1)

      failHistory = false
      const coldHistory = new HistoryRepository()
      const coldQueue = new QueueRepository(
        new QueueProjectionService(),
        coldHistory
      )
      await expire(coldQueue)
      expect(stored[LOCAL_STORAGE_KEYS.pendingUndoActions]).toEqual([])
      expect(await coldHistory.getDownloadedChapters()).toMatchObject([
        {
          chapterId: "chapter-1",
          downloadedAt: 200,
        },
      ])
    }
  )

  it("preserves existing history and active work when completed tasks are cleared", async () => {
    const existing = {
      siteIntegrationId: "mangadex",
      seriesId: "series-1",
      seriesTitle: "Series",
      chapterId: "chapter-1",
      title: "Previously saved",
      url: "https://mangadex.org/chapter/chapter-1",
      downloadedAt: 50,
      format: "zip" as const,
      fileSize: 42,
      filePath: "saved.zip",
    }
    await history.markChapterAsDownloaded(existing)
    await completeTask()
    await history.markChapterAsDownloaded(existing)
    await queue.enqueueDownloadTask({
      ...task(),
      id: "active",
      status: "downloading",
    })
    await queue.enqueueDownloadTask({
      ...task(),
      id: "queued",
      status: "queued",
    })
    failHistory = true
    await queue.clearTerminalHistory()
    expect(await new HistoryRepository().getDownloadedChapters()).toEqual([
      existing,
    ])
    expect((await queue.getQueue()).map((task) => task.id)).toEqual([
      "active",
      "queued",
    ])
  })

  it("stores chapter history before committing task deletion", async () => {
    failHistory = true
    await completeTask()
    failHistory = false
    let reachedWrite!: () => void
    const writing = new Promise<void>((resolve) => {
      reachedWrite = resolve
    })
    let releaseWrite!: () => void
    const permissionToWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    vi.mocked(chrome.storage.local.set).mockImplementationOnce(
      async (values) => {
        reachedWrite()
        await permissionToWrite
        await persist(values)
      }
    )
    const clearing = queue.clearTerminalHistory()
    await writing
    // A cold reader still has the repair source while the history write waits.
    expect(
      await new QueueRepository(
        new QueueProjectionService(),
        new HistoryRepository()
      ).getTask("task-1")
    ).toMatchObject({ status: "completed" })
    releaseWrite()
    await clearing
    expect(
      await new HistoryRepository().isChapterDownloaded(
        "mangadex",
        "series-1",
        "chapter-1"
      )
    ).toBe(true)
    expect(await queue.getQueue()).toEqual([])
  })

  it("retains the task and saved chapter history when the deletion write fails", async () => {
    failHistory = true
    await completeTask()
    failHistory = false
    vi.mocked(chrome.storage.local.set).mockImplementation(async (values) => {
      if (LOCAL_STORAGE_KEYS.downloadQueue in values)
        throw new Error("Queue storage unavailable")
      await persist(values)
    })
    await expect(queue.clearTerminalHistory()).rejects.toThrow(
      "Queue storage unavailable"
    )
    const coldHistory = new HistoryRepository()
    const coldQueue = new QueueRepository(
      new QueueProjectionService(),
      coldHistory
    )
    expect(await coldQueue.getTask("task-1")).toMatchObject({
      status: "completed",
    })
    expect(
      await coldHistory.isChapterDownloaded("mangadex", "series-1", "chapter-1")
    ).toBe(true)
    vi.mocked(chrome.storage.local.set).mockImplementation(persist)
    await coldQueue.clearTerminalHistory()
    expect(await coldHistory.getDownloadedChapters()).toHaveLength(1)
  })

  it("preserves chapter metadata saved while reconciliation reads existing history", async () => {
    let reachedRead!: () => void
    const reading = new Promise<void>((resolve) => {
      reachedRead = resolve
    })
    let releaseRead!: () => void
    const permissionToRead = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(async () => {
      reachedRead()
      await permissionToRead
      return {}
    })
    const reconciling = reconcileCompletedChapterHistory([task()], history)
    await reading
    const record = {
      siteIntegrationId: "mangadex",
      seriesId: "series-1",
      seriesTitle: "Series",
      chapterId: "chapter-1",
      title: "Newly saved",
      url: "https://mangadex.org/chapter/chapter-1",
      downloadedAt: 400,
      saveConfirmedAt: 400,
      format: "zip" as const,
      fileSize: 42,
      filePath: "saved.zip",
    }
    const saving = history.markChapterAsDownloaded(record)
    releaseRead()
    await Promise.all([saving, reconciling])
    expect(await new HistoryRepository().getDownloadedChapters()).toEqual([
      record,
    ])
  })

  it("restores an unexpired Undo repair source while history storage is unavailable", async () => {
    stored[LOCAL_STORAGE_KEYS.downloadQueue] = []
    stored[LOCAL_STORAGE_KEYS.pendingUndoActions] = [
      createPendingUndoAction({
        token: "retained-removal",
        type: "remove_history",
        taskSnapshot: { ...task(), status: "completed", completed: 200 },
        previousQueuePosition: 0,
        now: 300,
      }),
    ]
    failHistory = true
    expect(
      await queue.restorePendingUndoAction({
        token: "retained-removal",
        now: 301,
      })
    ).toMatchObject({ restored: true })
    failHistory = false
    const coldHistory = new HistoryRepository()
    const coldQueue = new QueueRepository(
      new QueueProjectionService(),
      coldHistory
    )
    await reconcileCompletedChapterHistory(
      await coldQueue.getQueue(),
      coldHistory
    )
    expect(
      await coldHistory.isChapterDownloaded("mangadex", "series-1", "chapter-1")
    ).toBe(true)
  })

  it("recovers chapter history from Undo after a task is removed during a history outage", async () => {
    failHistory = true
    await completeTask()
    expect(
      await queue.removeTerminalDownloadTask({
        taskId: "task-1",
        undoToken: "remove-1",
        now: 300,
      })
    ).toMatchObject({ outcome: "applied" })
    expect(await queue.getQueue()).toEqual([])
    await expect(queue.finalizePendingUndoAction("remove-1")).rejects.toThrow(
      "History storage unavailable"
    )
    failHistory = false
    const coldHistory = new HistoryRepository()
    const coldQueue = new QueueRepository(
      new QueueProjectionService(),
      coldHistory
    )
    await coldQueue.reconcileExpiredPendingUndoActions(5_300)
    expect(await coldQueue.getQueue()).toEqual([])
    expect(stored[LOCAL_STORAGE_KEYS.pendingUndoActions]).toEqual([])
    expect(
      await coldHistory.isChapterDownloaded("mangadex", "series-1", "chapter-1")
    ).toBe(true)
  })

  it("stores a newer completion when the remaining source predates a history clear", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(300)
    try {
      await history.clearAllDownloadHistory()
    } finally {
      clock.mockRestore()
    }
    const completed = {
      ...task(),
      status: "completed" as const,
      completed: 400,
    }
    stored[LOCAL_STORAGE_KEYS.downloadQueue] = [
      {
        ...completed,
        id: "older",
        chapters: [{ ...task().chapters[0]!, lastUpdated: 200 }],
      },
      {
        ...completed,
        id: "newer",
        chapters: [{ ...task().chapters[0]!, lastUpdated: 400 }],
      },
    ]
    await queue.removeTerminalDownloadTask({
      taskId: "newer",
      undoToken: "remove-newer",
      now: 500,
    })
    await queue.finalizePendingUndoAction("remove-newer")
    expect(await new HistoryRepository().getDownloadedChapters()).toMatchObject(
      [
        {
          chapterId: "chapter-1",
          downloadedAt: 400,
        },
      ]
    )
    expect((await queue.getQueue()).map((task) => task.id)).toEqual(["older"])
  })
})
