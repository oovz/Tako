import { OFFSCREEN_JOB_LEASE_MS } from "@/src/constants/timeouts"
import type { DownloadErrorCategory } from "@/src/shared/download-contract"
import type { ChapterStatus } from "@/src/types/chapter"
import {
  applyExpiredPendingUndoAction,
  createPendingUndoAction,
  partitionPendingUndoActions,
  reinsertPendingUndoTask,
  toPendingUndoReceipt,
} from "./pending-undo"
import {
  cancelDownloadingTask,
  isExecutingDownloadTask,
  isRunnableQueuedTask,
  isTerminalChapterStatus,
  isTerminalDownloadTask,
  materializeChapterDispatchOutcomes,
  normalizeDownloadTaskExecutionState,
  normalizeInterruptedTask,
  resolveFinalDownloadTaskStatus,
  type ChapterDispatchOutcome,
} from "./task-lifecycle"
import type {
  ActiveDispatchLease,
  ActiveTaskBlock,
  DispatchLeaseAuthority,
  DispatchLeaseIdentity,
  DownloadTaskState,
  FullDispatchLeaseIdentity,
  NativeOutputSettlement,
  OffscreenJobStage,
  OutputAccounting,
  PendingUndoAction,
  PendingUndoReceipt,
  QueueAggregateKey,
  QueueAggregateState,
  TaskChapter,
} from "./state"

export type QueueKernelDecision<TResult> = {
  next: QueueAggregateState
  changedKeys: readonly QueueAggregateKey[]
  result: TResult
}

export type Applied<T extends object = Record<never, never>> = {
  outcome: "applied"
} & T

export type Unchanged<T extends object = Record<never, never>> = {
  outcome: "unchanged"
} & T

export type Rejected<
  TReason extends string,
  T extends object = Record<never, never>,
> = { outcome: "rejected"; reason: TReason } & T

export type TaskChapterUpdate = {
  errorMessage?: string
  errorCategory?: DownloadErrorCategory
  totalImages?: number
  imagesFailed?: number
  outputs?: OutputAccounting
}

export type TaskMutationRejection = Rejected<
  "task-not-found" | "task-not-active",
  { currentStatus?: DownloadTaskState["status"] }
>

export type StartupOffscreenJobObservation = FullDispatchLeaseIdentity & {
  status: "active" | "terminal" | "canceled"
}

export type StartupRecoveryInput = {
  normalizationTime: number
  interruptedAt: number
  observedLease: DispatchLeaseAuthority | null
  offscreenJob: StartupOffscreenJobObservation | null
  nativeOutputTaskIds: readonly string[]
}

type StartupRecoverySummary = {
  queue: DownloadTaskState[]
  recoveredTaskIds: string[]
  interruptedTaskIds: string[]
  leaseCleared: boolean
  resumeTaskId?: string
}

export type StartupRecoveryResult =
  | Applied<StartupRecoverySummary>
  | Unchanged<StartupRecoverySummary>
  | Rejected<"lease-conflict">

const QUEUE_KEY = ["queue"] as const
const LEASE_KEY = ["lease"] as const
const UNDO_KEY = ["pendingUndoActions"] as const
const QUEUE_LEASE_KEYS = ["queue", "lease"] as const
const QUEUE_UNDO_KEYS = ["queue", "pendingUndoActions"] as const

const STAGE_ORDER: Record<OffscreenJobStage, number> = {
  dispatching: 0,
  accepted: 1,
  resolving: 2,
  downloading: 3,
  transforming: 4,
  archiving: 5,
  saving: 6,
}

function baseLeaseMatches(
  lease: ActiveDispatchLease | null,
  identity: DispatchLeaseIdentity
): boolean {
  return (
    lease?.jobId === identity.jobId &&
    lease.attempt === identity.attempt &&
    lease.taskId === identity.taskId &&
    lease.chapterId === identity.chapterId
  )
}

function exactLeaseMatches(
  lease: ActiveDispatchLease | null,
  identity: DispatchLeaseAuthority
): boolean {
  return (
    baseLeaseMatches(lease, identity) &&
    lease?.fingerprint === identity.fingerprint &&
    lease.documentInstanceId === identity.documentInstanceId
  )
}

function replaceTaskAt(
  queue: readonly DownloadTaskState[],
  taskIndex: number,
  task: DownloadTaskState
): DownloadTaskState[] {
  const nextQueue = [...queue]
  nextQueue[taskIndex] = task
  return nextQueue
}

function accountingWithMonotonicCounts(
  current: OutputAccounting | undefined,
  incoming: OutputAccounting
): OutputAccounting {
  return {
    requested: Math.max(current?.requested ?? 0, incoming.requested),
    committed: Math.max(current?.committed ?? 0, incoming.committed),
    failed: Math.max(current?.failed ?? 0, incoming.failed),
  }
}

function accountingEquals(
  left: OutputAccounting | undefined,
  right: OutputAccounting | undefined
): boolean {
  return (
    left?.requested === right?.requested &&
    left?.committed === right?.committed &&
    left?.failed === right?.failed
  )
}

function applyChapterUpdate(
  chapter: TaskChapter,
  status: ChapterStatus,
  updates: TaskChapterUpdate,
  now: number
): TaskChapter {
  const outputs = updates.outputs
    ? accountingWithMonotonicCounts(chapter.outputs, updates.outputs)
    : chapter.outputs
  return {
    ...chapter,
    status,
    errorMessage: updates.errorMessage,
    errorCategory: updates.errorCategory,
    totalImages: updates.totalImages ?? chapter.totalImages,
    imagesFailed: updates.imagesFailed ?? chapter.imagesFailed,
    outputs,
    lastUpdated: now,
  }
}

function chapterUpdateEquals(left: TaskChapter, right: TaskChapter): boolean {
  return (
    left.status === right.status &&
    left.errorMessage === right.errorMessage &&
    left.errorCategory === right.errorCategory &&
    left.totalImages === right.totalImages &&
    left.imagesFailed === right.imagesFailed &&
    accountingEquals(left.outputs, right.outputs) &&
    left.lastUpdated === right.lastUpdated
  )
}

