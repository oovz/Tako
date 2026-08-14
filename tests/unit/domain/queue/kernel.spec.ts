import { describe, expect, it } from "vitest"

import {
  beginChapterDispatch,
  blockTaskForDestination,
  blockTaskForNativeOutputAction,
  blockTaskForProviderPolicy,
  cancelDownloadTask,
  clearDispatchLease,
  clearTerminalHistory,
  enqueueDownloadTask,
  finalizeDownloadTask,
  finalizePendingUndoAction,
  interruptDownloadTask,
  moveQueuedTaskToTop,
  reconcileExpiredPendingUndoActions,
  recordTaskDispatchError,
  recoverQueueAfterStartup,
  releaseDestinationBlock,
  releaseProviderPolicyBlock,
  releaseProviderPolicyBlocks,
  removeTerminalDownloadTask,
  renewDispatchLease,
  restartDownloadTask,
  restorePendingUndoAction,
  resumeDestinationTask,
  retryFailedChapters,
  setNextChapterDispatchAt,
  settleTaskChapter,
  startDownloadTask,
  updateChapterProgress,
  type QueueKernelDecision,
  type StartupRecoveryInput,
} from "@/src/domain/queue/kernel"
import { createPendingUndoAction } from "@/src/domain/queue/pending-undo"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
  FullDispatchLeaseIdentity,
  PendingUndoAction,
  QueueAggregateKey,
  QueueAggregateState,
  TaskChapter,
} from "@/src/domain/queue/state"
import type { ChapterStatus } from "@/src/types/chapter"

function createChapter(
  id: string = "chapter-1",
  status: ChapterStatus = "queued",
  overrides: Partial<TaskChapter> = {}
): TaskChapter {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    index: 1,
    status,
    lastUpdated: 100,
    ...overrides,
  }
}

function createTask(
  id: string = "task-1",
  status: DownloadTaskState["status"] = "queued",
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  return {
    id,
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [createChapter()],
    status,
    created: 100,
    settingsSnapshot: {} as DownloadTaskState["settingsSnapshot"],
    ...overrides,
  }
}

function createLease(
  overrides: Partial<ActiveDispatchLease> = {}
): ActiveDispatchLease {
  return {
    jobId: "job-1",
    attempt: 2,
    taskId: "task-1",
    chapterId: "chapter-1",
    fingerprint: "a".repeat(64),
    documentInstanceId: "document-1",
    saveMode: "downloads-api",
    lastEventSignature: "event-4",
    stage: "downloading",
    startedAt: 100,
    lastActivityAt: 200,
    leaseExpiresAt: 45_200,
    sequence: 4,
    ...overrides,
  }
}

function createState(
  queue: DownloadTaskState[] = [],
  lease: ActiveDispatchLease | null = null,
  pendingUndoActions: PendingUndoAction[] = []
): QueueAggregateState {
  return { queue, lease, pendingUndoActions }
}

function leaseIdentity(lease: ActiveDispatchLease): FullDispatchLeaseIdentity {
  return {
    jobId: lease.jobId,
    attempt: lease.attempt,
    taskId: lease.taskId,
    chapterId: lease.chapterId,
    fingerprint: lease.fingerprint,
    documentInstanceId: lease.documentInstanceId!,
  }
}

function createStartupRecoveryInput(
  overrides: Partial<StartupRecoveryInput> = {}
): StartupRecoveryInput {
  return {
    normalizationTime: 500,
    interruptedAt: 600,
    observedLease: null,
    offscreenJob: null,
    nativeOutputTaskIds: [],
    ...overrides,
  }
}

function expectNoChange(
  decision: QueueKernelDecision<{ outcome: string }>,
  state: QueueAggregateState,
  outcome: "unchanged" | "rejected"
): void {
  expect(decision.result.outcome).toBe(outcome)
  expect(decision.next).toBe(state)
  expect(decision.changedKeys).toEqual([])
}

function expectRejectedReason(
  decision: QueueKernelDecision<{ outcome: string; reason?: string }>,
  state: QueueAggregateState,
  reason: string
): void {
  expectNoChange(decision, state, "rejected")
  expect(decision.result.reason).toBe(reason)
}

function expectApplied(
  decision: QueueKernelDecision<{ outcome: string }>,
  state: QueueAggregateState,
  before: QueueAggregateState,
  changedKeys: readonly QueueAggregateKey[]
): void {
  expect(decision.result.outcome).toBe("applied")
  expect(decision.next).not.toBe(state)
  expect(decision.changedKeys).toEqual(changedKeys)
  expect(state).toEqual(before)
  for (const key of ["queue", "lease", "pendingUndoActions"] as const) {
    if (!changedKeys.includes(key)) {
      expect(decision.next[key]).toBe(state[key])
    }
  }
}

function createUndoAction(
  input: {
    token?: string
    type?: PendingUndoAction["type"]
    task?: DownloadTaskState
    position?: number
    now?: number
  } = {}
): PendingUndoAction {
  return createPendingUndoAction({
    token: input.token ?? "undo-1",
    type: input.type ?? "cancel_queued",
    taskSnapshot: input.task ?? createTask(),
    previousQueuePosition: input.position ?? 0,
    now: input.now ?? 100,
  })
}

