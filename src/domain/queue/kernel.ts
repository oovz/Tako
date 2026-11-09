import {
  getEffectiveTaskDestination,
  freshTaskFallbackState,
} from "./task-destination"
import { OFFSCREEN_JOB_LEASE_MS } from "@/src/constants/timeouts"
import type { DownloadErrorCategory } from "@/src/shared/download-contract"
import type { ChapterStatus } from "@/src/types/chapter"
import {
  applyExpiredPendingUndoAction,
  createPendingUndoAction,
  PENDING_UNDO_WINDOW_MS,
  partitionPendingUndoActions,
  reinsertPendingUndoTask,
  toPendingUndoReceipt,
} from "./pending-undo"
import {
  cancelDownloadingTask,
  firstUnsuccessfulChapter,
  isExecutingDownloadTask,
  isRunnableQueuedTask,
  isTerminalChapterStatus,
  isTerminalDownloadTask,
  materializeChapterDispatchOutcomes,
  normalizeDownloadTaskExecutionState,
  normalizeInterruptedTask,
  resolveFinalDownloadTaskStatus,
  resolveTerminalChapterTaskStatus,
  type ChapterDispatchOutcome,
} from "./task-lifecycle"
import type {
  ActiveDispatchLease,
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
  outputDestination?: "downloads-api" | "fsa"
  saveConfirmedAt?: number
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
  lease: DispatchLeaseIdentity | null,
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

function applyTaskReplacement(
  state: QueueAggregateState,
  taskIndex: number,
  task: DownloadTaskState
): QueueKernelDecision<Applied<{ task: DownloadTaskState }>> {
  return {
    next: { ...state, queue: replaceTaskAt(state.queue, taskIndex, task) },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied", task },
  }
}

type ActiveTaskLookup =
  | { taskIndex: number; task: DownloadTaskState }
  | { rejection: TaskMutationRejection }

function findActiveTask(
  state: QueueAggregateState,
  taskId: string
): ActiveTaskLookup {
  const located = findPendingTask(state, taskId)
  if ("rejection" in located || located.task.status === "downloading")
    return located
  return {
    rejection: {
      outcome: "rejected",
      reason: "task-not-active",
      currentStatus: located.task.status,
    },
  }
}

function findPendingTask(
  state: QueueAggregateState,
  taskId: string
): ActiveTaskLookup {
  const taskIndex = state.queue.findIndex((task) => task.id === taskId)
  if (taskIndex === -1) {
    return { rejection: { outcome: "rejected", reason: "task-not-found" } }
  }
  const task = state.queue[taskIndex]
  if (task.status !== "queued" && task.status !== "downloading") {
    return {
      rejection: {
        outcome: "rejected",
        reason: "task-not-active",
        currentStatus: task.status,
      },
    }
  }
  return { taskIndex, task }
}

function findActiveTaskChapter(
  state: QueueAggregateState,
  input: { taskId: string; chapterId: string }
):
  | {
      taskIndex: number
      task: DownloadTaskState
      chapterIndex: number
      chapter: TaskChapter
    }
  | { rejection: TaskMutationRejection | Rejected<"chapter-not-found"> } {
  const located = findActiveTask(state, input.taskId)
  if ("rejection" in located) return located
  const chapterIndex = located.task.chapters.findIndex(
    (chapter) => chapter.id === input.chapterId
  )
  if (chapterIndex === -1) {
    return { rejection: { outcome: "rejected", reason: "chapter-not-found" } }
  }
  return {
    ...located,
    chapterIndex,
    chapter: located.task.chapters[chapterIndex],
  }
}

function observedLeaseMatches(
  lease: ActiveDispatchLease | null,
  observed: DispatchLeaseAuthority | null
): boolean {
  return observed ? exactLeaseMatches(lease, observed) : lease === null
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
    outputDestination: updates.outputDestination ?? chapter.outputDestination,
    saveConfirmedAt: updates.saveConfirmedAt ?? chapter.saveConfirmedAt,
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
    left.outputDestination === right.outputDestination &&
    left.saveConfirmedAt === right.saveConfirmedAt &&
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

function startupOffscreenJobMatches(
  lease: ActiveDispatchLease | null,
  job: StartupOffscreenJobObservation | null
): boolean {
  return (
    lease !== null &&
    job !== null &&
    job.status !== "canceled" &&
    exactLeaseMatches(lease, job)
  )
}

function normalizeStartupTask(
  task: DownloadTaskState,
  now: number
): DownloadTaskState {
  const taskWithCompletion =
    isTerminalDownloadTask(task) && typeof task.completed !== "number"
      ? { ...task, completed: now }
      : task
  return normalizeDownloadTaskExecutionState(taskWithCompletion)
}

function startupTaskDisposition(
  task: DownloadTaskState,
  lease: ActiveDispatchLease | null,
  exactOffscreenJob: boolean,
  nativeOutputTaskIds: ReadonlySet<string>
): "preserve" | "resume" | "interrupt" {
  if (!isExecutingDownloadTask(task)) return "preserve"
  if (nativeOutputTaskIds.has(task.id)) return "preserve"
  if (exactOffscreenJob && lease?.taskId === task.id) return "preserve"
  return lease === null &&
    task.chapters.every((chapter) => chapter.status !== "downloading")
    ? "resume"
    : "interrupt"
}

function recoverStartupTasks(
  state: QueueAggregateState,
  input: StartupRecoveryInput,
  exactOffscreenJob: boolean
) {
  const recoveredTaskIds = new Set<string>()
  const interruptedTaskIds: string[] = []
  const nativeOutputTaskIds = new Set(input.nativeOutputTaskIds)
  let resumeTaskId = exactOffscreenJob ? state.lease?.taskId : undefined
  // Preserve normalization order in the recovery receipt before interrupted tasks.
  const normalized = state.queue.map((task) => {
    const recovered = normalizeStartupTask(task, input.normalizationTime)
    if (recovered !== task) recoveredTaskIds.add(task.id)
    return recovered
  })
  const queue = normalized.map((task) => {
    const disposition = startupTaskDisposition(
      task,
      state.lease,
      exactOffscreenJob,
      nativeOutputTaskIds
    )
    if (disposition === "resume") resumeTaskId ??= task.id
    if (disposition !== "interrupt") return task
    recoveredTaskIds.add(task.id)
    interruptedTaskIds.push(task.id)
    return normalizeInterruptedTask(
      task,
      "Download interrupted",
      input.interruptedAt
    )
  })
  return { queue, recoveredTaskIds, interruptedTaskIds, resumeTaskId }
}

export function recoverQueueAfterStartup(
  state: QueueAggregateState,
  input: StartupRecoveryInput
): QueueKernelDecision<StartupRecoveryResult> {
  const leaseMatches = observedLeaseMatches(state.lease, input.observedLease)
  if (!leaseMatches) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-conflict" },
    }
  }

  const exactOffscreenJob = startupOffscreenJobMatches(
    state.lease,
    input.offscreenJob
  )
  const clearLease = state.lease !== null && !exactOffscreenJob
  const { queue, recoveredTaskIds, interruptedTaskIds, resumeTaskId } =
    recoverStartupTasks(state, input, exactOffscreenJob)

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
  return applyTaskReplacement(state, taskIndex, startedTask)
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
  const located = findActiveTaskChapter(state, input)
  if ("rejection" in located) {
    return { next: state, changedKeys: [], result: located.rejection }
  }
  const { taskIndex, task, chapterIndex, chapter } = located
  if (chapter.status !== "queued" && chapter.status !== "downloading") {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "chapter-not-dispatchable" },
    }
  }

  const previousLeaseMatches = observedLeaseMatches(
    state.lease,
    input.expectedPreviousLease
  )
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