export function enqueueDownloadTask(
  state: QueueAggregateState,
  input: { task: DownloadTaskState }
): QueueKernelDecision<
  Applied<{ task: DownloadTaskState }> | Rejected<"task-id-conflict">
> {
  if (state.queue.some((task) => task.id === input.task.id)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-id-conflict" },
    }
  }

  const task = structuredClone(input.task)
  return {
    next: { ...state, queue: [...state.queue, task] },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task },
  }
}

export function recoverQueueAfterStartup(
  state: QueueAggregateState,
  input: StartupRecoveryInput
): QueueKernelDecision<StartupRecoveryResult> {
  const observedLeaseMatches = input.observedLease
    ? exactLeaseMatches(state.lease, input.observedLease)
    : state.lease === null
  if (!observedLeaseMatches) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-conflict" },
    }
  }

  const recoveredTaskIds = new Set<string>()
  const interruptedTaskIds: string[] = []
  const nativeOutputTaskIds = new Set(input.nativeOutputTaskIds)
  let queue = state.queue.map((task) => {
    const taskWithCompletion =
      isTerminalDownloadTask(task) && typeof task.completed !== "number"
        ? { ...task, completed: input.normalizationTime }
        : task
    const normalizedTask =
      normalizeDownloadTaskExecutionState(taskWithCompletion)
    if (normalizedTask !== task) recoveredTaskIds.add(task.id)
    return normalizedTask
  })
  if (recoveredTaskIds.size === 0) queue = state.queue

  const exactOffscreenJob =
    state.lease !== null &&
    input.offscreenJob !== null &&
    input.offscreenJob.status !== "canceled" &&
    exactLeaseMatches(state.lease, input.offscreenJob)
  const clearLease = state.lease !== null && !exactOffscreenJob
  let resumeTaskId = exactOffscreenJob ? state.lease?.taskId : undefined

  queue = queue.map((task) => {
    if (!isExecutingDownloadTask(task)) return task
    if (nativeOutputTaskIds.has(task.id)) return task
    if (exactOffscreenJob && state.lease?.taskId === task.id) return task
    if (
      state.lease === null &&
      task.chapters.every((chapter) => chapter.status !== "downloading")
    ) {
      resumeTaskId ??= task.id
      return task
    }
    recoveredTaskIds.add(task.id)
    interruptedTaskIds.push(task.id)
    return normalizeInterruptedTask(
      task,
      "Download interrupted",
      input.interruptedAt
    )
  })

  const queueChanged = recoveredTaskIds.size > 0
  if (!queueChanged && !clearLease) {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "unchanged",
        queue: [...state.queue],
        recoveredTaskIds: [],
        interruptedTaskIds,
        leaseCleared: false,
        resumeTaskId,
      },
    }
  }

  const changedKeys = queueChanged
    ? clearLease
      ? QUEUE_LEASE_KEYS
      : QUEUE_KEY
    : LEASE_KEY
  return {
    next: {
      ...state,
      queue,
      lease: clearLease ? null : state.lease,
    },
    changedKeys,
    result: {
      outcome: "applied",
      queue,
      recoveredTaskIds: [...recoveredTaskIds],
      interruptedTaskIds,
      leaseCleared: clearLease,
      resumeTaskId,
    },
  }
}

export function startDownloadTask(
  state: QueueAggregateState,
  input: {
    taskId: string
    now: number
  }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Rejected<
      "task-not-found" | "task-not-runnable" | "active-task-exists",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }

  const task = state.queue[taskIndex]
  if (!isRunnableQueuedTask(task)) {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-runnable",
        currentStatus: task.status,
      },
    }
  }
  const activeTaskExists = state.queue.some(
    (candidate) =>
      candidate.id !== input.taskId && isExecutingDownloadTask(candidate)
  )
  if (state.lease !== null || activeTaskExists) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "active-task-exists" },
    }
  }

  const startedTask: DownloadTaskState = {
    ...task,
    status: "downloading",
    started: input.now,
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, startedTask),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task: startedTask },
  }
}

export function beginChapterDispatch(
  state: QueueAggregateState,
  input: {
    taskId: string
    chapterId: string
    lease: ActiveDispatchLease
    expectedPreviousLease: DispatchLeaseAuthority | null
    now: number
  }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState; lease: ActiveDispatchLease }>
  | Rejected<
      | "task-not-found"
      | "task-not-active"
      | "chapter-not-found"
      | "chapter-not-dispatchable"
      | "lease-conflict",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  const chapterIndex = task.chapters.findIndex(
    (chapter) => chapter.id === input.chapterId
  )
  if (chapterIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "chapter-not-found" },
    }
  }
  const chapter = task.chapters[chapterIndex]
  if (chapter.status !== "queued" && chapter.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "chapter-not-dispatchable" },
    }
  }

  const previousLeaseMatches = input.expectedPreviousLease
    ? exactLeaseMatches(state.lease, input.expectedPreviousLease)
    : state.lease === null
  if (
    !previousLeaseMatches ||
    input.lease.taskId !== input.taskId ||
    input.lease.chapterId !== input.chapterId
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-conflict" },
    }
  }

  const chapters = [...task.chapters]
  chapters[chapterIndex] = {
    ...chapter,
    status: "downloading",
    dispatchAttempt: input.lease.attempt,
    outputs: { requested: 0, committed: 0, failed: 0 },
    errorMessage: undefined,
    lastUpdated: input.now,
  }
  const updatedTask = { ...task, chapters }
  const lease = structuredClone(input.lease)
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
      lease,
    },
    changedKeys: QUEUE_LEASE_KEYS,
    result: { outcome: "applied", task: updatedTask, lease },
  }
}