describe("queue aggregate kernel", () => {
  describe("enqueue and startup recovery", () => {
    it("enqueues a detached task and rejects an identity conflict", () => {
      const task = createTask()
      const state = createState()
      const before = structuredClone(state)

      const applied = enqueueDownloadTask(state, { task })

      expectApplied(applied, state, before, ["queue"])
      expect(applied.next.queue).toEqual([task])
      expect(applied.next.queue[0]).not.toBe(task)

      const conflict = enqueueDownloadTask(applied.next, { task })
      expectNoChange(conflict, applied.next, "rejected")
      expect(conflict.result).toEqual({
        outcome: "rejected",
        reason: "task-id-conflict",
      })
    })

    it("keeps one exact active offscreen job unchanged and resumable", () => {
      const lease = createLease()
      const task = createTask("task-1", "downloading", {
        chapters: [
          createChapter("chapter-1", "downloading", { dispatchAttempt: 2 }),
        ],
      })
      const state = createState([task], lease)

      const decision = recoverQueueAfterStartup(
        state,
        createStartupRecoveryInput({
          observedLease: leaseIdentity(lease),
          offscreenJob: {
            ...leaseIdentity(lease),
            status: "active",
          },
        })
      )

      expectNoChange(decision, state, "unchanged")
      expect(decision.result).toEqual({
        outcome: "unchanged",
        queue: [task],
        recoveredTaskIds: [],
        interruptedTaskIds: [],
        leaseCleared: false,
        resumeTaskId: "task-1",
      })
    })

    it("keeps an exact terminal offscreen job resumable", () => {
      const lease = createLease()
      const task = createTask("task-1", "downloading", {
        chapters: [createChapter("chapter-1", "completed")],
      })
      const state = createState([task], lease)
      const facts = createStartupRecoveryInput({
        observedLease: leaseIdentity(lease),
        offscreenJob: {
          ...leaseIdentity(lease),
          status: "terminal",
        },
      })

      const decision = recoverQueueAfterStartup(state, facts)

      expectNoChange(decision, state, "unchanged")
      expect(decision.result).toEqual({
        outcome: "unchanged",
        queue: [task],
        recoveredTaskIds: [],
        interruptedTaskIds: [],
        leaseCleared: false,
        resumeTaskId: "task-1",
      })
    })

    it("materializes a canceled exact job as interrupted while clearing its lease", () => {
      const lease = createLease()
      const task = createTask("task-1", "downloading", {
        chapters: [
          createChapter("chapter-1", "downloading", {
            dispatchAttempt: 2,
          }),
          createChapter("chapter-2", "queued"),
        ],
      })
      const state = createState([task], lease)
      const facts = createStartupRecoveryInput({
        observedLease: leaseIdentity(lease),
        offscreenJob: {
          ...leaseIdentity(lease),
          status: "canceled",
        },
      })

      const before = structuredClone(state)
      const applied = recoverQueueAfterStartup(state, facts)

      expectApplied(applied, state, before, ["queue", "lease"])
      expect(applied.next.queue[0]).toMatchObject({
        status: "failed",
        errorMessage: "Download interrupted",
        completed: 600,
      })
      expect(applied.next.queue[0]?.chapters).toMatchObject([
        {
          status: "failed",
          errorMessage: "Download interrupted",
          lastUpdated: 600,
        },
        {
          status: "failed",
          errorMessage: "Download interrupted",
          lastUpdated: 600,
        },
      ])
      expect(applied.result).toMatchObject({
        recoveredTaskIds: ["task-1"],
        interruptedTaskIds: ["task-1"],
        leaseCleared: true,
      })
    })

    it("interrupts an unbound dispatch and clears its exact lease", () => {
      const lease = createLease({ documentInstanceId: undefined })
      const task = createTask("task-1", "downloading", {
        chapters: [
          createChapter("chapter-1", "downloading", {
            dispatchAttempt: lease.attempt,
          }),
        ],
      })
      const state = createState([task], lease)
      const before = structuredClone(state)

      const decision = recoverQueueAfterStartup(
        state,
        createStartupRecoveryInput({
          observedLease: {
            jobId: lease.jobId,
            attempt: lease.attempt,
            taskId: lease.taskId,
            chapterId: lease.chapterId,
            fingerprint: lease.fingerprint,
          },
        })
      )

      expectApplied(decision, state, before, ["queue", "lease"])
      expect(decision.next.lease).toBeNull()
      expect(decision.next.queue[0]).toMatchObject({
        status: "failed",
        errorMessage: "Download interrupted",
        completed: 600,
      })
      expect(decision.result).toMatchObject({
        recoveredTaskIds: ["task-1"],
        interruptedTaskIds: ["task-1"],
        leaseCleared: true,
      })
    })

    it("normalizes persisted execution state and completion timestamps in the kernel", () => {
      const blocked = createTask("blocked", "downloading", {
        activeBlock: "destination_action_required",
      })
      const missingCompletion = createTask("missing-completion", "completed", {
        completed: undefined,
        activeBlock: "destination_action_required",
      })
      const existingCompletion = createTask("existing-completion", "failed", {
        completed: 321,
      })
      const state = createState([
        blocked,
        missingCompletion,
        existingCompletion,
      ])
      const before = structuredClone(state)

      const decision = recoverQueueAfterStartup(
        state,
        createStartupRecoveryInput({ normalizationTime: 777 })
      )

      expectApplied(decision, state, before, ["queue"])
      expect(decision.next.queue).toMatchObject([
        {
          id: "blocked",
          status: "queued",
          activeBlock: "destination_action_required",
        },
        {
          id: "missing-completion",
          status: "completed",
          completed: 777,
          activeBlock: undefined,
        },
        {
          id: "existing-completion",
          status: "failed",
          completed: 321,
        },
      ])
      expect(decision.result).toMatchObject({
        recoveredTaskIds: ["blocked", "missing-completion"],
        interruptedTaskIds: [],
        leaseCleared: false,
      })
    })

    it("preserves a native-output task while clearing its obsolete dispatch lease", () => {
      const lease = createLease({ jobId: "unobserved-job" })
      const task = createTask("task-1", "downloading", {
        chapters: [
          createChapter("chapter-1", "downloading", { dispatchAttempt: 2 }),
        ],
      })
      const state = createState([task], lease)

      const decision = recoverQueueAfterStartup(
        state,
        createStartupRecoveryInput({
          observedLease: leaseIdentity(lease),
          nativeOutputTaskIds: [task.id],
        })
      )

      expect(decision.result.outcome).toBe("applied")
      expect(decision.next.lease).toBeNull()
      expect(decision.result).toMatchObject({
        recoveredTaskIds: [],
        interruptedTaskIds: [],
        leaseCleared: true,
        resumeTaskId: undefined,
      })
    })

    it("rejects stale lease facts", () => {
      const lease = createLease()
      const task = createTask("task-1", "downloading", {
        chapters: [createChapter("chapter-1", "downloading")],
      })
      const state = createState([task], lease)
      const staleObservation = recoverQueueAfterStartup(
        state,
        createStartupRecoveryInput({
          observedLease: leaseIdentity(createLease({ jobId: "stale" })),
        })
      )
      expectRejectedReason(staleObservation, state, "lease-conflict")

      const changedLeaseState = createState(
        [task],
        createLease({ jobId: "replacement-job" })
      )
      const changedBetweenPhases = recoverQueueAfterStartup(
        changedLeaseState,
        createStartupRecoveryInput({ observedLease: leaseIdentity(lease) })
      )
      expectRejectedReason(
        changedBetweenPhases,
        changedLeaseState,
        "lease-conflict"
      )
    })

    it("reports a fully current queue without a lease unchanged", () => {
      const state = createState([createTask()])

      const decision = recoverQueueAfterStartup(
        state,
        createStartupRecoveryInput()
      )

      expectNoChange(decision, state, "unchanged")
      expect(decision.result).toEqual({
        outcome: "unchanged",
        queue: state.queue,
        recoveredTaskIds: [],
        interruptedTaskIds: [],
        leaseCleared: false,
        resumeTaskId: undefined,
      })
    })
  })

  describe("task and chapter execution lifecycle", () => {
    it("starts one runnable task and rejects missing, blocked, or concurrent starts", () => {
      const task = createTask()
      const state = createState([task])
      const before = structuredClone(state)
      const started = startDownloadTask(state, {
        taskId: task.id,
        now: 500,
      })

      expectApplied(started, state, before, ["queue"])
      expect(started.next.queue[0]).toMatchObject({
        status: "downloading",
        started: 500,
      })

      const missing = startDownloadTask(state, {
        taskId: "missing",
        now: 500,
      })
      expectNoChange(missing, state, "rejected")
      const blockedState = createState([
        createTask("blocked", "queued", {
          activeBlock: "destination_action_required",
        }),
      ])
      expectNoChange(
        startDownloadTask(blockedState, {
          taskId: "blocked",
          now: 500,
        }),
        blockedState,
        "rejected"
      )
      const concurrent = createState(
        [createTask("active", "downloading"), createTask("queued")],
        createLease({ taskId: "active" })
      )
      const rejected = startDownloadTask(concurrent, {
        taskId: "queued",
        now: 500,
      })
      expectNoChange(rejected, concurrent, "rejected")
      expect(rejected.result).toMatchObject({ reason: "active-task-exists" })

      const nativeOwned = createState([
        createTask("native-output", "downloading"),
        createTask("next"),
      ])
      const nativeBlocked = startDownloadTask(nativeOwned, {
        taskId: "next",
        now: 600,
      })
      expectNoChange(nativeBlocked, nativeOwned, "rejected")
      expect(nativeBlocked.result).toMatchObject({
        reason: "active-task-exists",
      })
    })

    it("begins dispatch with one atomic queue-and-lease decision", () => {
      const task = createTask("task-1", "downloading", {
        chapters: [
          createChapter("chapter-1", "queued", {
            errorMessage: "old",
            errorCategory: "network_unavailable",
            outputs: { requested: 3, committed: 1, failed: 2 },
          }),
        ],
      })
      const state = createState([task])
      const before = structuredClone(state)
      const lease = createLease({ stage: "dispatching", sequence: 0 })

      const decision = beginChapterDispatch(state, {
        taskId: task.id,
        chapterId: "chapter-1",
        lease,
        expectedPreviousLease: null,
        now: 500,
      })

      expectApplied(decision, state, before, ["queue", "lease"])
      expect(decision.next.queue[0]?.chapters[0]).toMatchObject({
        status: "downloading",
        dispatchAttempt: 2,
        outputs: { requested: 0, committed: 0, failed: 0 },
        errorMessage: undefined,
        errorCategory: "network_unavailable",
        lastUpdated: 500,
      })
      expect(decision.next.lease).toEqual(lease)
      expect(decision.next.lease).not.toBe(lease)
    })

    it("rejects dispatch task, chapter, terminal, and exact lease mismatches", () => {
      const active = createTask("task-1", "downloading")
      const state = createState([active], createLease())
      const cases = [
        beginChapterDispatch(state, {
          taskId: "missing",
          chapterId: "chapter-1",
          lease: createLease(),
          expectedPreviousLease: state.lease,
          now: 500,
        }),
        beginChapterDispatch(createState([createTask("task-1", "completed")]), {
          taskId: "task-1",
          chapterId: "chapter-1",
          lease: createLease(),
          expectedPreviousLease: null,
          now: 500,
        }),
        beginChapterDispatch(state, {
          taskId: "task-1",
          chapterId: "missing",
          lease: createLease(),
          expectedPreviousLease: state.lease,
          now: 500,
        }),
        beginChapterDispatch(
          createState([
            createTask("task-1", "downloading", {
              chapters: [createChapter("chapter-1", "completed")],
            }),
          ]),
          {
            taskId: "task-1",
            chapterId: "chapter-1",
            lease: createLease(),
            expectedPreviousLease: null,
            now: 500,
          }
        ),
        beginChapterDispatch(state, {
          taskId: "task-1",
          chapterId: "chapter-1",
          lease: createLease({ jobId: "next" }),
          expectedPreviousLease: createLease({ jobId: "stale" }),
          now: 500,
        }),
        beginChapterDispatch(state, {
          taskId: "task-1",
          chapterId: "chapter-1",
          lease: createLease({ chapterId: "other" }),
          expectedPreviousLease: state.lease,
          now: 500,
        }),
      ]
      for (const decision of cases) {
        expect(decision.changedKeys).toEqual([])
        expect(decision.result.outcome).toBe("rejected")
      }
      expect(cases.map((decision) => decision.result)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: "task-not-found" }),
          expect.objectContaining({ reason: "task-not-active" }),
          expect.objectContaining({ reason: "chapter-not-found" }),
          expect.objectContaining({ reason: "chapter-not-dispatchable" }),
          expect.objectContaining({ reason: "lease-conflict" }),
        ])
      )
    })

    it("updates active chapter progress and keeps terminal chapters monotonic", () => {
      const task = createTask("task-1", "downloading", {
        chapters: [createChapter("chapter-1", "downloading")],
      })
      const lease = createLease()
      const state = createState([task], lease)
      const before = structuredClone(state)
      const applied = updateChapterProgress(state, {
        taskId: "task-1",
        chapterId: "chapter-1",
        lease,
        now: 500,
        updates: { totalImages: 20, imagesFailed: 1 },
      })
      expectApplied(applied, state, before, ["queue"])
      expect(applied.next.queue[0]?.chapters[0]).toMatchObject({
        status: "downloading",
        totalImages: 20,
        imagesFailed: 1,
        lastUpdated: 500,
      })

      expectRejectedReason(
        updateChapterProgress(state, {
          taskId: "task-1",
          chapterId: "chapter-1",
          lease: createLease({ jobId: "stale" }),
          now: 500,
        }),
        state,
        "lease-conflict"
      )

      const terminalState = createState(
        [
          createTask("task-1", "downloading", {
            chapters: [createChapter("chapter-1", "completed")],
          }),
        ],
        lease
      )
      expectNoChange(
        updateChapterProgress(terminalState, {
          taskId: "task-1",
          chapterId: "chapter-1",
          lease,
          now: 500,
        }),
        terminalState,
        "unchanged"
      )
      const missingState = createState()
      expectNoChange(
        updateChapterProgress(missingState, {
          taskId: "missing",
          chapterId: "chapter-1",
          lease: createLease(),
          now: 500,
        }),
        missingState,
        "rejected"
      )
    })
  })
})