function chapterMutationLeaseMatches(
  lease: ActiveDispatchLease | null,
  chapter: TaskChapter,
  identity: DispatchLeaseAuthority | undefined
): boolean {
  if (identity) return exactLeaseMatches(lease, identity)
  return chapter.status !== "downloading"
}

function chapterRejectsUpdate(
  chapter: TaskChapter,
  input: { status: ChapterStatus; terminalUpdate: boolean }
): boolean {
  return (
    isTerminalChapterStatus(chapter.status) &&
    (input.status !== chapter.status || !input.terminalUpdate)
  )
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
  const located = findActiveTaskChapter(state, input)
  if ("rejection" in located) {
    return { next: state, changedKeys: [], result: located.rejection }
  }
  const { taskIndex, task, chapterIndex, chapter } = located
  if (!chapterMutationLeaseMatches(state.lease, chapter, input.leaseIdentity)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-conflict" },
    }
  }
  if (chapterRejectsUpdate(chapter, input)) {
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
  const located = findActiveTask(state, input.taskId)
  if ("rejection" in located) {
    return { next: state, changedKeys: [], result: located.rejection }
  }
  const { taskIndex, task } = located
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
  return applyTaskReplacement(state, taskIndex, updatedTask)
}

function leaseEventRejection(
  current: ActiveDispatchLease,
  input: Parameters<typeof renewDispatchLease>[1]
):
  | "invalid-activity-time"
  | "stale-sequence"
  | "sequence-conflict"
  | "stage-regression"
  | undefined {
  if (!Number.isFinite(input.activityAt) || input.activityAt < 0)
    return "invalid-activity-time"
  if (input.sequence < current.sequence) return "stale-sequence"
  if (input.sequence === current.sequence) {
    if (current.lastEventSignature !== input.eventSignature)
      return "sequence-conflict"
    if (input.requireSequenceAdvance === true) return "stale-sequence"
  }
  if (STAGE_ORDER[input.stage] < STAGE_ORDER[current.stage])
    return "stage-regression"
  return undefined
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
  if (!current || !exactLeaseMatches(current, input)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-not-current" },
    }
  }
  const rejection = leaseEventRejection(current, input)
  if (rejection) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: rejection },
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
  const located = findActiveTask(state, input.taskId)
  if ("rejection" in located) {
    return { next: state, changedKeys: [], result: located.rejection }
  }
  const { taskIndex, task } = located
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
  return applyTaskReplacement(state, taskIndex, updatedTask)
}