export function updateChapterProgress(
  state: QueueAggregateState,
  input: {
    taskId: string
    chapterId: string
    lease: DispatchLeaseAuthority
    now: number
    updates?: TaskChapterUpdate
  }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState; chapter: TaskChapter }>
  | Unchanged<{ reason: "terminal-chapter" | "already-current" }>
  | TaskMutationRejection
  | Rejected<"chapter-not-found" | "lease-conflict">
> {
  return updateChapter(state, {
    ...input,
    status: "downloading",
    leaseIdentity: input.lease,
    terminalUpdate: false,
  })
}

export function settleTaskChapter(
  state: QueueAggregateState,
  input: {
    taskId: string
    chapterId: string
    status: "completed" | "partial_success" | "failed"
    lease?: DispatchLeaseAuthority
    now: number
    updates?: TaskChapterUpdate
  }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState; chapter: TaskChapter }>
  | Unchanged<{ reason: "terminal-chapter" | "already-current" }>
  | TaskMutationRejection
  | Rejected<"chapter-not-found" | "lease-conflict">
> {
  return updateChapter(state, {
    ...input,
    leaseIdentity: input.lease,
    terminalUpdate: true,
  })
}

function updateChapter(
  state: QueueAggregateState,
  input: {
    taskId: string
    chapterId: string
    status: "downloading" | "completed" | "partial_success" | "failed"
    leaseIdentity?: DispatchLeaseAuthority
    now: number
    updates?: TaskChapterUpdate
    terminalUpdate: boolean
  }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState; chapter: TaskChapter }>
  | Unchanged<{ reason: "terminal-chapter" | "already-current" }>
  | TaskMutationRejection
  | Rejected<"chapter-not-found" | "lease-conflict">
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  const chapterIndex = task.chapters.findIndex(
    (chapter) => chapter.id === input.chapterId
  )
  if (chapterIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "chapter-not-found" },
    }
  }
  const chapter = task.chapters[chapterIndex]
  if (chapter.status === "downloading" && !input.leaseIdentity) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-conflict" },
    }
  }
  if (
    input.leaseIdentity &&
    !exactLeaseMatches(state.lease, input.leaseIdentity)
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-conflict" },
    }
  }
  if (
    isTerminalChapterStatus(chapter.status) &&
    input.status !== chapter.status
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "terminal-chapter" },
    }
  }
  if (!input.terminalUpdate && isTerminalChapterStatus(chapter.status)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "terminal-chapter" },
    }
  }

  const updatedChapter = applyChapterUpdate(
    chapter,
    input.status,
    input.updates ?? {},
    input.now
  )
  if (chapterUpdateEquals(chapter, updatedChapter)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "already-current" },
    }
  }
  const chapters = [...task.chapters]
  chapters[chapterIndex] = updatedChapter
  const updatedTask = { ...task, chapters }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
    },
    changedKeys: QUEUE_KEY,
    result: {
      outcome: "applied",
      task: updatedTask,
      chapter: updatedChapter,
    },
  }
}

export function recordTaskDispatchError(
  state: QueueAggregateState,
  input: {
    taskId: string
    errorMessage?: string
    errorCategory?: DownloadErrorCategory
  }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Unchanged<{ reason: "already-current" }>
  | TaskMutationRejection
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  if (
    task.errorMessage === input.errorMessage &&
    task.errorCategory === input.errorCategory
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "already-current" },
    }
  }

  const updatedTask = {
    ...task,
    errorMessage: input.errorMessage,
    errorCategory: input.errorCategory,
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task: updatedTask },
  }
}

export function renewDispatchLease(
  state: QueueAggregateState,
  input: DispatchLeaseIdentity & {
    fingerprint: string
    documentInstanceId: string
    eventSignature: string
    stage: OffscreenJobStage
    sequence: number
    activityAt: number
    requireSequenceAdvance?: boolean
  }
): QueueKernelDecision<
  | Applied<{ lease: ActiveDispatchLease }>
  | Unchanged<{ lease: ActiveDispatchLease }>
  | Rejected<
      | "lease-not-current"
      | "invalid-activity-time"
      | "stale-sequence"
      | "sequence-conflict"
      | "stage-regression"
    >
> {
  const current = state.lease
  if (
    !current ||
    !exactLeaseMatches(current, input) ||
    current.fingerprint !== input.fingerprint ||
    (current.documentInstanceId !== undefined &&
      current.documentInstanceId !== input.documentInstanceId)
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-not-current" },
    }
  }
  if (!Number.isFinite(input.activityAt) || input.activityAt < 0) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "invalid-activity-time" },
    }
  }
  if (input.sequence < current.sequence) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "stale-sequence" },
    }
  }
  if (
    input.sequence === current.sequence &&
    current.lastEventSignature !== input.eventSignature
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "sequence-conflict" },
    }
  }
  if (
    input.sequence === current.sequence &&
    input.requireSequenceAdvance === true
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "stale-sequence" },
    }
  }
  if (STAGE_ORDER[input.stage] < STAGE_ORDER[current.stage]) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "stage-regression" },
    }
  }
  if (input.sequence === current.sequence) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", lease: current },
    }
  }

  const lastActivityAt = Math.max(current.lastActivityAt, input.activityAt)
  const lease: ActiveDispatchLease = {
    ...current,
    documentInstanceId: input.documentInstanceId,
    lastEventSignature: input.eventSignature,
    stage: input.stage,
    sequence: input.sequence,
    lastActivityAt,
    leaseExpiresAt: lastActivityAt + OFFSCREEN_JOB_LEASE_MS,
  }
  return {
    next: { ...state, lease },
    changedKeys: LEASE_KEY,
    result: { outcome: "applied", lease },
  }
}

export function bindDispatchLeaseIncarnation(
  state: QueueAggregateState,
  input: DispatchLeaseIdentity & {
    fingerprint: string
    documentInstanceId: string
  }
): QueueKernelDecision<
  | Applied<{ lease: ActiveDispatchLease }>
  | Unchanged<{ lease: ActiveDispatchLease }>
  | Rejected<"lease-not-current" | "incarnation-conflict">
