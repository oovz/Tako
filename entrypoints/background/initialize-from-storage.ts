import logger from "@/src/runtime/logger"
import { projectToQueueView } from "@/src/runtime/projection"
import { normalizeInterruptedTask } from "@/entrypoints/background/task-lifecycle"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { DownloadTaskState } from "@/src/types/queue-state"
import type { ActiveDispatchLease } from "@/src/types/queue-state"
import type { OffscreenJobState } from "@/src/types/offscreen-messages"
import { notifyTerminalDownloadTask } from "@/entrypoints/background/download-queue-finalization"
import {
  isExecutingDownloadTask,
  isRunnableQueuedTask,
  normalizeDownloadTaskExecutionState,
} from "@/src/runtime/download-task-execution-state"

interface InitializeFromStorageDependencies {
  readQueue: () => Promise<DownloadTaskState[]>
  writeQueue: (queue: DownloadTaskState[]) => Promise<void>
  writeSession: (values: Record<string, unknown>) => Promise<void>
  applyQueue: (queue: DownloadTaskState[]) => Promise<void>
  getOffscreenContexts: () => Promise<unknown[]>
  getOffscreenActiveTaskIds: () => Promise<string[]>
  hasOffscreenDocument?: () => Promise<boolean>
  getOffscreenJobState?: () => Promise<OffscreenJobState | null>
  getActiveDispatchLease?: () => Promise<ActiveDispatchLease | null>
  clearActiveDispatchLease?: (identity: {
    jobId: string
    attempt: number
  }) => Promise<boolean>
  releasePendingOutputJob?: (jobId: string) => Promise<void>
  hasReconcilablePendingOutputs?: (task: DownloadTaskState) => boolean
  hasPendingOutputWork?: () => boolean
  setLivenessAlarmArmed?: (shouldArm: boolean) => Promise<void>
  ensureLivenessAlarm: () => Promise<void>
}

export type StartupQueueActivation =
  { kind: "resume-task"; taskId: string } | { kind: "process-queue" }

export interface InitializeFromStorageResult {
  queue: DownloadTaskState[]
  initFailed: boolean
  queueActivation?: StartupQueueActivation
  error?: string
}

function findNextQueued(
  queue: DownloadTaskState[]
): DownloadTaskState | undefined {
  return queue.find(isRunnableQueuedTask)
}

function hasActiveDownloadingTask(queue: DownloadTaskState[]): boolean {
  return queue.some(isExecutingDownloadTask)
}

function shouldPreferLatestQueueSnapshot(
  initialQueue: DownloadTaskState[],
  normalizedQueue: DownloadTaskState[],
  latestQueue: DownloadTaskState[]
): boolean {
  return (
    initialQueue.length === 0 &&
    normalizedQueue.length === 0 &&
    latestQueue.length > 0
  )
}