type NativeSettlementInput = Parameters<typeof applyNativeOutputSettlement>[1]
type NativeSettlementOwnershipResult =
  | { outcome: "not_owner"; reason: "task-canceled" | "stale-terminal" }
  | {
      outcome: "conflict"
      reason: "active-attempt-conflict" | "lease-conflict"
    }

function nativeSettlementTotalsValid(input: NativeSettlementInput): boolean {
  return (
    [input.requested, input.completed, input.interrupted].every(
      (count) => Number.isInteger(count) && count >= 0
    ) && input.completed + input.interrupted === input.requested
  )
}

function nativeSettlementMatches(
  existing: NativeOutputSettlement,
  input: NativeSettlementInput
): boolean {
  return (
    baseLeaseMatches(existing, input) &&
    existing.requested === input.requested &&
    existing.completed === input.completed &&
    existing.interrupted === input.interrupted &&
    existing.outputUncertain === input.outputUncertain &&
    existing.errorMessage === input.errorMessage &&
    existing.errorCategory === input.errorCategory &&
    existing.lastSuccessfulDownloadId === input.lastSuccessfulDownloadId
  )
}

function nativeSettlementOwnership(
  lease: ActiveDispatchLease | null,
  task: DownloadTaskState,
  chapter: TaskChapter,
  input: NativeSettlementInput
): NativeSettlementOwnershipResult | undefined {
  if (task.status === "canceled")
    return { outcome: "not_owner", reason: "task-canceled" }
  if (isTerminalDownloadTask(task))
    return { outcome: "not_owner", reason: "stale-terminal" }
  if (chapter.dispatchAttempt !== input.attempt) {
    return isTerminalChapterStatus(chapter.status)
      ? { outcome: "not_owner", reason: "stale-terminal" }
      : { outcome: "conflict", reason: "active-attempt-conflict" }
  }
  if (baseLeaseMatches(lease, input))
    return { outcome: "conflict", reason: "lease-conflict" }
  return undefined
}

function nativeSettlementFailure(
  settlement: NativeOutputSettlement
): Pick<TaskChapter, "errorMessage" | "errorCategory"> {
  if (settlement.outputUncertain) {
    return {
      errorMessage:
        settlement.errorMessage ??
        "Chrome file-save outcome could not be established. Retrying may create duplicates.",
      errorCategory: settlement.errorCategory ?? "browser_output_unconfirmed",
    }
  }
  if (settlement.interrupted === 0)
    return {
      errorMessage: settlement.errorMessage,
      errorCategory: settlement.errorCategory,
    }
  return {
    errorMessage:
      settlement.errorMessage ??
      (settlement.completed > 0
        ? `${settlement.interrupted} output file(s) could not be saved by Chrome.`
        : "Output could not be saved by Chrome."),
    errorCategory: settlement.errorCategory ?? "browser_download_interrupted",
  }
}

function materializeNativeSettledChapter(
  chapter: TaskChapter,
  settlement: NativeOutputSettlement,
  now: number
): TaskChapter {
  const succeeded =
    settlement.requested > 0 && settlement.completed === settlement.requested
  return {
    ...chapter,
    status: succeeded
      ? "completed"
      : settlement.completed > 0
        ? "partial_success"
        : "failed",
    ...(succeeded
      ? { errorMessage: undefined, errorCategory: undefined }
      : nativeSettlementFailure(settlement)),
    outputs: {
      requested: settlement.requested,
      committed: settlement.completed,
      failed: settlement.interrupted,
    },
    nativeOutputSettlement: settlement,
    outputDestination: "downloads-api",
    saveConfirmedAt: succeeded ? now : undefined,
    lastUpdated: Math.max(chapter.lastUpdated, now),
  }
}