> {
  const current = state.lease
  if (
    !current ||
    !baseLeaseMatches(current, input) ||
    current.fingerprint !== input.fingerprint
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-not-current" },
    }
  }
  if (
    current.documentInstanceId !== undefined &&
    current.documentInstanceId !== input.documentInstanceId
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "incarnation-conflict" },
    }
  }
  if (current.documentInstanceId === input.documentInstanceId) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", lease: current },
    }
  }
  const lease = { ...current, documentInstanceId: input.documentInstanceId }
  return {
    next: { ...state, lease },
    changedKeys: LEASE_KEY,
    result: { outcome: "applied", lease },
  }
}

export function clearDispatchLease(
  state: QueueAggregateState,
  input: { identity: DispatchLeaseAuthority }
): QueueKernelDecision<
  Applied<{ lease: ActiveDispatchLease }> | Rejected<"lease-not-current">
> {
  if (!state.lease || !exactLeaseMatches(state.lease, input.identity)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-not-current" },
    }
  }
  return {
    next: { ...state, lease: null },
    changedKeys: LEASE_KEY,
    result: { outcome: "applied", lease: state.lease },
  }
}

export function setNextChapterDispatchAt(
  state: QueueAggregateState,
  input: { taskId: string; nextChapterDispatchAt?: number }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Unchanged<{ reason: "already-current" }>
  | TaskMutationRejection
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  if (task.nextChapterDispatchAt === input.nextChapterDispatchAt) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "already-current" },
    }
  }
  const updatedTask = {
    ...task,
    nextChapterDispatchAt: input.nextChapterDispatchAt,
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task: updatedTask },
  }
}

export function applyNativeOutputSettlement(
  state: QueueAggregateState,
  input: {
    jobId: string
    attempt: number
    taskId: string
    chapterId: string
    requested: number
    completed: number
    interrupted: number
    surrendered: number
    lastSuccessfulDownloadId?: number
    now: number
  }
): QueueKernelDecision<
  | {
      outcome: "applied"
      task: DownloadTaskState
      chapter: TaskChapter
      settlement: NativeOutputSettlement
    }
  | { outcome: "already_applied"; settlement: NativeOutputSettlement }
  | {
      outcome: "not_owner"
      reason:
        "task-missing" | "chapter-missing" | "task-canceled" | "stale-terminal"
    }
  | {
      outcome: "conflict"
      reason:
        | "invalid-totals"
        | "settlement-conflict"
        | "active-attempt-conflict"
        | "lease-conflict"
    }
> {
  if (
    input.requested < 0 ||
    input.completed < 0 ||
    input.interrupted < 0 ||
    input.surrendered < 0 ||
    !Number.isInteger(input.requested) ||
    !Number.isInteger(input.completed) ||
    !Number.isInteger(input.interrupted) ||
    !Number.isInteger(input.surrendered) ||
    input.completed + input.interrupted + input.surrendered !== input.requested
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "conflict", reason: "invalid-totals" },
    }
  }

  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "not_owner", reason: "task-missing" },
    }
  }
  const task = state.queue[taskIndex]
  const chapterIndex = task.chapters.findIndex(
    (chapter) => chapter.id === input.chapterId
  )
  if (chapterIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "not_owner", reason: "chapter-missing" },
    }
  }
  const chapter = task.chapters[chapterIndex]

  const existing = chapter.nativeOutputSettlement
  if (existing) {
    const exactReplay =
      existing.jobId === input.jobId &&
      existing.attempt === input.attempt &&
      existing.taskId === input.taskId &&
      existing.chapterId === input.chapterId &&
      existing.requested === input.requested &&
      existing.completed === input.completed &&
      existing.interrupted === input.interrupted &&
      existing.surrendered === input.surrendered &&
      existing.lastSuccessfulDownloadId === input.lastSuccessfulDownloadId
    return {
      next: state,
      changedKeys: [],
      result: exactReplay
        ? { outcome: "already_applied", settlement: existing }
        : { outcome: "conflict", reason: "settlement-conflict" },
    }
  }
  if (task.status === "canceled") {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "not_owner", reason: "task-canceled" },
    }
  }
  if (isTerminalDownloadTask(task)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "not_owner", reason: "stale-terminal" },
    }
  }
  if (chapter.dispatchAttempt !== input.attempt) {
    const terminal = isTerminalChapterStatus(chapter.status)
    return {
      next: state,
      changedKeys: [],
      result: terminal
        ? { outcome: "not_owner", reason: "stale-terminal" }
        : { outcome: "conflict", reason: "active-attempt-conflict" },
    }
  }
  if (
    baseLeaseMatches(state.lease, {
      jobId: input.jobId,
      attempt: input.attempt,
      taskId: input.taskId,
      chapterId: input.chapterId,
    })
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "conflict", reason: "lease-conflict" },
    }
  }

  const settlement: NativeOutputSettlement = {
    jobId: input.jobId,
    attempt: input.attempt,
    taskId: input.taskId,
    chapterId: input.chapterId,
    requested: input.requested,
    completed: input.completed,
    interrupted: input.interrupted,
    surrendered: input.surrendered,
    lastSuccessfulDownloadId: input.lastSuccessfulDownloadId,
    appliedAt: input.now,
  }
  const interruptionMessage =
    input.interrupted === 0
      ? undefined
      : input.completed > 0
        ? `${input.interrupted} output file(s) did not finish saving.`
        : "Chrome could not finish saving the output."
  const surrenderMessage =
    input.surrendered === 0
      ? undefined
      : `${input.surrendered} output file(s) could not be verified because Chrome cleared their download history.`
  const hasInterruption = input.interrupted > 0
  const hasSurrender = input.surrendered > 0
  const updatedChapter: TaskChapter = {
    ...chapter,
    status:
      input.requested > 0 && input.completed === input.requested
        ? "completed"
        : input.completed > 0
          ? "partial_success"
          : "failed",
    errorMessage:
      !hasInterruption && !hasSurrender
        ? undefined
        : [interruptionMessage, surrenderMessage]
            .filter((part): part is string => part !== undefined)
            .join(" "),
    errorCategory:
      !hasInterruption && !hasSurrender
        ? undefined
        : hasSurrender
          ? "browser_download_unobservable"
          : "browser_download_interrupted",
    outputs: {
      requested: input.requested,
      committed: input.completed,
      failed: input.interrupted + input.surrendered,
    },
    nativeOutputSettlement: settlement,
    lastUpdated: Math.max(chapter.lastUpdated, input.now),
  }
  const chapters = [...task.chapters]
  chapters[chapterIndex] = updatedChapter
  const lastSuccessfulDownloadId =
    input.lastSuccessfulDownloadId !== undefined &&
    (task.lastSuccessfulDownloadId === undefined ||
      input.lastSuccessfulDownloadId > task.lastSuccessfulDownloadId)
      ? input.lastSuccessfulDownloadId
      : task.lastSuccessfulDownloadId
  const allChaptersTerminal = chapters.every((candidate) =>
    isTerminalChapterStatus(candidate.status)
  )
  const completedChapterCount = chapters.filter(
    (candidate) => candidate.status === "completed"
  ).length
  const successfulChapterCount = chapters.filter(
    (candidate) =>
      candidate.status === "completed" || candidate.status === "partial_success"
  ).length
  const terminalStatus: DownloadTaskState["status"] =
    completedChapterCount === chapters.length && chapters.length > 0
      ? "completed"
      : successfulChapterCount > 0
        ? "partial_success"
        : "failed"
  const updatedTask: DownloadTaskState = {
    ...task,
    chapters,
    lastSuccessfulDownloadId,
    nextChapterDispatchAt: allChaptersTerminal
      ? undefined
      : task.nextChapterDispatchAt,
    ...(allChaptersTerminal
      ? {
          status: terminalStatus,
          completed: input.now,
          activeBlock: undefined,
          errorMessage:
            terminalStatus === "completed"
              ? undefined
              : (updatedChapter.errorMessage ?? task.errorMessage),
          errorCategory:
            terminalStatus === "completed"
              ? undefined
              : (updatedChapter.errorCategory ??
                task.errorCategory ??
                "unknown"),
        }
      : {}),
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
    },
    changedKeys: QUEUE_KEY,
    result: {
      outcome: "applied",
      task: updatedTask,
      chapter: updatedChapter,
      settlement,
    },
  }
}