describe("queue aggregate kernel chapter, lease, and scheduling operations", () => {
  it("settles chapters with monotonic accounting and explicit no-change/rejection", () => {
    const task = createTask("task-1", "downloading", {
      chapters: [
        createChapter("chapter-1", "downloading", {
          outputs: { requested: 3, committed: 2, failed: 0 },
        }),
      ],
    })
    const lease = createLease()
    const state = createState([task], lease)
    const before = structuredClone(state)
    const settled = settleTaskChapter(state, {
      taskId: "task-1",
      chapterId: "chapter-1",
      status: "partial_success",
      lease,
      now: 500,
      updates: {
        outputs: { requested: 2, committed: 1, failed: 1 },
        errorMessage: "one failed",
        errorCategory: "browser_download_interrupted",
      },
    })

    expectApplied(settled, state, before, ["queue"])
    expect(settled.next.queue[0]?.chapters[0]).toMatchObject({
      status: "partial_success",
      outputs: { requested: 3, committed: 2, failed: 1 },
      errorMessage: "one failed",
      lastUpdated: 500,
    })

    const terminalState = settled.next
    const regressed = settleTaskChapter(terminalState, {
      taskId: "task-1",
      chapterId: "chapter-1",
      status: "failed",
      lease,
      now: 600,
    })
    expectNoChange(regressed, terminalState, "unchanged")
    expect(regressed.result).toMatchObject({ reason: "terminal-chapter" })

    const currentChapter = terminalState.queue[0]?.chapters[0]
    const alreadyCurrent = settleTaskChapter(terminalState, {
      taskId: "task-1",
      chapterId: "chapter-1",
      status: "partial_success",
      lease,
      now: currentChapter?.lastUpdated ?? 0,
      updates: {
        outputs: currentChapter?.outputs,
        errorMessage: currentChapter?.errorMessage,
        errorCategory: currentChapter?.errorCategory,
      },
    })
    expectNoChange(alreadyCurrent, terminalState, "unchanged")
    expect(alreadyCurrent.result).toMatchObject({ reason: "already-current" })

    expectRejectedReason(
      settleTaskChapter(state, {
        taskId: "task-1",
        chapterId: "chapter-1",
        status: "failed",
        lease: createLease({ attempt: 3 }),
        now: 500,
      }),
      state,
      "lease-conflict"
    )
    expectRejectedReason(
      settleTaskChapter(state, {
        taskId: "task-1",
        chapterId: "chapter-1",
        status: "failed",
        now: 500,
      }),
      state,
      "lease-conflict"
    )

    const beforeDispatch = createState([
      createTask("task-1", "downloading", {
        chapters: [createChapter("chapter-1", "queued")],
      }),
    ])
    const predispatchFailure = settleTaskChapter(beforeDispatch, {
      taskId: "task-1",
      chapterId: "chapter-1",
      status: "failed",
      now: 500,
      updates: { errorMessage: "Plan resolution failed" },
    })
    expect(predispatchFailure.changedKeys).toEqual(["queue"])

    const inactive = createState([createTask("task-1", "failed")])
    expectNoChange(
      settleTaskChapter(inactive, {
        taskId: "task-1",
        chapterId: "chapter-1",
        status: "failed",
        now: 500,
      }),
      inactive,
      "rejected"
    )
  })

  it("records task dispatch errors without allowing terminal mutation", () => {
    const state = createState([createTask("task-1", "downloading")])
    const before = structuredClone(state)
    const applied = recordTaskDispatchError(state, {
      taskId: "task-1",
      errorMessage: "dispatch failed",
      errorCategory: "unknown",
    })
    expectApplied(applied, state, before, ["queue"])
    expect(applied.next.queue[0]).toMatchObject({
      errorMessage: "dispatch failed",
      errorCategory: "unknown",
    })

    expectNoChange(
      recordTaskDispatchError(applied.next, {
        taskId: "task-1",
        errorMessage: "dispatch failed",
        errorCategory: "unknown",
      }),
      applied.next,
      "unchanged"
    )
    const terminal = createState([createTask("task-1", "completed")])
    expectNoChange(
      recordTaskDispatchError(terminal, {
        taskId: "task-1",
        errorMessage: "late",
      }),
      terminal,
      "rejected"
    )
  })

  it("renews leases with exact identity and monotonic sequence and stage", () => {
    const lease = createLease()
    const state = createState([], lease)
    const before = structuredClone(state)
    const applied = renewDispatchLease(state, {
      ...lease,
      documentInstanceId: lease.documentInstanceId!,
      eventSignature: "event-5",
      stage: "archiving",
      sequence: 5,
      activityAt: 1_000,
    })

    expectApplied(applied, state, before, ["lease"])
    expect(applied.next.lease).toMatchObject({
      stage: "archiving",
      sequence: 5,
      lastActivityAt: 1_000,
      leaseExpiresAt: 46_000,
    })

    const same = renewDispatchLease(state, {
      ...lease,
      documentInstanceId: lease.documentInstanceId!,
      eventSignature: "event-4",
      activityAt: 999,
    })
    expectNoChange(same, state, "unchanged")

    const rejectedCases = [
      renewDispatchLease(state, {
        ...lease,
        documentInstanceId: lease.documentInstanceId!,
        eventSignature: "event-5",
        jobId: "stale",
        sequence: 5,
        activityAt: 1_000,
      }),
      renewDispatchLease(state, {
        ...lease,
        documentInstanceId: lease.documentInstanceId!,
        eventSignature: "event-3",
        sequence: 3,
        activityAt: 1_000,
      }),
      renewDispatchLease(state, {
        ...lease,
        documentInstanceId: lease.documentInstanceId!,
        eventSignature: "event-5",
        stage: "accepted",
        sequence: 5,
        activityAt: 1_000,
      }),
      renewDispatchLease(state, {
        ...lease,
        documentInstanceId: lease.documentInstanceId!,
        eventSignature: "event-4",
        activityAt: Number.NaN,
      }),
      renewDispatchLease(state, {
        ...lease,
        documentInstanceId: lease.documentInstanceId!,
        eventSignature: "event-4",
        requireSequenceAdvance: true,
        activityAt: 1_000,
      }),
    ]
    for (const decision of rejectedCases) {
      expectNoChange(decision, state, "rejected")
    }
    expect(rejectedCases.map((decision) => decision.result)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "lease-not-current" }),
        expect.objectContaining({ reason: "stale-sequence" }),
        expect.objectContaining({ reason: "stage-regression" }),
        expect.objectContaining({ reason: "invalid-activity-time" }),
      ])
    )
  })

  it("clears only an exact dispatch lease identity", () => {
    const lease = createLease()
    const state = createState([], lease)
    const before = structuredClone(state)
    const cleared = clearDispatchLease(state, { identity: lease })
    expectApplied(cleared, state, before, ["lease"])
    expect(cleared.next.lease).toBeNull()

    for (const identity of [
      createLease({ jobId: "other" }),
      createLease({ attempt: 3 }),
      createLease({ taskId: "other" }),
      createLease({ chapterId: "other" }),
      createLease({ fingerprint: "b".repeat(64) }),
      createLease({ documentInstanceId: "document-2" }),
    ]) {
      expectNoChange(clearDispatchLease(state, { identity }), state, "rejected")
    }
    const empty = createState()
    expectNoChange(
      clearDispatchLease(empty, { identity: lease }),
      empty,
      "rejected"
    )
  })

  it("sets and clears the next chapter dispatch boundary", () => {
    const state = createState([createTask("task-1", "downloading")])
    const before = structuredClone(state)
    const set = setNextChapterDispatchAt(state, {
      taskId: "task-1",
      nextChapterDispatchAt: 900,
    })
    expectApplied(set, state, before, ["queue"])
    expect(set.next.queue[0]?.nextChapterDispatchAt).toBe(900)

    expectNoChange(
      setNextChapterDispatchAt(set.next, {
        taskId: "task-1",
        nextChapterDispatchAt: 900,
      }),
      set.next,
      "unchanged"
    )
    const cleared = setNextChapterDispatchAt(set.next, {
      taskId: "task-1",
      nextChapterDispatchAt: undefined,
    })
    expect(cleared.changedKeys).toEqual(["queue"])

    const terminal = createState([createTask("task-1", "completed")])
    expectNoChange(
      setNextChapterDispatchAt(terminal, {
        taskId: "task-1",
        nextChapterDispatchAt: 900,
      }),
      terminal,
      "rejected"
    )
  })
})

