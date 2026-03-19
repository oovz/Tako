import logger from '@/src/runtime/logger'
import { projectToQueueView } from '@/entrypoints/background/projection'
import { normalizeInterruptedTask } from '@/entrypoints/background/task-lifecycle'
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import type { DownloadTaskState } from '@/src/types/queue-state'

interface InitializeFromStorageDependencies {
  readQueue: () => Promise<DownloadTaskState[]>
  writeQueue: (queue: DownloadTaskState[]) => Promise<void>
  writeSession: (values: Record<string, unknown>) => Promise<void>
  applyQueue: (queue: DownloadTaskState[]) => Promise<void>
  getOffscreenContexts: () => Promise<unknown[]>
  ensureLivenessAlarm: () => Promise<void>
  resumeQueue: () => Promise<void>
}

export interface InitializeFromStorageResult {
  queue: DownloadTaskState[]
  initFailed: boolean
  error?: string
}

function findNextQueued(queue: DownloadTaskState[]): DownloadTaskState | undefined {
  return queue
    .filter((task) => task.status === 'queued')
    .sort((a, b) => a.created - b.created)[0]
}

function hasActiveDownloadingTask(queue: DownloadTaskState[]): boolean {
  return queue.some((task) => task.status === 'downloading')
}

function shouldPreferLatestQueueSnapshot(
  initialQueue: DownloadTaskState[],
  normalizedQueue: DownloadTaskState[],
  latestQueue: DownloadTaskState[],
): boolean {
  return initialQueue.length === 0 && normalizedQueue.length === 0 && latestQueue.length > 0
}

export async function initializeFromStorage(
  dependencies: InitializeFromStorageDependencies,
): Promise<InitializeFromStorageResult> {
  const {
    readQueue,
    writeQueue,
    writeSession,
    applyQueue,
    getOffscreenContexts,
    ensureLivenessAlarm,
    resumeQueue,
  } = dependencies

  try {
    const hydratedQueue = await readQueue()
    const contexts = await getOffscreenContexts()
    const offscreenAlive = contexts.length > 0

    let normalizedQueue = hydratedQueue

    if (!offscreenAlive) {
      const hadZombieTask = hydratedQueue.some((task) => task.status === 'downloading')
      if (hadZombieTask) {
        const interruptedAt = Date.now()
        normalizedQueue = hydratedQueue.map((task) =>
          task.status === 'downloading'
            ? normalizeInterruptedTask(task, 'Download interrupted', interruptedAt)
            : task,
        )

        await writeQueue(normalizedQueue)
        await writeSession({ [SESSION_STORAGE_KEYS.activeTaskProgress]: null })
      }
    }

    const latestPersistedQueue = await readQueue()
    if (shouldPreferLatestQueueSnapshot(hydratedQueue, normalizedQueue, latestPersistedQueue)) {
      normalizedQueue = latestPersistedQueue
    }

    await applyQueue(normalizedQueue)

    const projection = projectToQueueView(normalizedQueue)
    await writeSession({
      [SESSION_STORAGE_KEYS.queueView]: projection.queueView,
      [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
      [SESSION_STORAGE_KEYS.initFailed]: false,
      [SESSION_STORAGE_KEYS.initError]: null,
    })

    await ensureLivenessAlarm()

    const nextQueuedTask = findNextQueued(normalizedQueue)
    if (nextQueuedTask && !hasActiveDownloadingTask(normalizedQueue)) {
      await resumeQueue()
    }

    return {
      queue: normalizedQueue,
      initFailed: false,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Extension initialization failed'
    logger.error('initializeFromStorage failed', error)

    await writeSession({
      [SESSION_STORAGE_KEYS.queueView]: [],
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