export function blockTaskForDestination(
  state: QueueAggregateState,
  input: {
    taskId: string
    now: number
    errorMessage?: string
    errorCategory?: DownloadErrorCategory
    chapter?: {
      chapterId: string
      lease: DispatchLeaseAuthority
      imagesFailed?: number
      outputs?: OutputAccounting
    }
  }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Unchanged<{ reason: "already-blocked" }>
  | Rejected<
      | "task-not-found"
      | "task-not-active"
      | "chapter-not-found"
      | "terminal-chapter"
      | "lease-conflict",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "queued" && task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }

  let chapters = task.chapters
  if (input.chapter) {
    const chapterIndex = task.chapters.findIndex(
      (chapter) => chapter.id === input.chapter?.chapterId
    )
    if (chapterIndex === -1) {
      return {
        next: state,
        changedKeys: [],
        result: { outcome: "rejected", reason: "chapter-not-found" },
      }
    }
    const chapter = task.chapters[chapterIndex]
    if (!exactLeaseMatches(state.lease, input.chapter.lease)) {
      return {
        next: state,
        changedKeys: [],
        result: { outcome: "rejected", reason: "lease-conflict" },
      }
    }
    if (isTerminalChapterStatus(chapter.status)) {
      return {
        next: state,
        changedKeys: [],
        result: { outcome: "rejected", reason: "terminal-chapter" },
      }
    }
    chapters = [...task.chapters]
    chapters[chapterIndex] = applyChapterUpdate(
      chapter,
      "queued",
      {
        errorMessage: input.errorMessage,
        errorCategory: input.errorCategory,
        imagesFailed: input.chapter.imagesFailed,
        outputs: input.chapter.outputs,
      },
      input.now
    )
  }

  if (
    task.status === "queued" &&
    task.activeBlock === "destination_action_required" &&
    chapters === task.chapters &&
    task.errorMessage === input.errorMessage &&
    task.errorCategory === input.errorCategory
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "already-blocked" },
    }
  }
  const updatedTask: DownloadTaskState = {
    ...task,
    status: "queued",
    activeBlock: "destination_action_required",
    errorMessage: input.errorMessage ?? task.errorMessage,
    errorCategory: input.errorCategory ?? task.errorCategory,
    chapters,
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task: updatedTask },
  }
}

export function releaseDestinationBlock(
  state: QueueAggregateState,
  input: { taskId: string }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Unchanged<{ reason: "not-blocked" }>
  | TaskMutationRejection
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "queued" && task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  if (task.activeBlock !== "destination_action_required") {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "not-blocked" },
    }
  }
  const updatedTask = {
    ...task,
    status: "queued" as const,
    activeBlock: undefined,
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task: updatedTask },
  }
}

export function resumeDestinationTask(
  state: QueueAggregateState,
  input: {
    taskId: string
    destinationOverride?: "downloads-api"
    now: number
  }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Unchanged<{ reason: "not-blocked" }>
  | TaskMutationRejection
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "queued" && task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  if (task.activeBlock !== "destination_action_required") {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "not-blocked" },
    }
  }
  const updatedTask: DownloadTaskState = {
    ...task,
    status: "queued",
    activeBlock: undefined,
    destinationOverride: input.destinationOverride,
    errorMessage: undefined,
    errorCategory: undefined,
    chapters: task.chapters.map((chapter) =>
      chapter.status === "queued" || chapter.status === "downloading"
        ? {
            ...chapter,
            status: "queued",
            errorMessage: undefined,
            lastUpdated: input.now,
          }
        : chapter
    ),
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task: updatedTask },
  }
}