function terminalChapterTaskSummary(
  chapters: readonly TaskChapter[]
): Pick<DownloadTaskState, "status" | "errorMessage" | "errorCategory"> {
  const status = resolveTerminalChapterTaskStatus(chapters)
  const allCompleted = status === "completed"
  const failure = firstUnsuccessfulChapter(chapters)
  return {
    status,
    errorMessage: allCompleted ? undefined : failure?.errorMessage,
    errorCategory: allCompleted
      ? undefined
      : (failure?.errorCategory ?? "unknown"),
  }
}

function materializeNativeSettledTask(
  task: DownloadTaskState,
  chapters: TaskChapter[],
  input: NativeSettlementInput
): DownloadTaskState {
  const lastSuccessfulDownloadId =
    input.lastSuccessfulDownloadId !== undefined &&
    (task.lastSuccessfulDownloadId === undefined ||
      input.lastSuccessfulDownloadId > task.lastSuccessfulDownloadId)
      ? input.lastSuccessfulDownloadId
      : task.lastSuccessfulDownloadId
  const allChaptersTerminal = chapters.every((chapter) =>
    isTerminalChapterStatus(chapter.status)
  )
  return {
    ...task,
    chapters,
    lastSuccessfulDownloadId,
    nextChapterDispatchAt: allChaptersTerminal
      ? undefined
      : task.nextChapterDispatchAt,
    ...(allChaptersTerminal
      ? {
          ...terminalChapterTaskSummary(chapters),
          completed: input.now,
          activeBlock: undefined,
        }
      : {}),
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
    outputUncertain?: true
    errorMessage?: string
    errorCategory?: DownloadErrorCategory
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
  if (!nativeSettlementTotalsValid(input)) {
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
    const exactReplay = nativeSettlementMatches(existing, input)
    return {
      next: state,
      changedKeys: [],
      result: exactReplay
        ? { outcome: "already_applied", settlement: existing }
        : { outcome: "conflict", reason: "settlement-conflict" },
    }
  }
  const ownershipResult = nativeSettlementOwnership(
    state.lease,
    task,
    chapter,
    input
  )
  if (ownershipResult)
    return { next: state, changedKeys: [], result: ownershipResult }

  const settlement: NativeOutputSettlement = {
    jobId: input.jobId,
    attempt: input.attempt,
    taskId: input.taskId,
    chapterId: input.chapterId,
    requested: input.requested,
    completed: input.completed,
    interrupted: input.interrupted,
    ...(input.outputUncertain ? { outputUncertain: true } : {}),
    errorMessage: input.errorMessage,
    errorCategory: input.errorCategory,
    lastSuccessfulDownloadId: input.lastSuccessfulDownloadId,
    appliedAt: input.now,
  }
  const updatedChapter = materializeNativeSettledChapter(
    chapter,
    settlement,
    input.now
  )
  const chapters = [...task.chapters]
  chapters[chapterIndex] = updatedChapter
  const updatedTask = materializeNativeSettledTask(task, chapters, input)
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

export function blockTaskForProviderPolicy(
  state: QueueAggregateState,
  input: {
    taskId: string
    block:
      | "provider_network_policy_pending"
      | "provider_network_policy_action_required"
  }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Unchanged<{ reason: "already-blocked" }>
  | TaskMutationRejection
> {
  const located = findPendingTask(state, input.taskId)
  if ("rejection" in located) {
    return { next: state, changedKeys: [], result: located.rejection }
  }
  const { taskIndex, task } = located
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
  return applyTaskReplacement(state, taskIndex, updatedTask)
}

export function releaseProviderPolicyBlock(
  state: QueueAggregateState,
  input: { taskId: string }
): QueueKernelDecision<
  | Applied<{ task: DownloadTaskState }>
  | Unchanged<{ reason: "not-blocked" }>
  | TaskMutationRejection
> {
  const located = findPendingTask(state, input.taskId)
  if ("rejection" in located) {
    return { next: state, changedKeys: [], result: located.rejection }
  }
  const { taskIndex, task } = located
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
  const updatedTask = {
    ...task,
    activeBlock: undefined,
  }
  return applyTaskReplacement(state, taskIndex, updatedTask)
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

type SaveFailureInput = Parameters<typeof failTaskForSave>[1]

function isPendingChapter(chapter: TaskChapter): boolean {
  return chapter.status === "queued" || chapter.status === "downloading"
}

function findSaveFailureChapter(
  task: DownloadTaskState,
  chapterId?: string
): TaskChapter | undefined {
  const failing = chapterId
    ? task.chapters.find((chapter) => chapter.id === chapterId)
    : (task.chapters.find((chapter) => chapter.status === "downloading") ??
      task.chapters.find((chapter) => chapter.status === "queued"))
  return failing && isPendingChapter(failing) ? failing : undefined
}

function saveFailureLeaseMatches(
  lease: ActiveDispatchLease | null,
  task: DownloadTaskState,
  input: SaveFailureInput
): boolean {
  return (
    !input.clearLease ||
    (exactLeaseMatches(lease, input.clearLease) &&
      input.clearLease.taskId === task.id &&
      input.clearLease.chapterId === input.chapterId)
  )
}

function materializeSaveFailureChapter(
  chapter: TaskChapter,
  failing: TaskChapter,
  input: SaveFailureInput
): TaskChapter {
  if (chapter.id !== failing.id) {
    return chapter.status === "queued"
      ? { ...chapter, status: "skipped", lastUpdated: input.now }
      : chapter
  }
  const committed = Math.max(
    failing.outputs?.committed ?? 0,
    input.outputs?.committed ?? 0
  )
  return applyChapterUpdate(
    chapter,
    committed > 0 ? "partial_success" : "failed",
    {
      errorMessage: input.errorMessage,
      errorCategory: input.errorCategory,
      outputs: input.outputs,
      imagesFailed: input.imagesFailed,
      outputDestination: "fsa",
    },
    input.now
  )
}

function materializeSaveFailedTask(
  task: DownloadTaskState,
  failing: TaskChapter,
  input: SaveFailureInput
): DownloadTaskState {
  const chapters = task.chapters.map((chapter) =>
    materializeSaveFailureChapter(chapter, failing, input)
  )
  const failure = firstUnsuccessfulChapter(chapters)
  const hasSavedOutput = chapters.some(
    (chapter) =>
      chapter.status === "completed" || (chapter.outputs?.committed ?? 0) > 0
  )
  return {
    ...task,
    chapters,
    status: hasSavedOutput ? "partial_success" : "failed",
    completed: input.now,
    activeBlock: undefined,
    nextChapterDispatchAt: undefined,
    errorMessage: failure?.errorMessage ?? input.errorMessage,
    errorCategory: failure?.errorCategory ?? input.errorCategory,
  }
}

export function failTaskForSave(
  state: QueueAggregateState,
  input: {
    taskId: string
    chapterId?: string
    errorMessage: string
    errorCategory: DownloadErrorCategory
    now: number
    outputs?: OutputAccounting
    imagesFailed?: number
    clearLease?: DispatchLeaseAuthority
  }
): QueueKernelDecision<
  | Applied<{
      task: DownloadTaskState
      clearedLease: ActiveDispatchLease | null
    }>
  | Rejected<
      | "task-not-found"
      | "task-not-active"
      | "chapter-not-pending"
      | "lease-conflict"
    >
> {
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1)
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  const task = state.queue[taskIndex]
  if (task.status !== "queued" && task.status !== "downloading")
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-active" },
    }
  if (!saveFailureLeaseMatches(state.lease, task, input)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-conflict" },
    }
  }
  const failing = findSaveFailureChapter(task, input.chapterId)
  if (!failing) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "chapter-not-pending" },
    }
  }
  const updated = materializeSaveFailedTask(task, failing, input)
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, taskIndex, updated),
      lease: input.clearLease ? null : state.lease,
    },
    changedKeys: input.clearLease ? QUEUE_LEASE_KEYS : QUEUE_KEY,
    result: {
      outcome: "applied",
      task: updated,
      clearedLease: input.clearLease ? state.lease : null,
    },
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
  const located = findPendingTask(state, input.taskId)
  if ("rejection" in located) {
    return { next: state, changedKeys: [], result: located.rejection }
  }
  const { taskIndex, task } = located
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

