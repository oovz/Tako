import { beforeEach, describe, expect, it, vi } from "vitest"

import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { QueueRepository as BaseQueueRepository } from "@/src/storage/queue-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
  FullDispatchLeaseIdentity,
} from "@/src/domain/queue/state"

class QueueRepository extends BaseQueueRepository {
  constructor() {
    super(new QueueProjectionService())
  }
}

const DISPATCH_FINGERPRINT = "a".repeat(64)

function createBoundDispatchLease(
  input: Omit<
    Parameters<typeof createDispatchLease>[0],
    "fingerprint" | "saveMode"
  >
): ActiveDispatchLease {
  return {
    ...createDispatchLease({
      ...input,
      fingerprint: DISPATCH_FINGERPRINT,
      saveMode: "downloads-api",
    }),
    documentInstanceId: "document-1",
  }
}

function fullLeaseIdentity(
  lease: ActiveDispatchLease
): FullDispatchLeaseIdentity {
  return {
    jobId: lease.jobId,
    attempt: lease.attempt,
    taskId: lease.taskId,
    chapterId: lease.chapterId,
    fingerprint: lease.fingerprint,
    documentInstanceId: lease.documentInstanceId!,
  }
}

function createTask(
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  return {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [
      {
        id: "chapter-1",
        url: "https://mangadex.org/chapter/chapter-1",
        title: "Chapter 1",
        index: 1,
        status: "queued",
        lastUpdated: 100,
      },
    ],
    status: "queued",
    created: 100,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
    ...overrides,
  }
}

type TaskSettingsMutation = (task: DownloadTaskState) => void