export function blockTaskForProviderPolicy(
  state: QueueAggregateState,
  input: { taskId: string; block: ActiveTaskBlock }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Unchanged<{ reason: "already-blocked" }>
  | TaskMutationRejection
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "queued" && task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  if (task.status === "queued" && task.activeBlock === input.block) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "already-blocked" },
    }
  }
  const updatedTask: DownloadTaskState = {
    ...task,
    status: "queued",
    activeBlock: input.block,
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task: updatedTask },
  }
}

export function releaseProviderPolicyBlock(
  state: QueueAggregateState,
  input: { taskId: string }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Unchanged<{ reason: "not-blocked" }>
  | TaskMutationRejection
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "queued" && task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  if (
    task.activeBlock !== "provider_network_policy_pending" &&
    task.activeBlock !== "provider_network_policy_action_required"
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "not-blocked" },
    }
  }
  const updatedTask = { ...task, activeBlock: undefined }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task: updatedTask },
  }
}

export function releaseProviderPolicyBlocks(
  state: QueueAggregateState
): QueueKernelDecision<
  Applied<{ releasedTaskIds: string[] }> | Unchanged<{ releasedTaskIds: [] }>
> {
  const releasedTaskIds: string[] = []
  const queue = state.queue.map((task) => {
    if (
      task.status === "queued" &&
      task.activeBlock === "provider_network_policy_pending"
    ) {
      releasedTaskIds.push(task.id)
      return { ...task, activeBlock: undefined }
    }
    return task
  })
  if (releasedTaskIds.length === 0) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", releasedTaskIds: [] },
    }
  }
  return {
    next: { ...state, queue },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", releasedTaskIds },
  }
}

/**
 * Block a task because one of its native browser downloads was erased from
 * Chrome history and the user must decide whether to forget it. The queue
 * stops dispatching it until FORGET_UNOBSERVABLE_OUTPUTS releases the block.
 */
export function blockTaskForNativeOutputAction(
  state: QueueAggregateState,
  input: { taskId: string; errorMessage: string }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Unchanged<{ reason: "already-blocked" }>
  | TaskMutationRejection
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "queued" && task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  if (
    task.status === "queued" &&
    task.activeBlock === "native_output_action_required" &&
    task.errorCategory === "browser_download_unobservable"
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "already-blocked" },
    }
  }
  const updatedTask: DownloadTaskState = {
    ...task,
    status: "queued",
    activeBlock: "native_output_action_required",
    errorMessage: input.errorMessage,
    errorCategory: "browser_download_unobservable",
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task: updatedTask },
  }
}

export function releaseNativeOutputActionBlock(
  state: QueueAggregateState,
  input: { taskId: string }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Unchanged<{ reason: "not-blocked" }>
  | TaskMutationRejection
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "queued" && task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  if (task.activeBlock !== "native_output_action_required") {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "not-blocked" },
    }
  }
  const updatedTask: DownloadTaskState = {
    ...task,
    status: "queued",
    activeBlock: undefined,
    errorMessage: undefined,
    errorCategory: undefined,
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task: updatedTask },
  }
}

export function interruptDownloadTask(
  state: QueueAggregateState,
  input: {
    taskId: string
    errorMessage: string
    now: number
    clearLease?: DispatchLeaseAuthority
  }
): QueueKernelDecision<
  | Applied<{
      task: DownloadTaskState
      clearedLease: ActiveDispatchLease | null
    }>
  | Rejected<
      "task-not-found" | "task-not-active" | "lease-conflict",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "queued" && task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  if (input.clearLease && !exactLeaseMatches(state.lease, input.clearLease)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-conflict" },
    }
  }

  const interruptedTask = normalizeInterruptedTask(
    task,
    input.errorMessage,
    input.now
  )
  const clearedLease = input.clearLease ? state.lease : null
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, interruptedTask),
      lease: input.clearLease ? null : state.lease,
    },
    changedKeys: input.clearLease ? QUEUE_LEASE_KEYS : QUEUE_KEY,
    result: { outcome: "applied", task: interruptedTask, clearedLease },
  }
}

export function finalizeDownloadTask(
  state: QueueAggregateState,
  input: {
    taskId: string
    chapterOutcomesByIndex: readonly (ChapterDispatchOutcome | undefined)[]
    completedAt: number
    clearLease?: DispatchLeaseAuthority
  }
): QueueKernelDecision<
  | Applied<{
      task: DownloadTaskState
      chapterOutcomes: ChapterDispatchOutcome[]
      completedCount: number
      finalStatus: DownloadTaskState["status"]
      clearedLease: ActiveDispatchLease | null
    }>
  | Rejected<
      "task-not-found" | "task-not-active" | "lease-conflict",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  if (input.clearLease && !exactLeaseMatches(state.lease, input.clearLease)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-conflict" },
    }
  }

  const chapterOutcomes = materializeChapterDispatchOutcomes(
    task,
    input.chapterOutcomesByIndex
  )
  const completedCount = chapterOutcomes.filter(
    (outcome) => outcome.status === "completed"
  ).length
  const failedCount = chapterOutcomes.filter(
    (outcome) => outcome.status === "failed"
  ).length
  const finalStatus = resolveFinalDownloadTaskStatus(chapterOutcomes)
  const firstFailed = chapterOutcomes.find(
    (outcome) => outcome.status === "failed"
  )
  const updatedTask = normalizeDownloadTaskExecutionState({
    ...task,
    status: finalStatus,
    completed: input.completedAt,
    nextChapterDispatchAt: undefined,
    errorMessage:
      failedCount > 0
        ? `Some chapters failed (${completedCount}/${chapterOutcomes.length})`
        : undefined,
    errorCategory:
      firstFailed?.errorCategory ??
      (finalStatus === "failed" || finalStatus === "partial_success"
        ? "unknown"
        : undefined),
  })
  const clearedLease = input.clearLease ? state.lease : null
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updatedTask),
      lease: input.clearLease ? null : state.lease,
    },
    changedKeys: input.clearLease ? QUEUE_LEASE_KEYS : QUEUE_KEY,
    result: {
      outcome: "applied",
      task: updatedTask,
      chapterOutcomes,
      completedCount,
      finalStatus,
      clearedLease,
    },
  }
}

