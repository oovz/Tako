import { beforeEach, describe, expect, it, vi } from "vitest"

import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import { initializeFromStorage } from "@/entrypoints/background/initialize-from-storage"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { DownloadTaskState } from "@/src/types/queue-state"

const recoveryMocks = vi.hoisted(() => ({
  armRecoveredTaskContinuation: vi.fn(),
}))

vi.mock("@/entrypoints/background/offscreen-progress-handler", () => ({
  armRecoveredTaskContinuation: recoveryMocks.armRecoveredTaskContinuation,
}))

function makeTask(overrides: Partial<DownloadTaskState>): DownloadTaskState {
  const siteIntegrationId = overrides.siteIntegrationId ?? "mangadex"
  return {
    id: "task-1",
    siteIntegrationId,
    mangaId: "series-1",
    seriesTitle: "Series 1",
    chapters: [],
    status: "queued",
    created: 1,
    settingsSnapshot: createTaskSettingsSnapshot(
      DEFAULT_SETTINGS,
      siteIntegrationId
    ),
    ...overrides,
  }
}

describe("initializeFromStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("normalizes zombie downloading task when offscreen is missing and re-projects queueView", async () => {
    const queue: DownloadTaskState[] = [
      makeTask({
        id: "zombie",
        status: "downloading",
        chapters: [
          {
            id: "c1",
            url: "c1",
            title: "c1",
            index: 1,
            status: "completed",
            lastUpdated: 1,
          },
          {
            id: "c2",
            url: "c2",
            title: "c2",
            index: 2,
            status: "downloading",
            lastUpdated: 1,
          },
          {
            id: "c3",
            url: "c3",
            title: "c3",
            index: 3,
            status: "queued",
            lastUpdated: 1,
          },
        ],
      }),
      makeTask({ id: "queued-next", status: "queued", created: 2 }),
    ]

    const writeQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const writeSession = vi.fn(async (_values: Record<string, unknown>) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const ensureLivenessAlarm = vi.fn(async () => {})
    const setLivenessAlarmArmed = vi.fn(async (_shouldArm: boolean) => {})

    const result = await initializeFromStorage({
      readQueue: async () => queue,
      writeQueue,
      writeSession,
      applyQueue,
      getOffscreenContexts: async () => [],
      getOffscreenActiveTaskIds: async () => [],
      ensureLivenessAlarm,
      setLivenessAlarmArmed,
    })

    expect(result.initFailed).toBe(false)
    expect(writeQueue).toHaveBeenCalledTimes(1)

    const persistedQueue = writeQueue.mock.calls[0]?.[0] as DownloadTaskState[]
    const normalizedZombie = persistedQueue.find((task) => task.id === "zombie")
    expect(normalizedZombie?.status).toBe("partial_success")
    expect(normalizedZombie?.errorMessage).toBe("Download interrupted")
    expect(normalizedZombie?.chapters.map((chapter) => chapter.status)).toEqual(
      ["completed", "failed", "failed"]
    )

    const queueViewWrite = writeSession.mock.calls.find(
      (call) =>
        call[0] && Object.prototype.hasOwnProperty.call(call[0], "queueView")
    )
    expect(queueViewWrite).toBeDefined()
    expect(queueViewWrite?.[0]).toEqual(
      expect.objectContaining({
        [SESSION_STORAGE_KEYS.queueView]: expect.any(Array),
        [SESSION_STORAGE_KEYS.historyView]: expect.any(Array),
        [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
        [SESSION_STORAGE_KEYS.initFailed]: false,
        error: null,
      })
    )
    expect(applyQueue).toHaveBeenCalledWith(persistedQueue)

    expect(setLivenessAlarmArmed).toHaveBeenCalledWith(false)
    expect(ensureLivenessAlarm).not.toHaveBeenCalled()
    expect(result.queueActivation).toEqual({ kind: "process-queue" })
  })

  it("preserves a provider-policy block across restart without treating it as active work", async () => {
    const queue = [
      makeTask({
        id: "provider-blocked",
        siteIntegrationId: "manhuagui",
        status: "downloading",
        activeBlock: "provider_network_policy_pending",
      }),
      makeTask({
        id: "runnable-next",
        status: "queued",
        created: 2,
      }),
    ]
    const writeQueue = vi.fn(async () => undefined)
    const ensureLivenessAlarm = vi.fn(async () => undefined)
    const setLivenessAlarmArmed = vi.fn(async () => undefined)

    const result = await initializeFromStorage({
      readQueue: async () => queue,
      writeQueue,
      writeSession: async () => undefined,
      applyQueue: async () => undefined,
      getOffscreenContexts: async () => [],
      getOffscreenActiveTaskIds: async () => [],
      ensureLivenessAlarm,
      setLivenessAlarmArmed,
    })

    expect(result.queue[0]).toMatchObject({
      id: "provider-blocked",
      status: "queued",
      activeBlock: "provider_network_policy_pending",
    })
    expect(result.queueActivation).toEqual({ kind: "process-queue" })
    expect(ensureLivenessAlarm).not.toHaveBeenCalled()
    expect(setLivenessAlarmArmed).toHaveBeenCalledWith(false)
    expect(writeQueue).toHaveBeenCalledWith(result.queue)
  })

  it("marks initFailed in session when initialization throws", async () => {
    const writeSession = vi.fn(async (_values: Record<string, unknown>) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})

    const result = await initializeFromStorage({
      readQueue: async () => {
        throw new Error("storage corruption")
      },
      writeQueue: async () => {},
      writeSession,
      applyQueue,
      getOffscreenContexts: async () => [],
      getOffscreenActiveTaskIds: async () => [],
      ensureLivenessAlarm: async () => {},
    })

    expect(result.initFailed).toBe(true)
    expect(result.error).toBe("storage corruption")
    expect(writeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        [SESSION_STORAGE_KEYS.queueView]: [],
        [SESSION_STORAGE_KEYS.historyView]: [],
        [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
        [SESSION_STORAGE_KEYS.initFailed]: true,
        error: "storage corruption",
      })
    )
  })

  it("resumes the exact active task when its offscreen context is alive", async () => {
    const queue: DownloadTaskState[] = [
      makeTask({
        id: "active-with-offscreen",
        status: "downloading",
        chapters: [
          {
            id: "c1",
            url: "c1",
            title: "c1",
            index: 1,
            status: "downloading",
            lastUpdated: 1,
          },
        ],
      }),
    ]

    const writeQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const writeSession = vi.fn(async (_values: Record<string, unknown>) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const ensureLivenessAlarm = vi.fn(async () => {})

    const result = await initializeFromStorage({
      readQueue: async () => queue,
      writeQueue,
      writeSession,
      applyQueue,
      getOffscreenContexts: async () => [{}],
      getOffscreenActiveTaskIds: async () => ["active-with-offscreen"],
      ensureLivenessAlarm,
    })

    expect(result.initFailed).toBe(false)
    expect(result.queue[0]?.status).toBe("downloading")
    expect(result.queue[0]?.chapters[0]?.status).toBe("downloading")

    expect(writeQueue).not.toHaveBeenCalled()
    expect(applyQueue).toHaveBeenCalledWith(queue)
    expect(result.queueActivation).toEqual({
      kind: "resume-task",
      taskId: "active-with-offscreen",
    })
    expect(ensureLivenessAlarm).toHaveBeenCalledTimes(1)
    expect(recoveryMocks.armRecoveredTaskContinuation).not.toHaveBeenCalled()
  })

  it("does not resume queued work when offscreen context is alive and another task is already downloading", async () => {
    const queue: DownloadTaskState[] = [
      makeTask({
        id: "active-with-offscreen",
        status: "downloading",
        chapters: [
          {
            id: "c1",
            url: "c1",
            title: "c1",
            index: 1,
            status: "downloading",
            lastUpdated: 1,
          },
        ],
      }),
      makeTask({ id: "queued-next", status: "queued", created: 2 }),
    ]

    const writeQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const writeSession = vi.fn(async (_values: Record<string, unknown>) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const ensureLivenessAlarm = vi.fn(async () => {})

    const result = await initializeFromStorage({
      readQueue: async () => queue,
      writeQueue,
      writeSession,
      applyQueue,
      getOffscreenContexts: async () => [{}],
      getOffscreenActiveTaskIds: async () => ["active-with-offscreen"],
      ensureLivenessAlarm,
    })

    expect(result.initFailed).toBe(false)
    expect(writeQueue).not.toHaveBeenCalled()
    expect(applyQueue).toHaveBeenCalledWith(queue)
    expect(result.queueActivation).toEqual({
      kind: "resume-task",
      taskId: "active-with-offscreen",
    })
    expect(ensureLivenessAlarm).toHaveBeenCalledTimes(1)
  })

  it("resumes a downloading task when the offscreen is alive but idle between chapters", async () => {
    const queue: DownloadTaskState[] = [
      makeTask({
        id: "zombie-idle-offscreen",
        status: "downloading",
        chapters: [
          {
            id: "c1",
            url: "c1",
            title: "c1",
            index: 1,
            status: "completed",
            lastUpdated: 1,
          },
          {
            id: "c2",
            url: "c2",
            title: "c2",
            index: 2,
            status: "queued",
            lastUpdated: 1,
          },
        ],
      }),
    ]

    const writeQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const writeSession = vi.fn(async (_values: Record<string, unknown>) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const ensureLivenessAlarm = vi.fn(async () => {})

    const result = await initializeFromStorage({
      readQueue: async () => queue,
      writeQueue,
      writeSession,
      applyQueue,
      getOffscreenContexts: async () => [{}],
      getOffscreenActiveTaskIds: async () => [],
      ensureLivenessAlarm,
    })

    expect(result.initFailed).toBe(false)
    expect(writeQueue).not.toHaveBeenCalled()
    expect(result.queue[0]?.status).toBe("downloading")
    expect(result.queue[0]?.chapters[1]?.status).toBe("queued")
    expect(result.queueActivation).toEqual({
      kind: "resume-task",
      taskId: "zombie-idle-offscreen",
    })
  })

  it("adds a completion timestamp to persisted terminal tasks that lack one", async () => {
    const queue = [
      makeTask({
        id: "legacy-complete",
        status: "completed",
        completed: undefined,
      }),
    ]
    const writeQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})

    const result = await initializeFromStorage({
      readQueue: async () => queue,
      writeQueue,
      writeSession: async () => undefined,
      applyQueue,
      getOffscreenContexts: async () => [],
      getOffscreenActiveTaskIds: async () => [],
      ensureLivenessAlarm: async () => undefined,
    })

    expect(result.queue[0]?.completed).toEqual(expect.any(Number))
    expect(writeQueue).toHaveBeenCalledWith(result.queue)
    expect(applyQueue).toHaveBeenCalledWith(result.queue)
  })

  it("applies the latest persisted queue when storage changes during startup recovery", async () => {
    const seededQueue: DownloadTaskState[] = [
      makeTask({
        id: "retried-canceled-options",
        status: "canceled",
        seriesTitle: "Retried Canceled Options",
        completed: 10,
        isRetried: true,
      }),
      makeTask({
        id: "retried-failed-options",
        status: "failed",
        seriesTitle: "Retried Failed Options",
        completed: 20,
        isRetried: true,
        errorMessage: "Network error",
      }),
    ]

    const readQueue = vi
      .fn<() => Promise<DownloadTaskState[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(seededQueue)

    const writeQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const writeSession = vi.fn(async (_values: Record<string, unknown>) => {})
    const applyQueue = vi.fn(async (_queue: DownloadTaskState[]) => {})
    const ensureLivenessAlarm = vi.fn(async () => {})

    const result = await initializeFromStorage({
      readQueue,
      writeQueue,
      writeSession,
      applyQueue,
      getOffscreenContexts: async () => [{}],
      getOffscreenActiveTaskIds: async () => [],
      ensureLivenessAlarm,
    })

    expect(result.initFailed).toBe(false)
    expect(readQueue).toHaveBeenCalledTimes(2)
    expect(result.queue).toEqual(seededQueue)
    expect(applyQueue).toHaveBeenCalledWith(seededQueue)
    expect(writeQueue).not.toHaveBeenCalled()
    expect(result.queueActivation).toBeUndefined()
  })

  it("fails closed when active offscreen task identities do not match persisted state", async () => {
    const queue = [
      makeTask({ id: "persisted-active", status: "downloading" }),
      makeTask({ id: "queued-next", status: "queued", created: 2 }),
    ]
    const result = await initializeFromStorage({
      readQueue: async () => queue,
      writeQueue: async () => undefined,
      writeSession: async () => undefined,
      applyQueue: async () => undefined,
      getOffscreenContexts: async () => [{}],
      getOffscreenActiveTaskIds: async () => ["different-active-task"],
      ensureLivenessAlarm: async () => undefined,
    })

    expect(result.initFailed).toBe(false)
    expect(result.queueActivation).toBeUndefined()
    expect(recoveryMocks.armRecoveredTaskContinuation).not.toHaveBeenCalled()
  })

  it("does not start queued work while an unmatched offscreen task is active", async () => {
    const result = await initializeFromStorage({
      readQueue: async () => [makeTask({ id: "queued", status: "queued" })],
      writeQueue: async () => undefined,
      writeSession: async () => undefined,
      applyQueue: async () => undefined,
      getOffscreenContexts: async () => [{}],
      getOffscreenActiveTaskIds: async () => ["orphan-offscreen-task"],
      ensureLivenessAlarm: async () => undefined,
    })

    expect(result.queueActivation).toBeUndefined()
  })

  it("keeps observing an identity-bound native output when no offscreen job remains", async () => {
    const task = makeTask({
      id: "native-pending",
      status: "downloading",
      browserDownloadWait: {
        downloadIds: [42],
        since: 1,
        lastObservedAt: 2,
      },
      chapters: [
        {
          id: "chapter-1",
          url: "https://example.test/chapter-1",
          title: "Chapter 1",
          index: 1,
          status: "downloading",
          dispatchAttempt: 1,
          outputs: { requested: 1, committed: 0, failed: 0 },
          lastUpdated: 1,
        },
      ],
    })
    const writeQueue = vi.fn(async () => undefined)
    const setLivenessAlarmArmed = vi.fn(async () => undefined)

    const result = await initializeFromStorage({
      readQueue: async () => [task],
      writeQueue,
      writeSession: async () => undefined,
      applyQueue: async () => undefined,
      getOffscreenContexts: async () => [],
      getOffscreenActiveTaskIds: async () => [],
      hasOffscreenDocument: async () => false,
      getOffscreenJobState: async () => null,
      getActiveDispatchLease: async () => ({
        jobId: "job-1",
        attempt: 1,
        taskId: task.id,
        chapterId: "chapter-1",
        stage: "saving",
        sequence: 5,
        startedAt: 1,
        lastActivityAt: 2,
        leaseExpiresAt: 3,
      }),
      hasReconcilablePendingOutputs: () => true,
      hasPendingOutputWork: () => true,
      setLivenessAlarmArmed,
      ensureLivenessAlarm: async () => undefined,
    })

    expect(result.queue[0]?.status).toBe("downloading")
    expect(result.queue[0]?.chapters[0]?.status).toBe("downloading")
    expect(result.queue[0]?.browserDownloadWait).toEqual({
      downloadIds: [42],
      since: 1,
      lastObservedAt: 2,
    })
    expect(result.queueActivation).toBeUndefined()
    expect(writeQueue).not.toHaveBeenCalled()
    expect(setLivenessAlarmArmed).toHaveBeenCalledWith(false)
  })

  it("releases a durably settled terminal job before resuming queue finalization", async () => {
    const task = makeTask({
      id: "settled-active",
      status: "downloading",
      chapters: [
        {
          id: "chapter-1",
          url: "https://example.test/chapter-1",
          title: "Chapter 1",
          index: 1,
          status: "completed",
          dispatchAttempt: 1,
          outputs: { requested: 1, committed: 1, failed: 0 },
          lastUpdated: 2,
        },
      ],
    })
    const lease = {
      jobId: "job-settled",
      attempt: 1,
      taskId: task.id,
      chapterId: "chapter-1",
      stage: "saving" as const,
      sequence: 8,
      startedAt: 1,
      lastActivityAt: 2,
      leaseExpiresAt: 3,
    }
    const releasePendingOutputJob = vi.fn(async () => undefined)
    const clearActiveDispatchLease = vi.fn(async () => true)

    const result = await initializeFromStorage({
      readQueue: async () => [task],
      writeQueue: async () => undefined,
      writeSession: async () => undefined,
      applyQueue: async () => undefined,
      getOffscreenContexts: async () => [{}],
      getOffscreenActiveTaskIds: async () => [],
      hasOffscreenDocument: async () => true,
      getOffscreenJobState: async () => ({
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        status: "terminal",
        stage: "saving",
        sequence: 8,
        outcome: { status: "completed", outputsRequested: 1 },
      }),
      getActiveDispatchLease: async () => lease,
      clearActiveDispatchLease,
      releasePendingOutputJob,
      ensureLivenessAlarm: async () => undefined,
    })

    expect(releasePendingOutputJob).toHaveBeenCalledWith("job-settled")
    expect(clearActiveDispatchLease).toHaveBeenCalledWith({
      jobId: "job-settled",
      attempt: 1,
    })
    expect(result.queueActivation).toEqual({
      kind: "resume-task",
      taskId: task.id,
    })
  })

  it("clears an orphan lease left after terminal task finalization", async () => {
    const terminalTask = makeTask({
      id: "terminal-task",
      status: "completed",
      completed: 10,
    })
    const queuedTask = makeTask({ id: "queued-next", created: 20 })
    const lease = {
      jobId: "job-finalized",
      attempt: 2,
      taskId: terminalTask.id,
      chapterId: "chapter-finalized",
      stage: "saving" as const,
      sequence: 9,
      startedAt: 1,
      lastActivityAt: 2,
      leaseExpiresAt: 3,
    }
    const releasePendingOutputJob = vi.fn(async () => undefined)
    const clearActiveDispatchLease = vi.fn(async () => true)

    const result = await initializeFromStorage({
      readQueue: async () => [terminalTask, queuedTask],
      writeQueue: async () => undefined,
      writeSession: async () => undefined,
      applyQueue: async () => undefined,
      getOffscreenContexts: async () => [],
      getOffscreenActiveTaskIds: async () => [],
      hasOffscreenDocument: async () => false,
      getOffscreenJobState: async () => null,
      getActiveDispatchLease: async () => lease,
      clearActiveDispatchLease,
      releasePendingOutputJob,
      ensureLivenessAlarm: async () => undefined,
    })

    expect(releasePendingOutputJob).toHaveBeenCalledWith(lease.jobId)
    expect(clearActiveDispatchLease).toHaveBeenCalledWith({
      jobId: lease.jobId,
      attempt: lease.attempt,
    })
    expect(result.queueActivation).toEqual({ kind: "process-queue" })
  })
})
