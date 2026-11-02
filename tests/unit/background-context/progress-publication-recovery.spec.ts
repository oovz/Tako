import { setImmediate as nextTurn } from "node:timers/promises"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createProgressSnapshotReceiver } from "@/entrypoints/sidepanel/hooks/useActiveTaskProgressSubscription"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
} from "@/src/domain/queue/state"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import {
  normalizeActiveTaskProgressPortMessage,
  type ActiveTaskProgressPortMessage,
  type ActiveTaskProgressSnapshot,
} from "@/src/runtime/active-task-progress"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { HistoryRepository } from "@/src/storage/history-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"

type LiveProgress = Omit<
  ActiveTaskProgressSnapshot,
  "generation" | "revision" | "updatedAt"
>

function liveProgress(imagesProcessed = 1): LiveProgress {
  return {
    taskId: "task-1",
    chapterId: "chapter-1",
    chapterTitle: "Chapter 1",
    imagesProcessed,
    totalImages: 10,
    activeChapterCount: 1,
    activeChapters: [
      {
        chapterId: "chapter-1",
        chapterTitle: "Chapter 1",
        imagesProcessed,
        totalImages: 10,
        stage: "downloading",
        phaseFraction: imagesProcessed / 10,
        updatedAt: Date.now(),
      },
    ],
    stage: "downloading",
    phaseFraction: imagesProcessed / 10,
    overallFraction: 0.05,
    outputCommitted: false,
    status: "downloading",
  }
}

function connectPort(
  bus: typeof import("@/entrypoints/background/active-task-progress-bus")
) {
  const received: unknown[] = []
  let delivering: ActiveTaskProgressPortMessage | undefined
  let accepted: ActiveTaskProgressPortMessage | undefined
  const receiver = createProgressSnapshotReceiver(() => {
    accepted = delivering
  })
  bus.registerActiveTaskProgressPort({
    name: bus.ACTIVE_TASK_PROGRESS_PORT_NAME,
    postMessage: (message: unknown) => {
      received.push(structuredClone(message))
      const parsed = normalizeActiveTaskProgressPortMessage(message)
      if (parsed) {
        delivering = parsed
        receiver.receive(parsed)
      }
    },
    onDisconnect: { addListener: vi.fn() },
  } as unknown as chrome.runtime.Port)
  return {
    received,
    latest: () => {
      expect(
        received.every(
          (message) => normalizeActiveTaskProgressPortMessage(message) !== null
        )
      ).toBe(true)
      expect(accepted).toBeDefined()
      return accepted!
    },
  }
}

function storageArea(data: Record<string, unknown>) {
  return {
    get: vi.fn(async (keys: string | string[]) => {
      const names = typeof keys === "string" ? [keys] : keys
      return Object.fromEntries(
        names.map((key) => [key, structuredClone(data[key])])
      )
    }),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(data, structuredClone(values))
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys)
        delete data[key]
    }),
  }
}

async function dispatchedFolderTask(chapterCount: number) {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = "file-system-access"
  settings.downloads.customDirectoryHandleId = "folder-1"
  const task: DownloadTaskState = {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: Array.from({ length: chapterCount }, (_, index) => ({
      id: `chapter-${index + 1}`,
      title: `Chapter ${index + 1}`,
      url: `https://mangadex.org/chapter/chapter-${index + 1}`,
      requestedPath: `Series/Chapter-${index + 1}.cbz`,
      index: index + 1,
      status: "queued",
      lastUpdated: Date.now(),
    })),
    status: "queued",
    created: Date.now(),
    settingsSnapshot: createTaskSettingsSnapshot(settings, "mangadex"),
  }
  const queue = new QueueRepository(
    new QueueProjectionService(),
    new HistoryRepository()
  )
  expect((await queue.enqueueDownloadTask(task)).outcome).toBe("applied")
  expect(
    (await queue.startDownloadTask({ taskId: task.id, now: Date.now() }))
      .outcome
  ).toBe("applied")
  const lease: ActiveDispatchLease = {
    ...createDispatchLease({
      jobId: "folder-job-1",
      taskId: task.id,
      chapterId: task.chapters[0].id,
      attempt: 1,
      fingerprint: "a".repeat(64),
      saveMode: "fsa",
      destinationHandleId: "folder-1",
    }),
    documentInstanceId: "document-1",
  }
  expect(
    (
      await queue.beginChapterDispatch({
        taskId: task.id,
        chapterId: lease.chapterId,
        lease,
        expectedPreviousLease: null,
        now: Date.now(),
      })
    ).outcome
  ).toBe("applied")
  return { queue, lease }
}