describe("queue aggregate kernel output accounting and block operations", () => {
  it("blocks a task for a destination issue with an optional chapter reset", () => {
    const task = createTask("task-1", "downloading", {
      chapters: [createChapter("chapter-1", "downloading")],
    })
    const lease = createLease()
    const state = createState([task], lease)
    const before = structuredClone(state)
    const blocked = blockTaskForDestination(state, {
      taskId: "task-1",
      now: 500,
      errorMessage: "Folder missing",
      errorCategory: "folder_unavailable",
      chapter: {
        chapterId: "chapter-1",
        lease,
        imagesFailed: 2,
        outputs: { requested: 3, committed: 1, failed: 2 },
      },
    })

    expectApplied(blocked, state, before, ["queue"])
    expect(blocked.next.queue[0]).toMatchObject({
      status: "queued",
      activeBlock: "destination_action_required",
      errorMessage: "Folder missing",
      chapters: [
        expect.objectContaining({
          status: "queued",
          imagesFailed: 2,
          outputs: { requested: 3, committed: 1, failed: 2 },
          lastUpdated: 500,
        }),
      ],
    })

    expectRejectedReason(
      blockTaskForDestination(state, {
        taskId: "task-1",
        now: 500,
        chapter: {
          chapterId: "chapter-1",
          lease: createLease({ jobId: "stale" }),
        },
      }),
      state,
      "lease-conflict"
    )

    const alreadyBlocked = createState([
      createTask("task-1", "queued", {
        activeBlock: "destination_action_required",
      }),
    ])
    expectNoChange(
      blockTaskForDestination(alreadyBlocked, {
        taskId: "task-1",
        now: 500,
      }),
      alreadyBlocked,
      "unchanged"
    )

    const terminalChapter = createState(
      [
        createTask("task-1", "downloading", {
          chapters: [createChapter("chapter-1", "completed")],
        }),
      ],
      lease
    )
    expectNoChange(
      blockTaskForDestination(terminalChapter, {
        taskId: "task-1",
        now: 500,
        chapter: { chapterId: "chapter-1", lease },
      }),
      terminalChapter,
      "rejected"
    )
    const terminalTask = createState([createTask("task-1", "failed")])
    expectNoChange(
      blockTaskForDestination(terminalTask, {
        taskId: "task-1",
        now: 500,
      }),
      terminalTask,
      "rejected"
    )
  })

  it("releases and resumes destination blocks with distinct semantics", () => {
    const blockedTask = createTask("task-1", "queued", {
      activeBlock: "destination_action_required",
      errorMessage: "permission",
      errorCategory: "folder_permission_required",
      chapters: [
        createChapter("chapter-1", "downloading", {
          errorMessage: "permission",
        }),
        createChapter("chapter-2", "completed"),
      ],
    })
    const state = createState([blockedTask])
    const released = releaseDestinationBlock(state, { taskId: "task-1" })
    expect(released.changedKeys).toEqual(["queue"])
    expect(released.next.queue[0]).toMatchObject({
      activeBlock: undefined,
      errorMessage: "permission",
    })
    expect(released.next.queue[0]?.chapters[0]?.status).toBe("downloading")

    const resumed = resumeDestinationTask(state, {
      taskId: "task-1",
      commandId: "command-destination",
      destinationOverride: "downloads-api",
      now: 500,
    })
    expect(resumed.changedKeys).toEqual(["queue"])
    expect(resumed.next.queue[0]).toMatchObject({
      status: "queued",
      activeBlock: undefined,
      destinationOverride: "downloads-api",
      errorMessage: undefined,
      errorCategory: undefined,
    })
    expect(resumed.next.queue[0]?.chapters).toEqual([
      expect.objectContaining({
        id: "chapter-1",
        status: "queued",
        errorMessage: undefined,
        lastUpdated: 500,
      }),
      expect.objectContaining({ id: "chapter-2", status: "completed" }),
    ])

    const destinationReplay = resumeDestinationTask(resumed.next, {
      taskId: "task-1",
      commandId: "command-destination",
      destinationOverride: "downloads-api",
      now: 900,
    })
    expectNoChange(destinationReplay, resumed.next, "unchanged")
    expect(destinationReplay.result).toMatchObject({
      reason: "already-resumed",
      task: resumed.next.queue[0],
    })

    const reblocked = blockTaskForDestination(resumed.next, {
      taskId: "task-1",
      errorMessage: "new permission issue",
      now: 950,
    })
    expect(reblocked.next.queue[0]).toMatchObject({
      activeBlock: "destination_action_required",
      destinationBlockRevision: 1,
    })
    const delayedReplay = resumeDestinationTask(reblocked.next, {
      taskId: "task-1",
      commandId: "command-destination",
      destinationOverride: "downloads-api",
      now: 1_000,
    })
    expectNoChange(delayedReplay, reblocked.next, "unchanged")
    expect(delayedReplay.result).toMatchObject({
      reason: "superseded",
      task: reblocked.next.queue[0],
    })
    expect(delayedReplay.next.queue[0]?.activeBlock).toBe(
      "destination_action_required"
    )

    const terminalReplay = resumeDestinationTask(
      {
        ...resumed.next,
        queue: [
          {
            ...resumed.next.queue[0]!,
            status: "completed",
          },
        ],
      },
      {
        taskId: "task-1",
        commandId: "command-destination",
        destinationOverride: "downloads-api",
        now: 1_000,
      }
    )
    expectNoChange(terminalReplay, terminalReplay.next, "unchanged")

    const differentCommand = resumeDestinationTask(
      {
        ...resumed.next,
        queue: [
          {
            ...resumed.next.queue[0]!,
            status: "queued",
          },
        ],
      },
      {
        taskId: "task-1",
        commandId: "other-command",
        destinationOverride: "downloads-api",
        now: 1_000,
      }
    )
    expectNoChange(differentCommand, differentCommand.next, "unchanged")
    expect(differentCommand.result).toMatchObject({ reason: "not-blocked" })

    const unblocked = createState([createTask()])
    expectNoChange(
      releaseDestinationBlock(unblocked, { taskId: "task-1" }),
      unblocked,
      "unchanged"
    )
    expectNoChange(
      resumeDestinationTask(unblocked, {
        taskId: "task-1",
        commandId: "command-destination",
        destinationOverride: undefined,
        now: 500,
      }),
      unblocked,
      "unchanged"
    )
    const missing = createState()
    expectNoChange(
      resumeDestinationTask(missing, {
        taskId: "missing",
        commandId: "command-destination",
        destinationOverride: undefined,
        now: 500,
      }),
      missing,
      "rejected"
    )
  })

  it("blocks and releases provider policy waits without touching other blocks", () => {
    const state = createState([createTask("task-1", "downloading")])
    const before = structuredClone(state)
    const blocked = blockTaskForProviderPolicy(state, {
      taskId: "task-1",
      block: "provider_network_policy_pending",
    })
    expectApplied(blocked, state, before, ["queue"])
    expect(blocked.next.queue[0]).toMatchObject({
      status: "queued",
      activeBlock: "provider_network_policy_pending",
    })
    expectNoChange(
      blockTaskForProviderPolicy(blocked.next, {
        taskId: "task-1",
        block: "provider_network_policy_pending",
      }),
      blocked.next,
      "unchanged"
    )

    const actionRequired = createState([
      createTask("task-1", "queued", {
        activeBlock: "provider_network_policy_action_required",
      }),
    ])
    const releasedOne = releaseProviderPolicyBlock(actionRequired, {
      taskId: "task-1",
    })
    expect(releasedOne.changedKeys).toEqual(["queue"])
    expect(releasedOne.next.queue[0]?.activeBlock).toBeUndefined()

    const notProviderBlocked = createState([
      createTask("task-1", "queued", {
        activeBlock: "destination_action_required",
      }),
    ])
    expectNoChange(
      releaseProviderPolicyBlock(notProviderBlocked, { taskId: "task-1" }),
      notProviderBlocked,
      "unchanged"
    )

    const terminal = createState([createTask("task-1", "failed")])
    expectNoChange(
      blockTaskForProviderPolicy(terminal, {
        taskId: "task-1",
        block: "provider_network_policy_action_required",
      }),
      terminal,
      "rejected"
    )
    expectNoChange(
      releaseProviderPolicyBlock(terminal, { taskId: "task-1" }),
      terminal,
      "rejected"
    )

    const mixed = createState([
      blocked.next.queue[0]!,
      createTask("task-2", "queued", {
        activeBlock: "destination_action_required",
      }),
      createTask("task-3", "queued", {
        activeBlock: "provider_network_policy_action_required",
      }),
    ])
    const released = releaseProviderPolicyBlocks(mixed)
    expect(released.changedKeys).toEqual(["queue"])
    expect(released.result).toEqual({
      outcome: "applied",
      releasedTaskIds: ["task-1"],
    })
    expect(released.next.queue.map((task) => task.activeBlock)).toEqual([
      undefined,
      "destination_action_required",
      "provider_network_policy_action_required",
    ])

    const none = createState([createTask()])
    expectNoChange(releaseProviderPolicyBlocks(none), none, "unchanged")
  })
})