export function retryFailedChapters(
  state: QueueAggregateState,
  input: {
    taskId: string
    retryTaskId: string
    now: number
  }
): QueueKernelDecision<
  | Applied<{ originalTask: DownloadTaskState; retryTask: DownloadTaskState }>
  | Rejected<
      | "task-not-found"
      | "retry-task-id-conflict"
      | "invalid-status"
      | "already-retried"
      | "no-failed-chapters",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  if (state.queue.some((task) => task.id === input.retryTaskId)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "retry-task-id-conflict" },
    }
  }
  const original = state.queue[taskIndex]
  if (original.status !== "partial_success") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "invalid-status",
        currentStatus: original.status,
      },
    }
  }
  if (original.isRetried) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "already-retried" },
    }
  }
  const failedChapters = original.chapters.filter(
    (chapter) =>
      chapter.status === "failed" || chapter.status === "partial_success"
  )
  if (failedChapters.length === 0) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "no-failed-chapters" },
    }
  }

  const originalTask = { ...original, isRetried: true }
  const retryTask: DownloadTaskState = {
    id: input.retryTaskId,
    siteIntegrationId: original.siteIntegrationId,
    mangaId: original.mangaId,
    seriesTitle: original.seriesTitle,
    seriesCoverUrl: original.seriesCoverUrl,
    chapters: failedChapters.map((chapter) => ({
      ...chapter,
      status: "queued",
      errorMessage: undefined,
      totalImages: undefined,
      imagesFailed: undefined,
      outputs: { requested: 0, committed: 0, failed: 0 },
      dispatchAttempt: undefined,
      lastUpdated: input.now,
    })),
    status: "queued",
    created: input.now,
    isRetried: false,
    isRetryTask: true,
    settingsSnapshot: original.settingsSnapshot,
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, originalTask).concat(
        retryTask
      ),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", originalTask, retryTask },
  }
}

export function restartDownloadTask(
  state: QueueAggregateState,
  input: {
    taskId: string
    restartTaskId: string
    now: number
  }
): QueueKernelDecision<
  | Applied<{ originalTask: DownloadTaskState; restartTask: DownloadTaskState }>
  | Rejected<
      | "task-not-found"
      | "restart-task-id-conflict"
      | "invalid-status"
      | "already-retried",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  if (state.queue.some((task) => task.id === input.restartTaskId)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "restart-task-id-conflict" },
    }
  }
  const original = state.queue[taskIndex]
  if (
    original.status !== "failed" &&
    original.status !== "partial_success" &&
    original.status !== "canceled"
  ) {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "invalid-status",
        currentStatus: original.status,
      },
    }
  }
  if (original.isRetried) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "already-retried" },
    }
  }

  const originalTask = { ...original, isRetried: true }
  const restartTask: DownloadTaskState = {
    ...original,
    id: input.restartTaskId,
    chapters: original.chapters.map((chapter) => ({
      ...chapter,
      status: "queued",
      errorMessage: undefined,
      totalImages: undefined,
      imagesFailed: undefined,
      outputs: { requested: 0, committed: 0, failed: 0 },
      dispatchAttempt: undefined,
      lastUpdated: input.now,
    })),
    status: "queued",
    errorMessage: undefined,
    errorCategory: undefined,
    activeBlock: undefined,
    created: input.now,
    started: undefined,
    completed: undefined,
    isRetried: false,
    isRetryTask: true,
    lastSuccessfulDownloadId: undefined,
    nextChapterDispatchAt: undefined,
  }
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, originalTask).concat(
        restartTask
      ),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", originalTask, restartTask },
  }
}

export function moveQueuedTaskToTop(
  state: QueueAggregateState,
  input: { taskId: string }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState; position: number }>
  | Unchanged<{ reason: "already-in-position"; position: number }>
  | Rejected<
      "task-not-found" | "task-not-queued",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "queued") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-queued",
        currentStatus: task.status,
      },
    }
  }
  const position = state.queue.filter(
    (candidate) => candidate.status === "downloading"
  ).length
  if (taskIndex === position) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", reason: "already-in-position", position },
    }
  }

  const queue = [...state.queue]
  queue.splice(taskIndex, 1)
  queue.splice(position, 0, task)
  return {
    next: { ...state, queue },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task, position },
  }
}

export function clearTerminalHistory(
  state: QueueAggregateState
): QueueKernelDecision<
  Applied<{ removedTaskIds: string[] }> | Unchanged<{ removedTaskIds: [] }>
> {
  const removedTaskIds = state.queue
    .filter(isTerminalDownloadTask)
    .map((task) => task.id)
  if (removedTaskIds.length === 0) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", removedTaskIds: [] },
    }
  }
  const removed = new Set(removedTaskIds)
  return {
    next: {
      ...state,
      queue: state.queue.filter((task) => !removed.has(task.id)),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", removedTaskIds },
  }
}