export async function initializeFromStorage(
  dependencies: InitializeFromStorageDependencies
): Promise<InitializeFromStorageResult> {
  const {
    readQueue,
    writeQueue,
    writeSession,
    applyQueue,
    getOffscreenContexts,
    getOffscreenActiveTaskIds,
    ensureLivenessAlarm,
  } = dependencies

  try {
    const hydratedQueue = await readQueue()
    const offscreenAlive = dependencies.hasOffscreenDocument
      ? await dependencies.hasOffscreenDocument()
      : (await getOffscreenContexts()).length > 0
    const exactJobState =
      offscreenAlive && dependencies.getOffscreenJobState
        ? await dependencies.getOffscreenJobState()
        : null
    const activeLease = dependencies.getActiveDispatchLease
      ? await dependencies.getActiveDispatchLease()
      : null
    const offscreenActiveTaskIds =
      exactJobState?.status === "active"
        ? [exactJobState.taskId]
        : offscreenAlive
          ? [...new Set(await getOffscreenActiveTaskIds())].sort(
              (left, right) => left.localeCompare(right)
            )
          : []

    const normalizationTime = Date.now()
    let normalizedQueue = hydratedQueue.map((task) => {
      const taskWithCompletion =
        task.status !== "queued" &&
        task.status !== "downloading" &&
        typeof task.completed !== "number"
          ? { ...task, completed: normalizationTime }
          : task
      return normalizeDownloadTaskExecutionState(taskWithCompletion)
    })
    let queueChanged = normalizedQueue.some(
      (task, index) => task !== hydratedQueue[index]
    )

    let activeTaskToResume: string | undefined
    let recoveredActiveTaskId: string | undefined
    const interruptedTaskIds = new Set<string>()
    const hadZombieTask = normalizedQueue.some(isExecutingDownloadTask)
    if (hadZombieTask) {
      const downloadingTasks = normalizedQueue.filter(isExecutingDownloadTask)
      const exactLifecycleEnabled =
        dependencies.getOffscreenJobState !== undefined &&
        dependencies.getActiveDispatchLease !== undefined
      const exactJobMatches =
        downloadingTasks.length === 1 &&
        activeLease !== null &&
        exactJobState !== null &&
        activeLease.jobId === exactJobState.jobId &&
        activeLease.attempt === exactJobState.attempt &&
        activeLease.taskId === exactJobState.taskId &&
        activeLease.chapterId === exactJobState.chapterId &&
        downloadingTasks[0]?.id === activeLease.taskId

      const exactLeaseChapter =
        downloadingTasks.length === 1 && activeLease
          ? downloadingTasks[0].chapters.find(
              (chapter) => chapter.id === activeLease.chapterId
            )
          : undefined
      const exactLeaseChapterIsTerminal =
        exactLeaseChapter !== undefined &&
        exactLeaseChapter.status !== "queued" &&
        exactLeaseChapter.status !== "downloading"

      if (
        exactLifecycleEnabled &&
        exactJobMatches &&
        exactJobState?.status === "terminal" &&
        exactLeaseChapterIsTerminal
      ) {
        await dependencies.releasePendingOutputJob?.(activeLease.jobId)
        await dependencies.clearActiveDispatchLease?.({
          jobId: activeLease.jobId,
          attempt: activeLease.attempt,
        })
        activeTaskToResume = activeLease.taskId
      } else if (exactLifecycleEnabled && exactJobMatches) {
        recoveredActiveTaskId = activeLease.taskId
      } else if (
        exactLifecycleEnabled &&
        downloadingTasks.length === 1 &&
        dependencies.hasReconcilablePendingOutputs?.(downloadingTasks[0])
      ) {
        // Chrome owns an identity-bound output that can still complete. Keep
        // observing it instead of replaying the chapter or sweeping the task.
        recoveredActiveTaskId = undefined
      } else if (
        exactLifecycleEnabled &&
        downloadingTasks.length === 1 &&
        downloadingTasks[0].chapters.every(
          (chapter) => chapter.status !== "downloading"
        )
      ) {
        if (activeLease?.taskId === downloadingTasks[0].id) {
          await dependencies.releasePendingOutputJob?.(activeLease.jobId)
          await dependencies.clearActiveDispatchLease?.({
            jobId: activeLease.jobId,
            attempt: activeLease.attempt,
          })
        }
        // The prior chapter was durably settled before the worker stopped.
        // Resume only the queue/finalization path; no job replay is required.
        activeTaskToResume = downloadingTasks[0].id
      } else if (
        !exactLifecycleEnabled &&
        offscreenAlive &&
        downloadingTasks.length === 1 &&
        offscreenActiveTaskIds.length === 1 &&
        offscreenActiveTaskIds[0] === downloadingTasks[0]?.id
      ) {
        // Compatibility branch for unit-test and migration callers that have
        // not yet supplied the exact job protocol.
        recoveredActiveTaskId = downloadingTasks[0].id
      } else if (
        !exactLifecycleEnabled &&
        offscreenAlive &&
        offscreenActiveTaskIds.length === 0
      ) {
        activeTaskToResume = downloadingTasks[0]?.id
      } else {
        if (activeLease) {
          await dependencies.releasePendingOutputJob?.(activeLease.jobId)
          await dependencies.clearActiveDispatchLease?.({
            jobId: activeLease.jobId,
            attempt: activeLease.attempt,
          })
        }
        const interruptedAt = Date.now()
        const reason = "Download interrupted"
        for (const task of normalizedQueue) {
          if (task.status === "downloading") interruptedTaskIds.add(task.id)
        }
        normalizedQueue = normalizedQueue.map((task) =>
          task.status === "downloading"
            ? normalizeInterruptedTask(task, reason, interruptedAt)
            : task
        )
        queueChanged = true
        await writeSession({ [SESSION_STORAGE_KEYS.activeTaskProgress]: null })
        logger.warn("Startup recovery normalized an unreconciled job", {
          persistedTaskIds: downloadingTasks.map((task) => task.id),
          lease: activeLease,
          offscreenJob: exactJobState,
        })
      }
    } else if (activeLease) {
      // A terminal task commit and lease deletion are separate storage writes.
      // If the service worker stopped between them, remove the orphan before a
      // queued task attempts the single-dispatch compare-and-swap.
      await dependencies.releasePendingOutputJob?.(activeLease.jobId)
      await dependencies.clearActiveDispatchLease?.({
        jobId: activeLease.jobId,
        attempt: activeLease.attempt,
      })
    }

    if (queueChanged) {
      await writeQueue(normalizedQueue)
    }

    const latestPersistedQueue = await readQueue()
    if (
      shouldPreferLatestQueueSnapshot(
        hydratedQueue,
        normalizedQueue,
        latestPersistedQueue
      )
    ) {
      normalizedQueue = latestPersistedQueue
    }

    await applyQueue(normalizedQueue)

    for (const task of normalizedQueue) {
      if (!interruptedTaskIds.has(task.id)) continue
      await notifyTerminalDownloadTask({
        task,
        finalStatus: task.status,
        completedCount: task.chapters.filter(
          (chapter) => chapter.status === "completed"
        ).length,
        totalChapters: task.chapters.length,
      })
    }

    const projection = projectToQueueView(normalizedQueue)
    await writeSession({
      [SESSION_STORAGE_KEYS.queueView]: projection.queueView,
      [SESSION_STORAGE_KEYS.historyView]: projection.historyView,
      [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
      [SESSION_STORAGE_KEYS.initFailed]: false,
      [SESSION_STORAGE_KEYS.initError]: null,
    })

    const hasOffscreenExecutingTask = normalizedQueue.some(
      (task) =>
        isExecutingDownloadTask(task) && task.browserDownloadWait === undefined
    )
    const hasOffscreenDispatchLease =
      activeLease !== null &&
      !normalizedQueue.some(
        (task) => task.id === activeLease.taskId && task.browserDownloadWait
      )
    const hasDurableActiveWork =
      hasOffscreenExecutingTask ||
      hasOffscreenDispatchLease ||
      offscreenActiveTaskIds.length > 0
    if (dependencies.setLivenessAlarmArmed) {
      await dependencies.setLivenessAlarmArmed(hasDurableActiveWork)
    } else {
      // Compatibility for callers that have not adopted conditional arming.
      await ensureLivenessAlarm()
    }

    const nextQueuedTask = findNextQueued(normalizedQueue)
    const queueActivation: StartupQueueActivation | undefined =
      recoveredActiveTaskId
        ? { kind: "resume-task", taskId: recoveredActiveTaskId }
        : activeTaskToResume
          ? { kind: "resume-task", taskId: activeTaskToResume }
          : nextQueuedTask &&
              !hasActiveDownloadingTask(normalizedQueue) &&
              offscreenActiveTaskIds.length === 0
            ? { kind: "process-queue" }
            : undefined

    return {
      queue: normalizedQueue,
      initFailed: false,
      queueActivation,
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Extension initialization failed"
    logger.error("initializeFromStorage failed", error)

    await writeSession({
      [SESSION_STORAGE_KEYS.queueView]: [],
      [SESSION_STORAGE_KEYS.historyView]: [],
      [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
      [SESSION_STORAGE_KEYS.initFailed]: true,
      [SESSION_STORAGE_KEYS.initError]: errorMessage,
    })

    return {
      queue: [],
      initFailed: true,
      error: errorMessage,
    }
  }
}