describe("queue aggregate kernel interruption, finalization, and history", () => {
  it("interrupts active work and atomically clears only an exact requested lease", () => {
    const lease = createLease()
    const task = createTask("task-1", "downloading", {
      activeBlock: "provider_network_policy_pending",
      chapters: [
        createChapter("chapter-1", "downloading", {
          outputs: { requested: 2, committed: 1, failed: 0 },
        }),
        createChapter("chapter-2", "queued"),
      ],
    })
    const state = createState([task], lease)
    const before = structuredClone(state)
    const interrupted = interruptDownloadTask(state, {
      taskId: "task-1",
      errorMessage: "Worker stopped",
      now: 500,
      clearLease: lease,
    })

    expectApplied(interrupted, state, before, ["queue", "lease"])
    expect(interrupted.next.lease).toBeNull()
    expect(interrupted.next.queue[0]).toMatchObject({
      status: "partial_success",
      activeBlock: undefined,
      errorMessage: "Worker stopped",
      completed: 500,
      chapters: [
        expect.objectContaining({
          status: "partial_success",
          outputs: { requested: 2, committed: 1, failed: 1 },
        }),
        expect.objectContaining({ status: "failed" }),
      ],
    })

    const noLeaseClearState = createState(
      [createTask("task-1", "queued")],
      lease
    )
    const withoutClear = interruptDownloadTask(noLeaseClearState, {
      taskId: "task-1",
      errorMessage: "Disabled",
      now: 600,
    })
    expect(withoutClear.changedKeys).toEqual(["queue"])
    expect(withoutClear.next.lease).toBe(lease)

    const conflict = interruptDownloadTask(state, {
      taskId: "task-1",
      errorMessage: "Worker stopped",
      now: 500,
      clearLease: createLease({ attempt: 3 }),
    })
    expectNoChange(conflict, state, "rejected")
    expect(conflict.result).toMatchObject({ reason: "lease-conflict" })
    const terminal = createState([createTask("task-1", "completed")])
    expectNoChange(
      interruptDownloadTask(terminal, {
        taskId: "task-1",
        errorMessage: "late",
        now: 500,
      }),
      terminal,
      "rejected"
    )
  })

  it("finalizes from materialized chapter outcomes and preserves lease fencing", () => {
    const lease = createLease()
    const task = createTask("task-1", "downloading", {
      activeBlock: "destination_action_required",
      nextChapterDispatchAt: 450,
      chapters: [
        createChapter("chapter-1", "completed"),
        createChapter("chapter-2", "failed", {
          errorCategory: "network_unavailable",
        }),
      ],
    })
    const state = createState([task], lease)
    const before = structuredClone(state)
    const finalized = finalizeDownloadTask(state, {
      taskId: "task-1",
      chapterOutcomesByIndex: [
        { chapterId: "chapter-1", status: "completed" },
        {
          chapterId: "chapter-2",
          status: "failed",
          errorCategory: "network_unavailable",
        },
      ],
      completedAt: 500,
      clearLease: lease,
    })

    expectApplied(finalized, state, before, ["queue", "lease"])
    expect(finalized.next.lease).toBeNull()
    expect(finalized.next.queue[0]).toMatchObject({
      status: "partial_success",
      completed: 500,
      activeBlock: undefined,
      nextChapterDispatchAt: undefined,
      errorMessage: "Some chapters failed (1/2)",
      errorCategory: "network_unavailable",
    })
    expect(finalized.result).toMatchObject({
      outcome: "applied",
      completedCount: 1,
      finalStatus: "partial_success",
    })

    const missingOutcomeState = createState([
      createTask("task-1", "downloading", {
        chapters: [createChapter("chapter-1", "downloading")],
      }),
    ])
    const materialized = finalizeDownloadTask(missingOutcomeState, {
      taskId: "task-1",
      chapterOutcomesByIndex: [undefined],
      completedAt: 600,
    })
    expect(materialized.result).toMatchObject({
      outcome: "applied",
      finalStatus: "failed",
      chapterOutcomes: [
        expect.objectContaining({
          chapterId: "chapter-1",
          status: "failed",
          errorMessage: "Chapter did not complete dispatch",
        }),
      ],
    })

    const conflict = finalizeDownloadTask(state, {
      taskId: "task-1",
      chapterOutcomesByIndex: [],
      completedAt: 500,
      clearLease: createLease({ chapterId: "stale" }),
    })
    expectNoChange(conflict, state, "rejected")
    const terminal = createState([createTask("task-1", "completed")])
    expectNoChange(
      finalizeDownloadTask(terminal, {
        taskId: "task-1",
        chapterOutcomesByIndex: [],
        completedAt: 500,
      }),
      terminal,
      "rejected"
    )
  })

  it("creates a retry task from only unsuccessful chapters", () => {
    const original = createTask("task-1", "partial_success", {
      chapters: [
        createChapter("ok", "completed"),
        createChapter("failed", "failed", {
          errorMessage: "network",
          totalImages: 10,
          imagesFailed: 10,
          dispatchAttempt: 3,
        }),
        createChapter("partial", "partial_success"),
      ],
    })
    const state = createState([original])
    const before = structuredClone(state)
    const retried = retryFailedChapters(state, {
      taskId: "task-1",
      retryTaskId: "task-retry",
      now: 500,
    })

    expectApplied(retried, state, before, ["queue"])
    expect(retried.next.queue[0]?.isRetried).toBe(true)
    expect(retried.next.queue[1]).toMatchObject({
      id: "task-retry",
      status: "queued",
      isRetryTask: true,
      isRetried: false,
      created: 500,
      chapters: [
        expect.objectContaining({
          id: "failed",
          status: "queued",
          totalImages: undefined,
          imagesFailed: undefined,
          dispatchAttempt: undefined,
          outputs: { requested: 0, committed: 0, failed: 0 },
        }),
        expect.objectContaining({ id: "partial", status: "queued" }),
      ],
    })

    for (const [candidate, reason] of [
      [createState(), "task-not-found"],
      [createState([createTask("task-1", "failed")]), "invalid-status"],
      [
        createState([
          createTask("task-1", "partial_success", { isRetried: true }),
        ]),
        "already-retried",
      ],
      [
        createState([
          createTask("task-1", "partial_success", {
            chapters: [createChapter("ok", "completed")],
          }),
        ]),
        "no-failed-chapters",
      ],
      [
        createState([original, createTask("task-retry", "queued")]),
        "retry-task-id-conflict",
      ],
    ] as const) {
      const decision = retryFailedChapters(candidate, {
        taskId: "task-1",
        retryTaskId: "task-retry",
        now: 500,
      })
      expectNoChange(decision, candidate, "rejected")
      expect(decision.result).toMatchObject({ reason })
    }
  })

  it("restarts only eligible terminal tasks and resets execution fields", () => {
    const original = createTask("task-1", "canceled", {
      errorMessage: "canceled",
      errorCategory: "unknown",
      activeBlock: "destination_action_required",
      started: 150,
      completed: 200,
      lastSuccessfulDownloadId: 40,
      nextChapterDispatchAt: 300,
      chapters: [
        createChapter("chapter-1", "canceled", {
          errorMessage: "canceled",
          totalImages: 10,
          imagesFailed: 1,
          outputs: { requested: 2, committed: 1, failed: 1 },
          dispatchAttempt: 3,
        }),
      ],
    })
    const state = createState([original])
    const before = structuredClone(state)
    const restarted = restartDownloadTask(state, {
      taskId: "task-1",
      restartTaskId: "task-restart",
      now: 500,
    })

    expectApplied(restarted, state, before, ["queue"])
    expect(restarted.next.queue[1]).toMatchObject({
      id: "task-restart",
      status: "queued",
      errorMessage: undefined,
      errorCategory: undefined,
      activeBlock: undefined,
      created: 500,
      started: undefined,
      completed: undefined,
      lastSuccessfulDownloadId: undefined,
      nextChapterDispatchAt: undefined,
      chapters: [
        expect.objectContaining({
          status: "queued",
          totalImages: undefined,
          imagesFailed: undefined,
          dispatchAttempt: undefined,
          outputs: { requested: 0, committed: 0, failed: 0 },
        }),
      ],
    })

    const queued = createState([createTask()])
    expectNoChange(
      restartDownloadTask(queued, {
        taskId: "task-1",
        restartTaskId: "next",
        now: 500,
      }),
      queued,
      "rejected"
    )
    const retried = createState([
      createTask("task-1", "failed", { isRetried: true }),
    ])
    expectNoChange(
      restartDownloadTask(retried, {
        taskId: "task-1",
        restartTaskId: "next",
        now: 500,
      }),
      retried,
      "rejected"
    )
    const conflict = createState([original, createTask("task-restart")])
    expectNoChange(
      restartDownloadTask(conflict, {
        taskId: "task-1",
        restartTaskId: "task-restart",
        now: 500,
      }),
      conflict,
      "rejected"
    )
  })

  it("moves queued work behind the active prefix and reports an exact no-op", () => {
    const state = createState([
      createTask("active", "downloading"),
      createTask("first"),
      createTask("target"),
      createTask("history", "completed"),
    ])
    const before = structuredClone(state)
    const moved = moveQueuedTaskToTop(state, { taskId: "target" })
    expectApplied(moved, state, before, ["queue"])
    expect(moved.next.queue.map((task) => task.id)).toEqual([
      "active",
      "target",
      "first",
      "history",
    ])

    expectNoChange(
      moveQueuedTaskToTop(state, { taskId: "first" }),
      state,
      "unchanged"
    )
    expectNoChange(
      moveQueuedTaskToTop(state, { taskId: "history" }),
      state,
      "rejected"
    )
    expectNoChange(
      moveQueuedTaskToTop(state, { taskId: "missing" }),
      state,
      "rejected"
    )
  })

  it("clears only terminal history and avoids a write when none exists", () => {
    const state = createState([
      createTask("queued"),
      createTask("active", "downloading"),
      createTask("completed", "completed"),
      createTask("failed", "failed"),
      createTask("partial", "partial_success"),
      createTask("canceled", "canceled"),
    ])
    const before = structuredClone(state)
    const cleared = clearTerminalHistory(state)
    expectApplied(cleared, state, before, ["queue"])
    expect(cleared.next.queue.map((task) => task.id)).toEqual([
      "queued",
      "active",
    ])
    expect(cleared.result).toEqual({
      outcome: "applied",
      removedTaskIds: ["completed", "failed", "partial", "canceled"],
    })

    const liveOnly = createState([createTask()])
    expectNoChange(clearTerminalHistory(liveOnly), liveOnly, "unchanged")
  })
})