const malformedTaskSettingsCases: Array<{
  description: string
  mutate: TaskSettingsMutation
}> = [
  {
    description: "image concurrency below the minimum",
    mutate: (task) => {
      task.settingsSnapshot.rateLimitSettings.image.concurrency = 0
    },
  },
  {
    description: "image concurrency above the maximum",
    mutate: (task) => {
      task.settingsSnapshot.rateLimitSettings.image.concurrency = 11
    },
  },
  {
    description: "chapter concurrency below the serial invariant",
    mutate: (task) => {
      task.settingsSnapshot.rateLimitSettings.chapter.concurrency = 0
    },
  },
  {
    description: "chapter concurrency above the serial invariant",
    mutate: (task) => {
      task.settingsSnapshot.rateLimitSettings.chapter.concurrency = 2
    },
  },
  {
    description: "image delay below the minimum",
    mutate: (task) => {
      task.settingsSnapshot.rateLimitSettings.image.delayMs = -1
    },
  },
  {
    description: "image delay above the maximum",
    mutate: (task) => {
      task.settingsSnapshot.rateLimitSettings.image.delayMs = 5_001
    },
  },
  {
    description: "chapter delay below the minimum",
    mutate: (task) => {
      task.settingsSnapshot.rateLimitSettings.chapter.delayMs = -1
    },
  },
  {
    description: "chapter delay above the maximum",
    mutate: (task) => {
      task.settingsSnapshot.rateLimitSettings.chapter.delayMs = 5_001
    },
  },
  {
    description: "image retry count below the minimum",
    mutate: (task) => {
      task.settingsSnapshot.retrySettings.image = -1
    },
  },
  {
    description: "image retry count above the maximum",
    mutate: (task) => {
      task.settingsSnapshot.retrySettings.image = 11
    },
  },
  {
    description: "chapter retry count below the minimum",
    mutate: (task) => {
      task.settingsSnapshot.retrySettings.chapter = -1
    },
  },
  {
    description: "chapter retry count above the maximum",
    mutate: (task) => {
      task.settingsSnapshot.retrySettings.chapter = 11
    },
  },
]

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe("QueueRepository", () => {
  let local: Record<string, unknown>
  let localGet: ReturnType<typeof vi.fn>
  let localSet: ReturnType<typeof vi.fn>
  let localRemove: ReturnType<typeof vi.fn>
  let sessionSet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    local = {}
    localGet = vi.fn(async (keys: string | string[]) => {
      const requested = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(requested.map((key) => [key, local[key]]))
    })
    localSet = vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(local, structuredClone(values))
    })
    localRemove = vi.fn(async (key: string) => {
      delete local[key]
    })
    sessionSet = vi.fn(async () => undefined)
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: localGet, set: localSet, remove: localRemove },
        session: { set: sessionSet },
      },
      action: {
        setBadgeText: vi.fn(async () => undefined),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
      },
    } as unknown as typeof chrome)
  })

  it("serializes queue writes", async () => {
    const repository = new QueueRepository()
    await repository.getQueue()
    const firstWrite = deferred<void>()
    localSet
      .mockImplementationOnce(async () => firstWrite.promise)
      .mockImplementation(async (values: Record<string, unknown>) => {
        Object.assign(local, structuredClone(values))
      })

    const first = repository.enqueueDownloadTask(createTask({ id: "task-1" }))
    const second = repository.enqueueDownloadTask(createTask({ id: "task-2" }))
    await vi.waitFor(() => expect(localSet).toHaveBeenCalledTimes(1))

    firstWrite.resolve()
    await Promise.all([first, second])

    expect(localSet).toHaveBeenCalledTimes(2)
    expect(await repository.getQueue()).toHaveLength(2)
  })

  it("allows exactly one concurrent queued-task start", async () => {
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [
      createTask({ id: "task-1" }),
      createTask({ id: "task-2" }),
    ]
    const repository = new QueueRepository()

    const results = await Promise.all([
      repository.startDownloadTask({
        taskId: "task-1",
        now: 500,
      }),
      repository.startDownloadTask({
        taskId: "task-2",
        now: 500,
      }),
    ])

    expect(
      results.filter((result) => result.outcome === "applied")
    ).toHaveLength(1)
    expect(results).toContainEqual({
      outcome: "rejected",
      reason: "active-task-exists",
    })
    expect(localSet).toHaveBeenCalledTimes(1)
    await expect(repository.getQueue()).resolves.toMatchObject([
      { id: "task-1", status: "downloading" },
      { id: "task-2", status: "queued" },
    ])
  })

  it("hydrates and publishes valid state without rewriting durable storage", async () => {
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [createTask()]
    const repository = new QueueRepository()

    await repository.initialize()

    expect(localSet).not.toHaveBeenCalled()
    expect(sessionSet).toHaveBeenCalledTimes(1)
    await expect(repository.getQueue()).resolves.toMatchObject([
      { id: "task-1" },
    ])
  })

  it("rejects initialization when its required initial projection fails", async () => {
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [createTask()]
    sessionSet.mockRejectedValueOnce(new Error("session unavailable"))
    const repository = new QueueRepository()

    await expect(repository.initialize()).rejects.toThrow("session unavailable")
    expect(localSet).not.toHaveBeenCalled()
    expect(local[LOCAL_STORAGE_KEYS.downloadQueue]).toHaveLength(1)
  })

  it("publishes only after the durable write succeeds", async () => {
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [createTask()]
    const repository = new QueueRepository()
    const write = deferred<void>()
    localSet.mockImplementationOnce(async () => write.promise)

    const start = repository.startDownloadTask({
      taskId: "task-1",
      now: 500,
    })
    await vi.waitFor(() => expect(localSet).toHaveBeenCalledTimes(1))
    expect(sessionSet).not.toHaveBeenCalled()

    write.resolve()
    await expect(start).resolves.toMatchObject({ outcome: "applied" })
    expect(sessionSet).toHaveBeenCalledTimes(1)
  })

  it("keeps a committed transition when projection publication fails", async () => {
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [createTask()]
    sessionSet.mockRejectedValueOnce(new Error("session unavailable"))
    const repository = new QueueRepository()

    await expect(
      repository.startDownloadTask({
        taskId: "task-1",
        now: 500,
      })
    ).resolves.toMatchObject({ outcome: "applied" })
    await expect(repository.getTask("task-1")).resolves.toMatchObject({
      status: "downloading",
      started: 500,
    })
    expect(
      (local[LOCAL_STORAGE_KEYS.downloadQueue] as DownloadTaskState[])[0]
    ).toMatchObject({ status: "downloading", started: 500 })
  })

  it("publishes concurrent commits in durable commit order", async () => {
    const repository = new QueueRepository()
    const firstPublication = deferred<void>()
    sessionSet
      .mockImplementationOnce(async () => firstPublication.promise)
      .mockImplementation(async () => undefined)

    const first = repository.enqueueDownloadTask(createTask({ id: "task-1" }))
    await vi.waitFor(() => expect(sessionSet).toHaveBeenCalledTimes(1))
    const second = repository.enqueueDownloadTask(createTask({ id: "task-2" }))
    await vi.waitFor(() => expect(localSet).toHaveBeenCalledTimes(2))
    expect(sessionSet).toHaveBeenCalledTimes(1)

    firstPublication.resolve()
    await Promise.all([first, second])
    expect(sessionSet).toHaveBeenCalledTimes(2)
    expect(sessionSet.mock.calls[1]?.[0]).toMatchObject({
      queueView: [expect.anything(), expect.anything()],
    })
  })

  it("invalidates after a failed write and rehydrates on the next call", async () => {
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [createTask()]
    const repository = new QueueRepository()
    localSet.mockRejectedValueOnce(new Error("storage unavailable"))

    await expect(
      repository.startDownloadTask({
        taskId: "task-1",
        now: 500,
      })
    ).rejects.toThrow("storage unavailable")
    expect(sessionSet).not.toHaveBeenCalled()

    local[LOCAL_STORAGE_KEYS.downloadQueue] = [
      createTask({ status: "completed", completed: 700 }),
    ]
    await expect(repository.getQueue()).resolves.toMatchObject([
      { status: "completed", completed: 700 },
    ])
    expect(localGet).toHaveBeenCalledTimes(2)
  })

  it.each([
    [LOCAL_STORAGE_KEYS.downloadQueue, { legacy: true }, "download queue"],
    [
      LOCAL_STORAGE_KEYS.activeDispatchLease,
      { jobId: "legacy" },
      "active dispatch lease",
    ],
    [LOCAL_STORAGE_KEYS.pendingUndoActions, null, "pending Undo actions"],
  ])(
    "rejects malformed durable %s without overwriting it",
    async (key, value, description) => {
      local[key] = value
      const repository = new QueueRepository()

      const initialization = repository.initialize()
      await expect(initialization).rejects.toBeInstanceOf(
        InvalidDurableStateError
      )
      await expect(initialization).rejects.toThrow(
        `Invalid durable ${description}`
      )
      expect(localSet).not.toHaveBeenCalled()
      expect(local[key]).toEqual(value)
      expect(sessionSet).not.toHaveBeenCalled()
    }
  )

  it.each(malformedTaskSettingsCases)(
    "rejects malformed durable task settings ($description) without rewriting them",
    async ({ mutate }) => {
      const task = createTask()
      mutate(task)
      const durableQueue = [task]
      local[LOCAL_STORAGE_KEYS.downloadQueue] = structuredClone(durableQueue)
      const repository = new QueueRepository()

      const initialization = repository.initialize()
      await expect(initialization).rejects.toBeInstanceOf(
        InvalidDurableStateError
      )
      await expect(initialization).rejects.toThrow(
        "Invalid durable download queue"
      )
      expect(localSet).not.toHaveBeenCalled()
      expect(local[LOCAL_STORAGE_KEYS.downloadQueue]).toEqual(durableQueue)
      expect(sessionSet).not.toHaveBeenCalled()
    }
  )

  it("detaches input tasks and returned snapshots from the committed cache", async () => {
    const repository = new QueueRepository()
    const input = createTask()

    await repository.enqueueDownloadTask(input)
    input.seriesTitle = "mutated input"
    const first = await repository.getQueue()
    first[0]!.seriesTitle = "mutated output"

    await expect(repository.getQueue()).resolves.toMatchObject([
      { seriesTitle: "Series" },
    ])
    expect(
      (local[LOCAL_STORAGE_KEYS.downloadQueue] as DownloadTaskState[])[0]
        ?.seriesTitle
    ).toBe("Series")
  })

  it("commits chapter dispatch queue and lease in one storage call", async () => {
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [
      createTask({ status: "downloading", started: 100 }),
    ]
    const repository = new QueueRepository()
    const lease = createDispatchLease({
      jobId: "job-1",
      taskId: "task-1",
      chapterId: "chapter-1",
      attempt: 1,
      fingerprint: DISPATCH_FINGERPRINT,
      saveMode: "downloads-api",
      now: 200,
    })

    await expect(
      repository.beginChapterDispatch({
        taskId: "task-1",
        chapterId: "chapter-1",
        lease,
        expectedPreviousLease: null,
        now: 200,
      })
    ).resolves.toMatchObject({ outcome: "applied", lease })

    expect(localSet).toHaveBeenCalledTimes(1)
    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        [LOCAL_STORAGE_KEYS.downloadQueue]: expect.any(Array),
        [LOCAL_STORAGE_KEYS.activeDispatchLease]: lease,
      })
    )
    const restarted = new QueueRepository()
    await expect(restarted.getActiveDispatchLease()).resolves.toEqual(lease)
    await expect(restarted.getQueue()).resolves.toMatchObject([
      { chapters: [{ status: "downloading", dispatchAttempt: 1 }] },
    ])
  })

  it("does not publish a failed queue-and-lease dispatch and rehydrates unchanged records", async () => {
    const task = createTask({ status: "downloading", started: 100 })
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [task]
    const repository = new QueueRepository()
    const lease = createDispatchLease({
      jobId: "job-1",
      taskId: "task-1",
      chapterId: "chapter-1",
      attempt: 1,
      fingerprint: DISPATCH_FINGERPRINT,
      saveMode: "downloads-api",
      now: 200,
    })
    localSet.mockRejectedValueOnce(new Error("dispatch persistence failed"))

    await expect(
      repository.beginChapterDispatch({
        taskId: "task-1",
        chapterId: "chapter-1",
        lease,
        expectedPreviousLease: null,
        now: 200,
      })
    ).rejects.toThrow("dispatch persistence failed")

    expect(sessionSet).not.toHaveBeenCalled()
    expect(local[LOCAL_STORAGE_KEYS.activeDispatchLease]).toBeUndefined()
    expect(local[LOCAL_STORAGE_KEYS.downloadQueue]).toEqual([task])
    await expect(repository.getActiveDispatchLease()).resolves.toBeNull()
    await expect(repository.getQueue()).resolves.toEqual([task])
    expect(localGet).toHaveBeenCalledTimes(2)
  })

  it("derives and commits startup interruption with an exact lease clear", async () => {
    const first = createTask({
      id: "task-1",
      status: "downloading",
      started: 100,
      chapters: [
        {
          ...createTask().chapters[0]!,
          status: "downloading",
          dispatchAttempt: 1,
        },
      ],
    })
    const second = createTask({ id: "task-2" })
    const lease = createBoundDispatchLease({
      jobId: "job-1",
      taskId: "task-1",
      chapterId: "chapter-1",
      attempt: 1,
      now: 100,
    })
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [first, second]
    local[LOCAL_STORAGE_KEYS.activeDispatchLease] = lease
    const repository = new QueueRepository()

    const recoveryFacts = {
      normalizationTime: 400,
      interruptedAt: 500,
      observedLease: fullLeaseIdentity(lease),
      offscreenJob: null,
      nativeOutputTaskIds: [],
    }
    const result = await repository.recoverQueueAfterStartup(recoveryFacts)

    expect(result).toMatchObject({
      outcome: "applied",
      queue: [
        expect.objectContaining({
          id: "task-1",
          status: "failed",
          completed: 500,
          errorMessage: "Download interrupted",
        }),
        expect.objectContaining({ id: "task-2", status: "queued" }),
      ],
      recoveredTaskIds: ["task-1"],
      interruptedTaskIds: ["task-1"],
      leaseCleared: true,
    })

    expect(localSet).toHaveBeenCalledTimes(1)
    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        [LOCAL_STORAGE_KEYS.downloadQueue]: [
          expect.objectContaining({ id: "task-1", status: "failed" }),
          expect.objectContaining({ id: "task-2", status: "queued" }),
        ],
        [LOCAL_STORAGE_KEYS.activeDispatchLease]: null,
      })
    )
  })

  it("rejects startup recovery when the observed lease is stale", async () => {
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [createTask()]
    local[LOCAL_STORAGE_KEYS.activeDispatchLease] = createBoundDispatchLease({
      jobId: "job-current",
      taskId: "task-1",
      chapterId: "chapter-1",
      attempt: 1,
      now: 100,
    })
    const repository = new QueueRepository()

    await expect(
      repository.recoverQueueAfterStartup({
        normalizationTime: 400,
        interruptedAt: 500,
        observedLease: null,
        offscreenJob: null,
        nativeOutputTaskIds: [],
      })
    ).resolves.toEqual({
      outcome: "rejected",
      reason: "lease-conflict",
    })

    expect(localSet).not.toHaveBeenCalled()
  })

  it("commits queued cancellation queue and Undo receipt in one storage call", async () => {
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [createTask()]
    const repository = new QueueRepository()

    await expect(
      repository.cancelDownloadTask({
        taskId: "task-1",
        commandId: "task-1-cancel",
        now: 500,
      })
    ).resolves.toMatchObject({
      outcome: "applied",
      undo: { type: "cancel_queued", expiresAt: 5_500 },
    })

    expect(localSet).toHaveBeenCalledTimes(1)
    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        [LOCAL_STORAGE_KEYS.downloadQueue]: [],
        [LOCAL_STORAGE_KEYS.pendingUndoActions]: [
          expect.objectContaining({ type: "cancel_queued" }),
        ],
      })
    )
    const restarted = new QueueRepository()
    await expect(restarted.getQueue()).resolves.toEqual([])
    await expect(
      restarted.reconcileExpiredPendingUndoActions(500)
    ).resolves.toMatchObject({
      pending: [expect.objectContaining({ type: "cancel_queued" })],
    })
  })

  it("does not publish a failed queue-and-Undo cancellation and rehydrates unchanged records", async () => {
    const task = createTask()
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [task]
    const repository = new QueueRepository()
    localSet.mockRejectedValueOnce(new Error("Undo persistence failed"))

    await expect(
      repository.cancelDownloadTask({
        taskId: "task-1",
        commandId: "task-1-cancel",
        now: 500,
      })
    ).rejects.toThrow("Undo persistence failed")

    expect(sessionSet).not.toHaveBeenCalled()
    expect(local[LOCAL_STORAGE_KEYS.downloadQueue]).toEqual([task])
    expect(local[LOCAL_STORAGE_KEYS.pendingUndoActions]).toBeUndefined()
    await expect(repository.getQueue()).resolves.toEqual([task])
    await expect(
      repository.reconcileExpiredPendingUndoActions(500)
    ).resolves.toMatchObject({ pending: [] })
    expect(localGet).toHaveBeenCalledTimes(2)
  })

  it.each([
    { jobId: "other" },
    { attempt: 2 },
    { taskId: "other" },
    { chapterId: "other" },
    { fingerprint: "b".repeat(64) },
    { documentInstanceId: "document-2" },
  ])("rejects a full-identity lease clear mismatch %#", async (mismatch) => {
    const lease = createBoundDispatchLease({
      jobId: "job-1",
      taskId: "task-1",
      chapterId: "chapter-1",
      attempt: 1,
      now: 100,
    })
    const identity = { ...fullLeaseIdentity(lease), ...mismatch }
    local[LOCAL_STORAGE_KEYS.activeDispatchLease] = lease
    const repository = new QueueRepository()

    await expect(repository.clearDispatchLease(identity)).resolves.toEqual({
      outcome: "rejected",
      reason: "lease-not-current",
    })
    expect(localSet).not.toHaveBeenCalled()
    await expect(repository.getActiveDispatchLease()).resolves.toEqual(lease)
  })

  it("durably clears a fully matching lease and a restarted repository observes absence", async () => {
    const lease = createBoundDispatchLease({
      jobId: "job-1",
      taskId: "task-1",
      chapterId: "chapter-1",
      attempt: 1,
      now: 100,
    })
    local[LOCAL_STORAGE_KEYS.activeDispatchLease] = lease
    const repository = new QueueRepository()

    await expect(repository.clearDispatchLease(lease)).resolves.toMatchObject({
      outcome: "applied",
      lease,
    })

    expect(localSet).toHaveBeenCalledTimes(1)
    expect(localSet).toHaveBeenCalledWith({
      [LOCAL_STORAGE_KEYS.activeDispatchLease]: null,
    })
    await expect(
      new QueueRepository().getActiveDispatchLease()
    ).resolves.toBeNull()
  })

  it("does not write or project a rejected task start", async () => {
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [
      createTask({ status: "completed", completed: 500 }),
    ]
    const repository = new QueueRepository()

    await expect(
      repository.startDownloadTask({
        taskId: "task-1",
        now: 600,
      })
    ).resolves.toMatchObject({
      outcome: "rejected",
      reason: "task-not-runnable",
    })
    expect(localSet).not.toHaveBeenCalled()
    expect(sessionSet).not.toHaveBeenCalled()
  })

  it("round-trips operation-specific convergence markers through current storage", async () => {
    const markedTask = createTask({
      destinationBlockRevision: 3,
      destinationResume: {
        commandId: "destination-command",
        blockRevision: 3,
      },
      activeCancel: { commandId: "cancel-command" },
      restoredUndo: { token: "undo-token", type: "cancel_queued" },
    })
    local[LOCAL_STORAGE_KEYS.downloadQueue] = [markedTask]

    const repository = new QueueRepository()
    await expect(repository.getTask("task-1")).resolves.toMatchObject({
      destinationBlockRevision: 3,
      destinationResume: {
        commandId: "destination-command",
        blockRevision: 3,
      },
      activeCancel: { commandId: "cancel-command" },
      restoredUndo: { token: "undo-token", type: "cancel_queued" },
    })
    expect(localSet).not.toHaveBeenCalled()
  })
})