function materializeFinalizedTask(
  task: DownloadTaskState,
  chapterOutcomes: readonly ChapterDispatchOutcome[],
  finalStatus: DownloadTaskState["status"],
  completedAt: number
): DownloadTaskState {
  const firstFailed = firstUnsuccessfulChapter(chapterOutcomes)
  return normalizeDownloadTaskExecutionState({
    ...task,
    status: finalStatus,
    completed: completedAt,
    nextChapterDispatchAt: undefined,
    errorMessage: firstFailed?.errorMessage,
    errorCategory:
      firstFailed?.errorCategory ??
      (finalStatus === "failed" || finalStatus === "partial_success"
        ? "unknown"
        : undefined),
  })
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
  const located = findActiveTask(state, input.taskId)
  if ("rejection" in located) {
    return { next: state, changedKeys: [], result: located.rejection }
  }
  const { taskIndex, task } = located
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
  const finalStatus = resolveFinalDownloadTaskStatus(chapterOutcomes)
  const updatedTask = materializeFinalizedTask(
    task,
    chapterOutcomes,
    finalStatus,
    input.completedAt
  )
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

function canRepeatTaskDestination(task: DownloadTaskState): boolean {
  const destination = getEffectiveTaskDestination(task)
  return (
    !task.chapters.some((chapter) => chapter.requestedPath === null) &&
    (destination.kind !== "file-system-access" || destination.handleId !== null)
  )
}

function freshRetryChapter(chapter: TaskChapter, now: number): TaskChapter {
  return {
    ...chapter,
    nativeOutputSettlement: undefined,
    outputDestination: undefined,
    saveConfirmedAt: undefined,
    status: "queued",
    errorMessage: undefined,
    errorCategory: undefined,
    totalImages: undefined,
    imagesFailed: undefined,
    outputs: { requested: 0, committed: 0, failed: 0 },
    dispatchAttempt: undefined,
    lastUpdated: now,
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
  if (state.queue.some((task) => task.id === input.retryTaskId)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "retry-task-id-conflict" },
    }
  }
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
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
  if (!canRepeatTaskDestination(original)) {
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
      chapter.status === "failed" ||
      chapter.status === "partial_success" ||
      chapter.status === "skipped"
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
    ...freshTaskFallbackState(original),
    id: input.retryTaskId,
    siteIntegrationId: original.siteIntegrationId,
    mangaId: original.mangaId,
    seriesTitle: original.seriesTitle,
    seriesCoverUrl: original.seriesCoverUrl,
    chapters: failedChapters.map((chapter) =>
      freshRetryChapter(chapter, input.now)
    ),
    status: "queued",
    created: input.now,
    isRetried: false,
    isRetryTask: true,
    activeCancel: undefined,
    restoredUndo: undefined,
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
  if (state.queue.some((task) => task.id === input.restartTaskId)) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "restart-task-id-conflict" },
    }
  }
  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
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
  if (!canRepeatTaskDestination(original)) {
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
    fsaFallbackEligible: undefined,
    ...freshTaskFallbackState(original),
    id: input.restartTaskId,
    chapters: original.chapters.map((chapter) =>
      freshRetryChapter(chapter, input.now)
    ),
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
    activeCancel: undefined,
    restoredUndo: undefined,
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

/** Replace queued positions atomically only while the caller's order is current. */
export function reorderQueuedTasks(
  state: QueueAggregateState,
  input: { expectedTaskIds: string[]; taskIds: string[] }
): QueueKernelDecision<
  Applied | Unchanged | Rejected<"stale-order" | "invalid-order">
> {
  const queued = state.queue.filter((task) => task.status === "queued")
  if (
    queued.length !== input.expectedTaskIds.length ||
    queued.some((task, index) => task.id !== input.expectedTaskIds[index])
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "stale-order" },
    }
  }
  const byId = new Map(queued.map((task) => [task.id, task]))
  if (
    input.taskIds.length !== queued.length ||
    new Set(input.taskIds).size !== queued.length ||
    input.taskIds.some((id) => !byId.has(id))
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "invalid-order" },
    }
  }
  if (queued.every((task, index) => task.id === input.taskIds[index])) {
    return { next: state, changedKeys: [], result: { outcome: "unchanged" } }
  }
  const ordered = input.taskIds.map((id) => byId.get(id)!)
  let index = 0
  return {
    next: {
      ...state,
      queue: state.queue.map((task) =>
        task.status === "queued" ? ordered[index++] : task
      ),
    },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied" },
  }
}