describe("queue aggregate kernel cancellation and Undo", () => {
  it("stages queued cancellation for Undo with exact position and explicit token", () => {
    const state = createState([
      createTask("before", "downloading"),
      createTask("task-1"),
      createTask("after"),
    ])
    const before = structuredClone(state)
    const canceled = cancelDownloadTask(state, {
      taskId: "task-1",
      commandId: "queued-cancel",
      now: 500,
    })

    expectApplied(canceled, state, before, ["queue", "pendingUndoActions"])
    expect(canceled.next.queue.map((task) => task.id)).toEqual([
      "before",
      "after",
    ])
    expect(canceled.next.pendingUndoActions).toEqual([
      expect.objectContaining({
        token: "cancel:queued-cancel",
        type: "cancel_queued",
        previousQueuePosition: 1,
        createdAt: 500,
        expiresAt: 5_500,
        taskSnapshot: expect.objectContaining({ id: "task-1" }),
      }),
    ])
    expect(canceled.result).toMatchObject({
      outcome: "applied",
      canceledLease: null,
      undo: {
        token: "cancel:queued-cancel",
        type: "cancel_queued",
        expiresAt: 5_500,
      },
    })

    const replay = cancelDownloadTask(canceled.next, {
      taskId: "task-1",
      commandId: "queued-cancel",
      now: 900,
    })
    expectNoChange(replay, canceled.next, "unchanged")
    expect(replay.result).toMatchObject({
      reason: "already-canceled",
      undo: {
        token: "cancel:queued-cancel",
        type: "cancel_queued",
        expiresAt: 5_500,
      },
    })
  })

  it("cancels an active task while retaining its captured lease for acknowledged cleanup", () => {
    const lease = createLease()
    const task = createTask("task-1", "downloading", {
      chapters: [
        createChapter("active", "downloading"),
        createChapter("queued", "queued"),
        createChapter("done", "completed"),
      ],
    })
    const state = createState([task], lease)
    const before = structuredClone(state)
    const canceled = cancelDownloadTask(state, {
      taskId: "task-1",
      commandId: "cancel-command",
      now: 500,
    })

    expectApplied(canceled, state, before, ["queue"])
    expect(canceled.next.lease).toBe(lease)
    expect(canceled.next.pendingUndoActions).toEqual([])
    expect(canceled.next.queue[0]).toMatchObject({
      status: "canceled",
      completed: 500,
      chapters: [
        expect.objectContaining({ status: "canceled" }),
        expect.objectContaining({ status: "skipped" }),
        expect.objectContaining({ status: "completed" }),
      ],
    })
    expect(canceled.result).toMatchObject({
      outcome: "applied",
      canceledLease: lease,
      undo: null,
    })

    const replay = cancelDownloadTask(canceled.next, {
      taskId: "task-1",
      commandId: "cancel-command",
      now: 900,
    })
    expectNoChange(replay, canceled.next, "unchanged")
    expect(replay.result).toMatchObject({
      reason: "already-canceled",
      canceledLease: lease,
      undo: null,
    })

    expectRejectedReason(
      cancelDownloadTask(canceled.next, {
        taskId: "task-1",
        commandId: "different-command",
        now: 901,
      }),
      canceled.next,
      "task-not-active"
    )
  })

  it("cancels a native-output action-required queued task without Undo so surrender runs", () => {
    const task = createTask("task-1", "queued", {
      activeBlock: "native_output_action_required",
      errorCategory: "browser_download_unobservable",
    })
    const state = createState([task])
    const before = structuredClone(state)
    const canceled = cancelDownloadTask(state, {
      taskId: "task-1",
      commandId: "cancel-native",
      now: 500,
    })

    expectApplied(canceled, state, before, ["queue"])
    expect(canceled.next.pendingUndoActions).toEqual([])
    expect(canceled.next.queue[0]).toMatchObject({
      status: "canceled",
      completed: 500,
    })
    expect(canceled.result).toMatchObject({
      outcome: "applied",
      canceledLease: null,
      undo: null,
    })

    const blockedWithLease = blockTaskForNativeOutputAction(
      createState([createTask("task-1", "downloading")]),
      { taskId: "task-1", errorMessage: "erased" }
    )
    const lease = createLease()
    const canceledWithLease = cancelDownloadTask(
      { ...blockedWithLease.next, lease },
      {
        taskId: "task-1",
        commandId: "cancel-native",
        now: 600,
      }
    )
    expect(canceledWithLease.result).toMatchObject({
      outcome: "applied",
      canceledLease: lease,
      undo: null,
      task: { activeCancel: { commandId: "cancel-native" } },
    })
  })

  it("converges cancellation replays while rejecting mismatched and inactive tasks", () => {
    const action = createUndoAction({ token: "cancel:duplicate" })
    const state = createState([createTask()], null, [action])
    const duplicate = cancelDownloadTask(state, {
      taskId: "task-1",
      commandId: "duplicate",
      now: 500,
    })
    expectNoChange(duplicate, state, "unchanged")
    expect(duplicate.result).toMatchObject({
      reason: "already-canceled",
      undo: { token: "cancel:duplicate", type: "cancel_queued" },
    })

    const terminal = createState([createTask("task-1", "completed")])
    expectNoChange(
      cancelDownloadTask(terminal, {
        taskId: "task-1",
        commandId: "terminal-cancel",
        now: 500,
      }),
      terminal,
      "rejected"
    )
    const missing = createState()
    expectNoChange(
      cancelDownloadTask(missing, {
        taskId: "missing",
        commandId: "missing-cancel",
        now: 500,
      }),
      missing,
      "rejected"
    )
  })

  it("removes terminal history into Undo and rejects live/token-conflict cases", () => {
    const task = createTask("task-1", "failed", { completed: 300 })
    const state = createState([task])
    const before = structuredClone(state)
    const removed = removeTerminalDownloadTask(state, {
      taskId: "task-1",
      undoToken: "undo-remove",
      now: 500,
    })
    expectApplied(removed, state, before, ["queue", "pendingUndoActions"])
    expect(removed.next.queue).toEqual([])
    expect(removed.next.pendingUndoActions[0]).toMatchObject({
      type: "remove_history",
      taskSnapshot: task,
    })

    const replay = removeTerminalDownloadTask(removed.next, {
      taskId: "task-1",
      undoToken: "undo-remove",
      now: 900,
    })
    expectNoChange(replay, removed.next, "unchanged")
    expect(replay.result).toMatchObject({
      reason: "already-removed",
      undo: {
        token: "undo-remove",
        type: "remove_history",
        expiresAt: 5_500,
      },
    })

    const queued = createState([createTask()])
    expectNoChange(
      removeTerminalDownloadTask(queued, {
        taskId: "task-1",
        undoToken: "undo",
        now: 500,
      }),
      queued,
      "rejected"
    )
    const duplicate = createState([task], null, [
      createUndoAction({ token: "undo-remove" }),
    ])
    expectNoChange(
      removeTerminalDownloadTask(duplicate, {
        taskId: "task-1",
        undoToken: "undo-remove",
        now: 500,
      }),
      duplicate,
      "rejected"
    )
  })

  it("restores a pending action at its bounded prior position", () => {
    const restoredTask = createTask("restored", "failed")
    const action = createUndoAction({
      type: "remove_history",
      task: restoredTask,
      position: 8,
      now: 100,
    })
    const state = createState([createTask("existing")], null, [action])
    const before = structuredClone(state)
    const restored = restorePendingUndoAction(state, {
      token: action.token,
      now: 1_000,
    })

    expectApplied(restored, state, before, ["queue", "pendingUndoActions"])
    expect(restored.next.queue.map((task) => task.id)).toEqual([
      "existing",
      "restored",
    ])
    expect(restored.next.pendingUndoActions).toEqual([])
    expect(restored.result).toMatchObject({
      outcome: "applied",
      restored: true,
    })

    const duplicateTask = createState([restoredTask], null, [action])
    const duplicateRestore = restorePendingUndoAction(duplicateTask, {
      token: action.token,
      now: 1_000,
    })
    expect(duplicateRestore.changedKeys).toEqual([
      "queue",
      "pendingUndoActions",
    ])
    expect(duplicateRestore.next.queue).not.toBe(duplicateTask.queue)
    expect(duplicateRestore.next.queue[0]?.restoredUndo).toEqual({
      token: action.token,
      type: action.type,
    })
    expect(duplicateRestore.result).toMatchObject({ restored: true })

    const secondRestore = restorePendingUndoAction(duplicateRestore.next, {
      token: action.token,
      now: 1_500,
    })
    expectNoChange(secondRestore, duplicateRestore.next, "unchanged")
    expect(secondRestore.result).toEqual({
      outcome: "unchanged",
      type: action.type,
      restored: true,
      reason: "already-restored",
    })
  })

  it("materializes expired queued cancellation while reporting restoration failure", () => {
    const task = createTask("task-1", "queued", {
      chapters: [
        createChapter("active", "downloading"),
        createChapter("queued", "queued"),
      ],
    })
    const action = createUndoAction({ task, position: 0, now: 100 })
    const state = createState([], null, [action])
    const before = structuredClone(state)
    const expired = restorePendingUndoAction(state, {
      token: action.token,
      now: action.expiresAt,
    })

    expectApplied(expired, state, before, ["queue", "pendingUndoActions"])
    expect(expired.result).toMatchObject({
      outcome: "applied",
      restored: false,
      reason: "expired",
    })
    expect(expired.next.queue[0]).toMatchObject({
      id: "task-1",
      status: "canceled",
      completed: 100,
      chapters: [
        expect.objectContaining({ status: "canceled" }),
        expect.objectContaining({ status: "skipped" }),
      ],
    })

    const alreadyPresent = createState([task], null, [action])
    const duplicateExpiry = restorePendingUndoAction(alreadyPresent, {
      token: action.token,
      now: action.expiresAt,
    })
    expect(duplicateExpiry.changedKeys).toEqual(["pendingUndoActions"])
    expect(duplicateExpiry.next.queue).toBe(alreadyPresent.queue)

    const missing = createState()
    expectNoChange(
      restorePendingUndoAction(missing, { token: "missing", now: 500 }),
      missing,
      "rejected"
    )
  })

  it("finalizes pending actions with exact partition changes", () => {
    const cancelAction = createUndoAction({
      task: createTask("cancel-me"),
      position: 1,
      now: 100,
    })
    const removeAction = createUndoAction({
      token: "remove",
      type: "remove_history",
      task: createTask("removed", "failed"),
      now: 100,
    })
    const state = createState([createTask("existing")], null, [
      cancelAction,
      removeAction,
    ])
    const before = structuredClone(state)
    const finalizedCancel = finalizePendingUndoAction(state, {
      token: cancelAction.token,
    })
    expectApplied(finalizedCancel, state, before, [
      "queue",
      "pendingUndoActions",
    ])
    expect(finalizedCancel.next.queue[1]).toMatchObject({
      id: "cancel-me",
      status: "canceled",
    })

    const finalizedRemove = finalizePendingUndoAction(state, {
      token: removeAction.token,
    })
    expect(finalizedRemove.changedKeys).toEqual(["pendingUndoActions"])
    expect(finalizedRemove.next.queue).toBe(state.queue)

    const missing = createState()
    expectNoChange(
      finalizePendingUndoAction(missing, { token: "missing" }),
      missing,
      "rejected"
    )
  })

  it("reconciles all expired actions in stored order and leaves pending actions", () => {
    const cancelFirst = createUndoAction({
      token: "first",
      task: createTask("first"),
      position: 0,
      now: 100,
    })
    const remove = createUndoAction({
      token: "remove",
      type: "remove_history",
      task: createTask("old", "failed"),
      now: 100,
    })
    const pending = createUndoAction({
      token: "pending",
      task: createTask("pending-task"),
      now: 4_000,
    })
    const cancelSecond = createUndoAction({
      token: "second",
      task: createTask("second"),
      position: 1,
      now: 100,
    })
    const state = createState([], null, [
      cancelFirst,
      remove,
      pending,
      cancelSecond,
    ])
    const before = structuredClone(state)
    const reconciled = reconcileExpiredPendingUndoActions(state, {
      now: 5_500,
    })

    expectApplied(reconciled, state, before, ["queue", "pendingUndoActions"])
    expect(reconciled.next.queue.map((task) => task.id)).toEqual([
      "first",
      "second",
    ])
    expect(
      reconciled.next.queue.every((task) => task.status === "canceled")
    ).toBe(true)
    expect(reconciled.next.pendingUndoActions).toEqual([pending])
    expect(reconciled.result).toMatchObject({
      outcome: "applied",
      finalized: [cancelFirst, remove, cancelSecond],
      pending: [pending],
    })

    const pendingOnly = createState([], null, [pending])
    expectNoChange(
      reconcileExpiredPendingUndoActions(pendingOnly, { now: 5_000 }),
      pendingOnly,
      "unchanged"
    )
  })
})