export function cancelDownloadTask(
  state: QueueAggregateState,
  input: { taskId: string; undoToken: string; now: number }
): QueueKernelDecision<
  | Applied<{
      task: DownloadTaskState
      canceledLease: ActiveDispatchLease | null
      undo: PendingUndoReceipt | null
    }>
  | Rejected<
      "task-not-found" | "task-not-active" | "undo-token-conflict",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "queued" && task.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }

  if (task.status === "queued") {
    if (task.activeBlock === "native_output_action_required") {
      // A native-output action-required task cancels through the coordinator's
      // surrender path, NOT ordinary queued Undo: Undo would resurrect a task
      // whose erased native outputs were surrendered and released.
      const canceledTask = cancelDownloadingTask(task, input.now)
      return {
        next: {
          ...state,
          queue: replaceTaskAt(state.queue, taskIndex, canceledTask),
        },
        changedKeys: QUEUE_KEY,
        result: {
          outcome: "applied",
          task: canceledTask,
          canceledLease: null,
          undo: null,
        },
      }
    }
    if (
      state.pendingUndoActions.some(
        (action) => action.token === input.undoToken
      )
    ) {
      return {
        next: state,
        changedKeys: [],
        result: { outcome: "rejected", reason: "undo-token-conflict" },
      }
    }
    const action = createPendingUndoAction({
      token: input.undoToken,
      type: "cancel_queued",
      taskSnapshot: task,
      previousQueuePosition: taskIndex,
      now: input.now,
    })
    return {
      next: {
        ...state,
        queue: state.queue.filter((_candidate, index) => index !== taskIndex),
        pendingUndoActions: [...state.pendingUndoActions, action],
      },
      changedKeys: QUEUE_UNDO_KEYS,
      result: {
        outcome: "applied",
        task,
        canceledLease: null,
        undo: toPendingUndoReceipt(action),
      },
    }
  }

  const canceledLease = state.lease?.taskId === task.id ? state.lease : null
  const canceledTask = cancelDownloadingTask(task, input.now)
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, canceledTask),
      lease: state.lease,
    },
    changedKeys: QUEUE_KEY,
    result: {
      outcome: "applied",
      task: canceledTask,
      canceledLease,
      undo: null,
    },
  }
}

export function removeTerminalDownloadTask(
  state: QueueAggregateState,
  input: { taskId: string; undoToken: string; now: number }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState; undo: PendingUndoReceipt }>
  | Rejected<
      "task-not-found" | "task-not-terminal" | "undo-token-conflict",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (!isTerminalDownloadTask(task)) {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "rejected",
        reason: "task-not-terminal",
        currentStatus: task.status,
      },
    }
  }
  if (
    state.pendingUndoActions.some((action) => action.token === input.undoToken)
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "undo-token-conflict" },
    }
  }
  const action = createPendingUndoAction({
    token: input.undoToken,
    type: "remove_history",
    taskSnapshot: task,
    previousQueuePosition: taskIndex,
    now: input.now,
  })
  return {
    next: {
      ...state,
      queue: state.queue.filter((_candidate, index) => index !== taskIndex),
      pendingUndoActions: [...state.pendingUndoActions, action],
    },
    changedKeys: QUEUE_UNDO_KEYS,
    result: {
      outcome: "applied",
      task,
      undo: toPendingUndoReceipt(action),
    },
  }
}

export function restorePendingUndoAction(
  state: QueueAggregateState,
  input: { token: string; now: number }
): QueueKernelDecision<
  | Applied<{
      action: PendingUndoAction
      restored: boolean
      reason?: "expired"
    }>
  | Rejected<"undo-not-found">
> {
  const actionIndex = state.pendingUndoActions.findIndex(
    (action) => action.token === input.token
  )
  if (actionIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "undo-not-found" },
    }
  }
  const action = state.pendingUndoActions[actionIndex]
  const pendingUndoActions = state.pendingUndoActions.filter(
    (_candidate, index) => index !== actionIndex
  )
  const expired = input.now >= action.expiresAt
  const taskAlreadyPresent = state.queue.some(
    (task) => task.id === action.taskSnapshot.id
  )
  const queue = expired
    ? applyExpiredPendingUndoAction(state.queue, action)
    : reinsertPendingUndoTask(state.queue, action, action.taskSnapshot)
  const queueChanged =
    !taskAlreadyPresent && (!expired || action.type === "cancel_queued")
  return {
    next: {
      ...state,
      queue: queueChanged ? queue : state.queue,
      pendingUndoActions,
    },
    changedKeys: queueChanged ? QUEUE_UNDO_KEYS : UNDO_KEY,
    result: {
      outcome: "applied",
      action,
      restored: !expired,
      ...(expired ? { reason: "expired" as const } : {}),
    },
  }
}

export function finalizePendingUndoAction(
  state: QueueAggregateState,
  input: { token: string }
): QueueKernelDecision<
  Applied<{ action: PendingUndoAction }> | Rejected<"undo-not-found">
> {
  const actionIndex = state.pendingUndoActions.findIndex(
    (action) => action.token === input.token
  )
  if (actionIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "undo-not-found" },
    }
  }
  const action = state.pendingUndoActions[actionIndex]
  const taskAlreadyPresent = state.queue.some(
    (task) => task.id === action.taskSnapshot.id
  )
  const queue = applyExpiredPendingUndoAction(state.queue, action)
  const queueChanged = action.type === "cancel_queued" && !taskAlreadyPresent
  return {
    next: {
      ...state,
      queue: queueChanged ? queue : state.queue,
      pendingUndoActions: state.pendingUndoActions.filter(
        (_candidate, index) => index !== actionIndex
      ),
    },
    changedKeys: queueChanged ? QUEUE_UNDO_KEYS : UNDO_KEY,
    result: { outcome: "applied", action },
  }
}

export function reconcileExpiredPendingUndoActions(
  state: QueueAggregateState,
  input: { now: number }
): QueueKernelDecision<
  | Applied<{ finalized: PendingUndoAction[]; pending: PendingUndoAction[] }>
  | Unchanged<{ finalized: []; pending: PendingUndoAction[] }>
> {
  const { finalized, pending } = partitionPendingUndoActions(
    state.pendingUndoActions,
    input.now
  )
  if (finalized.length === 0) {
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "unchanged",
        finalized: [],
        pending: state.pendingUndoActions,
      },
    }
  }

  let queue: readonly DownloadTaskState[] = state.queue
  let queueChanged = false
  for (const action of finalized) {
    if (
      action.type === "cancel_queued" &&
      !queue.some((task) => task.id === action.taskSnapshot.id)
    ) {
      queue = applyExpiredPendingUndoAction(queue, action)
      queueChanged = true
    }
  }
  return {
    next: {
      ...state,
      queue: queueChanged ? [...queue] : state.queue,
      pendingUndoActions: pending,
    },
    changedKeys: queueChanged ? QUEUE_UNDO_KEYS : UNDO_KEY,
    result: { outcome: "applied", finalized, pending },
  }
}