export function renewPendingUndoAction(
  state: QueueAggregateState,
  input: { token: string; now: number }
): QueueKernelDecision<
  Applied<{ undo: PendingUndoReceipt }> | Rejected<"undo-expired">
> {
  const action = state.pendingUndoActions.find(
    (item) => item.token === input.token
  )
  if (!action || action.expiresAt <= input.now) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "undo-expired" },
    }
  }
  const renewed = { ...action, expiresAt: input.now + PENDING_UNDO_WINDOW_MS }
  return {
    next: {
      ...state,
      pendingUndoActions: state.pendingUndoActions.map((item) =>
        item === action ? renewed : item
      ),
    },
    changedKeys: UNDO_KEY,
    result: { outcome: "applied", undo: toPendingUndoReceipt(renewed) },
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

function replayQueuedCancellation(
  state: QueueAggregateState,
  action: PendingUndoAction,
  taskId: string
): QueueKernelDecision<
  | Unchanged<{
      reason: "already-canceled"
      task: DownloadTaskState
      canceledLease: null
      undo: PendingUndoReceipt
    }>
  | Rejected<"undo-token-conflict">
> {
  if (action.type !== "cancel_queued" || action.taskSnapshot.id !== taskId) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "undo-token-conflict" },
    }
  }
  return {
    next: state,
    changedKeys: [],
    result: {
      outcome: "unchanged",
      reason: "already-canceled",
      task: action.taskSnapshot,
      canceledLease: null,
      undo: toPendingUndoReceipt(action),
    },
  }
}