describe("queue aggregate kernel rejection matrices", () => {
  it("rejects every chapter mutation lookup and active-task guard", () => {
    const missingTask = createState()
    expectRejectedReason(
      updateChapterProgress(missingTask, {
        taskId: "missing",
        chapterId: "chapter-1",
        lease: createLease(),
        now: 500,
      }),
      missingTask,
      "task-not-found"
    )
    expectRejectedReason(
      settleTaskChapter(missingTask, {
        taskId: "missing",
        chapterId: "chapter-1",
        status: "failed",
        now: 500,
      }),
      missingTask,
      "task-not-found"
    )

    const inactive = createState([createTask("task-1", "completed")])
    expectRejectedReason(
      updateChapterProgress(inactive, {
        taskId: "task-1",
        chapterId: "chapter-1",
        lease: createLease(),
        now: 500,
      }),
      inactive,
      "task-not-active"
    )
    expectRejectedReason(
      settleTaskChapter(inactive, {
        taskId: "task-1",
        chapterId: "chapter-1",
        status: "failed",
        now: 500,
      }),
      inactive,
      "task-not-active"
    )

    const missingChapter = createState([createTask("task-1", "downloading")])
    expectRejectedReason(
      updateChapterProgress(missingChapter, {
        taskId: "task-1",
        chapterId: "missing",
        lease: createLease(),
        now: 500,
      }),
      missingChapter,
      "chapter-not-found"
    )
    expectRejectedReason(
      settleTaskChapter(missingChapter, {
        taskId: "task-1",
        chapterId: "missing",
        status: "failed",
        now: 500,
      }),
      missingChapter,
      "chapter-not-found"
    )
  })

  it("rejects every task metadata and scheduling lookup/status guard", () => {
    const missing = createState()
    expectRejectedReason(
      recordTaskDispatchError(missing, {
        taskId: "missing",
        errorMessage: "error",
      }),
      missing,
      "task-not-found"
    )
    expectRejectedReason(
      setNextChapterDispatchAt(missing, {
        taskId: "missing",
        nextChapterDispatchAt: 500,
      }),
      missing,
      "task-not-found"
    )

    const inactive = createState([createTask("task-1", "failed")])
    expectRejectedReason(
      recordTaskDispatchError(inactive, {
        taskId: "task-1",
        errorMessage: "error",
      }),
      inactive,
      "task-not-active"
    )
    expectRejectedReason(
      setNextChapterDispatchAt(inactive, {
        taskId: "task-1",
        nextChapterDispatchAt: 500,
      }),
      inactive,
      "task-not-active"
    )
  })

  it("rejects every destination/provider lookup and chapter guard", () => {
    const missing = createState()
    expectRejectedReason(
      blockTaskForDestination(missing, {
        taskId: "missing",
        now: 500,
      }),
      missing,
      "task-not-found"
    )
    expectRejectedReason(
      releaseDestinationBlock(missing, { taskId: "missing" }),
      missing,
      "task-not-found"
    )
    expectRejectedReason(
      blockTaskForProviderPolicy(missing, {
        taskId: "missing",
        block: "provider_network_policy_pending",
      }),
      missing,
      "task-not-found"
    )
    expectRejectedReason(
      releaseProviderPolicyBlock(missing, { taskId: "missing" }),
      missing,
      "task-not-found"
    )

    const active = createState([createTask("task-1", "downloading")])
    expectRejectedReason(
      blockTaskForDestination(active, {
        taskId: "task-1",
        now: 500,
        chapter: { chapterId: "missing", lease: createLease() },
      }),
      active,
      "chapter-not-found"
    )
    const terminal = createState([
      createTask("task-1", "completed", {
        activeBlock: "destination_action_required",
      }),
    ])
    expectRejectedReason(
      releaseDestinationBlock(terminal, { taskId: "task-1" }),
      terminal,
      "task-not-active"
    )
  })

  it("rejects missing interruption/finalization/history identities", () => {
    const missing = createState()
    expectRejectedReason(
      interruptDownloadTask(missing, {
        taskId: "missing",
        errorMessage: "error",
        now: 500,
      }),
      missing,
      "task-not-found"
    )
    expectRejectedReason(
      finalizeDownloadTask(missing, {
        taskId: "missing",
        chapterOutcomesByIndex: [],
        completedAt: 500,
      }),
      missing,
      "task-not-found"
    )
    expectRejectedReason(
      restartDownloadTask(missing, {
        taskId: "missing",
        restartTaskId: "restart",
        now: 500,
      }),
      missing,
      "task-not-found"
    )
    expectRejectedReason(
      removeTerminalDownloadTask(missing, {
        taskId: "missing",
        undoToken: "undo",
        now: 500,
      }),
      missing,
      "task-not-found"
    )
  })
})