async function settleFolderChapter(
  queue: QueueRepository,
  lease: ActiveDispatchLease,
  status: "completed" | "partial_success"
) {
  const outputs =
    status === "completed"
      ? { requested: 2, committed: 2, failed: 0 }
      : { requested: 2, committed: 1, failed: 1 }
  expect(
    (
      await queue.settleTaskChapter({
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        status,
        lease,
        now: Date.now(),
        updates: {
          outputs,
          outputDestination: "fsa",
          ...(status === "completed" ? { saveConfirmedAt: Date.now() } : {}),
        },
      })
    ).outcome
  ).toBe("applied")
  expect((await queue.clearDispatchLease(lease)).outcome).toBe("applied")
  const task = await queue.getTask(lease.taskId)
  expect(task).toBeDefined()
  expect(task!.chapters[0]).toMatchObject({ status, outputs })
  return task!
}

describe("progress publication and recovery", () => {
  let session: Record<string, unknown>
  let area: ReturnType<typeof storageArea>
  let now: number

  beforeEach(() => {
    vi.resetModules()
    session = {}
    area = storageArea(session)
    now = 20_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    vi.stubGlobal("chrome", {
      ...chrome,
      storage: { local: storageArea({}), session: area },
      action: {
        setBadgeText: vi.fn(async () => undefined),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([0.5, "invalid revision"])(
    "recovers an unknown invalid stored revision into usable live Port events (%s)",
    async (storedRevision) => {
      session[SESSION_STORAGE_KEYS.activeTaskProgressRevision] = storedRevision
      const bus =
        await import("@/entrypoints/background/active-task-progress-bus")
      const port = connectPort(bus)
      await nextTurn()
      const initial = port.latest()
      expect(initial.progress).toBeNull()

      await bus.publishActiveTaskProgress(liveProgress(), {
        forcePersist: true,
      })
      const published = port.latest()
      expect(published.generation).toBe(initial.generation)
      expect(published.revision).toBe(initial.revision + 1)
      expect(published.progress).toMatchObject({
        taskId: "task-1",
        imagesProcessed: 1,
      })
    }
  )

  it("delivers each live update while bounding recovery writes and awaiting an explicit checkpoint", async () => {
    const bus =
      await import("@/entrypoints/background/active-task-progress-bus")
    const port = connectPort(bus)
    await bus.publishActiveTaskProgress(liveProgress(), { forcePersist: true })
    const initial = port.latest()
    for (const images of [2, 3, 4]) {
      now += 10
      await bus.publishActiveTaskProgress(liveProgress(images))
      const update = port.latest()
      expect(update.progress?.imagesProcessed).toBe(images)
      expect(update.revision).toBe(initial.revision + images - 1)
    }
    expect(session[SESSION_STORAGE_KEYS.activeTaskProgress]).toMatchObject({
      imagesProcessed: 1,
    })
    expect(area.set).toHaveBeenCalledTimes(1)

    now += 60_000
    await bus.publishActiveTaskProgress(liveProgress(5))
    await nextTurn()
    expect(area.set).toHaveBeenCalledTimes(2)
    expect(session[SESSION_STORAGE_KEYS.activeTaskProgress]).toMatchObject({
      imagesProcessed: 5,
    })

    const release = Promise.withResolvers<void>()
    area.set.mockImplementationOnce(async (values) => {
      await release.promise
      Object.assign(session, structuredClone(values))
    })
    now += 10
    let finished = false
    const checkpoint = bus
      .publishActiveTaskProgress(liveProgress(6), { forcePersist: true })
      .then(() => {
        finished = true
      })
    try {
      await nextTurn()
      expect(port.latest().progress?.imagesProcessed).toBe(6)
      expect(finished).toBe(false)
      expect(session[SESSION_STORAGE_KEYS.activeTaskProgress]).toMatchObject({
        imagesProcessed: 5,
      })
    } finally {
      release.resolve()
      await checkpoint
    }
    expect(session[SESSION_STORAGE_KEYS.activeTaskProgress]).toMatchObject({
      imagesProcessed: 6,
    })
  })

  it("keeps clear pending until the null recovery snapshot is committed", async () => {
    const bus =
      await import("@/entrypoints/background/active-task-progress-bus")
    const port = connectPort(bus)
    await bus.publishActiveTaskProgress(liveProgress(), { forcePersist: true })
    const release = Promise.withResolvers<void>()
    area.set.mockImplementationOnce(async (values) => {
      await release.promise
      Object.assign(session, structuredClone(values))
    })
    let finished = false
    const clearing = bus.clearActiveTaskProgress().then(() => {
      finished = true
    })
    try {
      await nextTurn()
      expect(port.latest().progress).toBeNull()
      expect(finished).toBe(false)
      expect(session[SESSION_STORAGE_KEYS.activeTaskProgress]).toMatchObject({
        taskId: "task-1",
      })
    } finally {
      release.resolve()
      await clearing
    }
    expect(session[SESSION_STORAGE_KEYS.activeTaskProgress]).toBeNull()
  })

  it("publishes one settled chapter out of three without remaining image work and awaits recovery persistence", async () => {
    const { queue, lease } = await dispatchedFolderTask(3)
    const bus =
      await import("@/entrypoints/background/active-task-progress-bus")
    const port = connectPort(bus)
    await bus.publishActiveTaskProgress(liveProgress(), { forcePersist: true })
    const task = await settleFolderChapter(queue, lease, "completed")
    expect(task.chapters.map((chapter) => chapter.status)).toEqual([
      "completed",
      "queued",
      "queued",
    ])
    const release = Promise.withResolvers<void>()
    area.set.mockImplementationOnce(async (values) => {
      await release.promise
      Object.assign(session, structuredClone(values))
    })
    let finished = false
    const settlement = bus
      .settleActiveTaskProgressChapter({
        taskId: task.id,
        chapterId: lease.chapterId,
        chapters: task.chapters,
        destinationCommitted: true,
      })
      .then(() => {
        finished = true
      })
    try {
      await nextTurn()
      expect(port.latest().progress).toMatchObject({
        overallFraction: 1 / 3,
        stage: "accepted",
        phaseFraction: 0,
        activeChapters: [],
        activeChapterCount: 0,
        imagesProcessed: 0,
        totalImages: 0,
        outputCommitted: true,
      })
      expect(finished).toBe(false)
    } finally {
      release.resolve()
      await settlement
    }
    expect(session[SESSION_STORAGE_KEYS.activeTaskProgress]).toMatchObject({
      overallFraction: 1 / 3,
      activeChapterCount: 0,
    })
  })

  it.each(["completed", "partial_success"] as const)(
    "reports a finished chapter phase and reserves full task progress for confirmed saves (%s)",
    async (status) => {
      const { queue, lease } = await dispatchedFolderTask(1)
      const bus =
        await import("@/entrypoints/background/active-task-progress-bus")
      const port = connectPort(bus)
      await bus.publishActiveTaskProgress(liveProgress(), {
        forcePersist: true,
      })
      const task = await settleFolderChapter(queue, lease, status)
      await bus.settleActiveTaskProgressChapter({
        taskId: task.id,
        chapterId: lease.chapterId,
        chapters: task.chapters,
        destinationCommitted: status === "completed",
      })
      const result = port.latest().progress
      expect(result).toMatchObject({
        stage: "saving",
        phaseFraction: 1,
        activeChapterCount: 0,
        imagesProcessed: 0,
        totalImages: 0,
      })
      if (status === "completed") {
        expect(task.chapters[0].saveConfirmedAt).toBeDefined()
        expect(result?.outputCommitted).toBe(true)
        expect(result?.overallFraction).toBe(1)
      } else {
        expect(task.chapters[0].saveConfirmedAt).toBeUndefined()
        expect(result?.outputCommitted).toBe(false)
        expect(result?.overallFraction).toBeGreaterThan(0)
        expect(result?.overallFraction).toBeLessThan(1)
      }
    }
  )
})