function leaseOwnedByTask(
  state: QueueAggregateState,
  taskId: string
): ActiveDispatchLease | null {
  return state.lease?.taskId === taskId ? state.lease : null
}

export function cancelDownloadTask(
  state: QueueAggregateState,
  input: {
    taskId: string
    commandId: string
    now: number
  }
): QueueKernelDecision<
  | Applied<{
      task: DownloadTaskState
      canceledLease: ActiveDispatchLease | null
      undo: PendingUndoReceipt | null
    }>
  | Unchanged<{
      reason: "already-canceled"
      task: DownloadTaskState
      canceledLease: ActiveDispatchLease | null
      undo: null
    }>
  | Unchanged<{
      reason: "already-canceled"
      task: DownloadTaskState
      canceledLease: null
      undo: PendingUndoReceipt
    }>
  | Rejected<
      "task-not-found" | "task-not-active" | "undo-token-conflict",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const undoToken = `cancel:${input.commandId}`
  const existingUndo = state.pendingUndoActions.find(
    (action) => action.token === undoToken
  )
  if (existingUndo) {
    return replayQueuedCancellation(state, existingUndo, input.taskId)
  }

  const taskIndex = state.queue.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "task-not-found" },
    }
  }
  const task = state.queue[taskIndex]
  if (task.activeCancel?.commandId === input.commandId) {
    const canceledLease = leaseOwnedByTask(state, task.id)
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "unchanged",
        reason: "already-canceled",
        task,
        canceledLease,
        undo: null,
      },
    }
  }
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
    const action = createPendingUndoAction({
      token: undoToken,
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

  const canceledLease = leaseOwnedByTask(state, task.id)
  const canceledTask = {
    ...cancelDownloadingTask(task, input.now),
    activeCancel: { commandId: input.commandId },
  }
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
  | Unchanged<{
      reason: "already-removed"
      task: DownloadTaskState
      undo: PendingUndoReceipt
    }>
  | Rejected<
      "task-not-found" | "task-not-terminal" | "undo-token-conflict",
      { currentStatus?: DownloadTaskState["status"] }
    >
> {
  const existingUndo = state.pendingUndoActions.find(
    (action) => action.token === input.undoToken
  )
  if (existingUndo) {
    if (
      existingUndo.type !== "remove_history" ||
      existingUndo.taskSnapshot.id !== input.taskId
    ) {
      return {
        next: state,
        changedKeys: [],
        result: { outcome: "rejected", reason: "undo-token-conflict" },
      }
    }
    return {
      next: state,
      changedKeys: [],
      result: {
        outcome: "unchanged",
        reason: "already-removed",
        task: existingUndo.taskSnapshot,
        undo: toPendingUndoReceipt(existingUndo),
      },
    }
  }

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

function restoreUndoQueue(
  queue: DownloadTaskState[],
  action: PendingUndoAction,
  expired: boolean
): { queue: DownloadTaskState[]; queueChanged: boolean } {
  const existingTaskIndex = queue.findIndex(
    (task) => task.id === action.taskSnapshot.id
  )
  if (expired) {
    return {
      queue: applyExpiredPendingUndoAction(queue, action),
      queueChanged: existingTaskIndex === -1 && action.type === "cancel_queued",
    }
  }
  const restoredUndo = { token: action.token, type: action.type }
  if (existingTaskIndex === -1) {
    return {
      queue: reinsertPendingUndoTask(queue, action, {
        ...action.taskSnapshot,
        restoredUndo,
      }),
      queueChanged: true,
    }
  }
  const existingTask = queue[existingTaskIndex]
  if (
    existingTask.restoredUndo?.token === action.token &&
    existingTask.restoredUndo.type === action.type
  ) {
    return { queue, queueChanged: false }
  }
  return {
    queue: replaceTaskAt(queue, existingTaskIndex, {
      ...existingTask,
      restoredUndo,
    }),
    queueChanged: true,
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
  | Unchanged<{
      type: PendingUndoAction["type"]
      restored: true
      reason: "already-restored"
    }>
  | Rejected<"undo-not-found">
> {
  const actionIndex = state.pendingUndoActions.findIndex(
    (action) => action.token === input.token
  )
  if (actionIndex === -1) {
    const restoredTask = state.queue.find(
      (task) => task.restoredUndo?.token === input.token
    )
    if (restoredTask?.restoredUndo) {
      return {
        next: state,
        changedKeys: [],
        result: {
          outcome: "unchanged",
          type: restoredTask.restoredUndo.type,
          restored: true,
          reason: "already-restored",
        },
      }
    }
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
  const { queue, queueChanged } = restoreUndoQueue(state.queue, action, expired)
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
  input: { token: string; now?: number }
): QueueKernelDecision<
  | Applied<{ action: PendingUndoAction }>
  | Unchanged<{ action: PendingUndoAction }>
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
  if (input.now !== undefined && action.expiresAt > input.now) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "unchanged", action },
    }
  }
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

function taskOwnsChapterDispatch(
  state: QueueAggregateState,
  task: DownloadTaskState,
  identity: DispatchLeaseAuthority
): boolean {
  return (
    task.status === "downloading" &&
    !task.activeCancel &&
    task.id === identity.taskId &&
    task.chapters.some(
      (chapter) =>
        chapter.id === identity.chapterId && chapter.status === "downloading"
    ) &&
    exactLeaseMatches(state.lease, identity)
  )
}

function currentFsaProducerMatches(
  state: QueueAggregateState,
  task: DownloadTaskState,
  identity: DispatchLeaseAuthority
): boolean {
  const destination = getEffectiveTaskDestination(task)
  return (
    taskOwnsChapterDispatch(state, task, identity) &&
    state.lease?.saveMode === "fsa" &&
    destination.kind === "file-system-access" &&
    destination.handleId === state.lease.destinationHandleId
  )
}

function automaticFallbackAvailable(task: DownloadTaskState): boolean {
  return (
    (task.status === "queued" || task.status === "downloading") &&
    !task.activeCancel &&
    task.fsaFallbackEligible === true &&
    task.settingsSnapshot.allowChromeFallback === true &&
    getEffectiveTaskDestination(task).kind === "file-system-access"
  )
}

/** Durably close the automatic-switch window before the producer mutates a folder. */
export function beginFsaWrite(
  state: QueueAggregateState,
  input: FullDispatchLeaseIdentity
): QueueKernelDecision<Applied | Unchanged | Rejected<"lease-not-current">> {
  const index = state.queue.findIndex((task) => task.id === input.taskId)
  const task = state.queue[index]
  if (
    !task ||
    !currentFsaProducerMatches(state, task, input) ||
    task.settingsSnapshot.allowChromeFallback !== true
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "lease-not-current" },
    }
  }
  if (!task.fsaFallbackEligible)
    return { next: state, changedKeys: [], result: { outcome: "unchanged" } }
  const nextTask = { ...task }
  delete nextTask.fsaFallbackEligible
  return {
    next: { ...state, queue: replaceTaskAt(state.queue, index, nextTask) },
    changedKeys: QUEUE_KEY,
    result: { outcome: "applied" },
  }
}

/** Select Chrome only at a known destination failure with no admitted producer remaining. */
export function selectChromeFallback(
  state: QueueAggregateState,
  input: {
    taskId: string
    terminalLease?: FullDispatchLeaseIdentity
    now: number
  }
): QueueKernelDecision<Applied | Rejected<"fallback-unavailable">> {
  const index = state.queue.findIndex((task) => task.id === input.taskId)
  const task = state.queue[index]
  if (
    !task ||
    !automaticFallbackAvailable(task) ||
    (input.terminalLease
      ? !currentFsaProducerMatches(state, task, input.terminalLease)
      : state.lease !== null)
  ) {
    return {
      next: state,
      changedKeys: [],
      result: { outcome: "rejected", reason: "fallback-unavailable" },
    }
  }
  const nextTask: DownloadTaskState = {
    ...task,
    useChromeFallback: true,
    status: "queued",
    chapters: task.chapters.map((chapter) =>
      chapter.status === "downloading"
        ? { ...chapter, status: "queued", lastUpdated: input.now }
        : chapter
    ),
  }
  delete nextTask.fsaFallbackEligible
  return {
    next: {
      ...state,
      queue: replaceTaskAt(state.queue, index, nextTask),
      lease: input.terminalLease ? null : state.lease,
    },
    changedKeys: input.terminalLease ? QUEUE_LEASE_KEYS : QUEUE_KEY,
    result: { outcome: "applied" },
  }
}
