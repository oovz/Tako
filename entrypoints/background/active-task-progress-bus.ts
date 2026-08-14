import logger from "@/src/runtime/logger"
import {
  ACTIVE_TASK_PROGRESS_PORT_NAME,
  normalizeActiveTaskProgress,
  type ActiveTaskProgressPortMessage,
  type ActiveTaskProgressSnapshot,
} from "@/src/runtime/active-task-progress"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"

export { ACTIVE_TASK_PROGRESS_PORT_NAME }
export const ACTIVE_TASK_PROGRESS_SNAPSHOT_INTERVAL_MS = 1_000

const connectedPorts = new Set<chrome.runtime.Port>()
const currentGeneration = crypto.randomUUID()
let currentProgress: ActiveTaskProgressSnapshot | null = null
let currentRevision = 0
let hydrated = false
let hydrationPromise: Promise<void> | null = null
let lastPersistedAt = 0
let lastPersistedStage: ActiveTaskProgressSnapshot["stage"] | null = null
let activeProgressMutation = Promise.resolve()
let snapshotWriteChain = Promise.resolve()

export async function runActiveTaskProgressExclusive<T>(
  operation: () => Promise<T>
): Promise<T> {
  const previous = activeProgressMutation
  let release!: () => void
  activeProgressMutation = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

async function hydrateCurrentProgress(): Promise<void> {
  if (hydrated) return
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      try {
        const stored = await chrome.storage.session.get([
          SESSION_STORAGE_KEYS.activeTaskProgress,
          SESSION_STORAGE_KEYS.activeTaskProgressRevision,
        ])
        const hydratedProgress = normalizeActiveTaskProgress(
          stored[SESSION_STORAGE_KEYS.activeTaskProgress]
        )
        currentProgress = hydratedProgress
          ? { ...hydratedProgress, generation: currentGeneration }
          : null
        const storedRevision =
          stored[SESSION_STORAGE_KEYS.activeTaskProgressRevision]
        currentRevision = Math.max(
          hydratedProgress?.revision ?? 0,
          typeof storedRevision === "number" && Number.isInteger(storedRevision)
            ? Math.max(0, storedRevision)
            : 0
        )
      } catch (error) {
        // The Port is the live transport. A missing recovery snapshot must not
        // interrupt an otherwise healthy download.
        logger.debug(
          "Failed to hydrate active progress snapshot (non-fatal):",
          error
        )
        currentProgress = null
        currentRevision = 0
      } finally {
        hydrated = true
      }
    })()
  }
  await hydrationPromise
  hydrationPromise = null
  lastPersistedAt = currentProgress?.updatedAt ?? 0
  lastPersistedStage = currentProgress?.stage ?? null
}

function queueSnapshotWrite(values: Record<string, unknown>): Promise<void> {
  const write = snapshotWriteChain.then(async () => {
    try {
      await chrome.storage.session.set(values)
    } catch (error) {
      logger.debug(
        "Failed to persist active progress snapshot (non-fatal):",
        error
      )
    }
  })
  snapshotWriteChain = write
  return write
}

function postProgressMessage(
  port: chrome.runtime.Port,
  message: ActiveTaskProgressPortMessage
): void {
  try {
    port.postMessage(message)
  } catch (error) {
    connectedPorts.delete(port)
    logger.debug("Dropping disconnected progress Port:", error)
  }
}

function broadcastProgress(message: ActiveTaskProgressPortMessage): void {
  for (const port of connectedPorts) {
    postProgressMessage(port, message)
  }
}

export async function getActiveTaskProgressSnapshot(): Promise<{
  generation: string
  revision: number
  progress: ActiveTaskProgressSnapshot | null
}> {
  await hydrateCurrentProgress()
  return {
    generation: currentGeneration,
    revision: currentRevision,
    progress: currentProgress ? structuredClone(currentProgress) : null,
  }
}

export async function publishActiveTaskProgress(
  progress: Omit<
    ActiveTaskProgressSnapshot,
    "generation" | "revision" | "updatedAt"
  > | null,
  options: { forcePersist?: boolean; now?: number } = {}
): Promise<ActiveTaskProgressSnapshot | null> {
  await hydrateCurrentProgress()
  const now = options.now ?? Date.now()
  const revision = currentRevision + 1
  const nextProgress = progress
    ? {
        ...structuredClone(progress),
        generation: currentGeneration,
        revision,
        updatedAt: now,
      }
    : null
  const stageChanged = nextProgress?.stage !== lastPersistedStage
  const shouldPersist =
    options.forcePersist === true ||
    nextProgress === null ||
    lastPersistedAt === 0 ||
    stageChanged ||
    now - lastPersistedAt >= ACTIVE_TASK_PROGRESS_SNAPSHOT_INTERVAL_MS

  currentRevision = revision
  currentProgress = nextProgress
  broadcastProgress({
    type: "ACTIVE_TASK_PROGRESS",
    generation: currentGeneration,
    revision,
    progress: nextProgress,
  })
  if (shouldPersist) {
    lastPersistedAt = now
    lastPersistedStage = nextProgress?.stage ?? null
    const write = queueSnapshotWrite({
      [SESSION_STORAGE_KEYS.activeTaskProgress]: nextProgress,
      [SESSION_STORAGE_KEYS.activeTaskProgressRevision]: revision,
      [SESSION_STORAGE_KEYS.activeTaskProgressGeneration]: currentGeneration,
    })
    if (options.forcePersist) {
      await write
    }
  }
  return nextProgress ? structuredClone(nextProgress) : null
}

export async function clearActiveTaskProgress(): Promise<void> {
  await runActiveTaskProgressExclusive(async () => {
    await publishActiveTaskProgress(null, { forcePersist: true })
  })
}

export async function settleActiveTaskProgressChapter(input: {
  taskId: string
  chapterId: string
  chapters: Array<{ id: string; status: string }>
  destinationCommitted: boolean
}): Promise<void> {
  await runActiveTaskProgressExclusive(async () => {
    const { progress } = await getActiveTaskProgressSnapshot()
    if (!progress || progress.taskId !== input.taskId) return

    const activeChapters = progress.activeChapters.filter(
      (chapter) => chapter.chapterId !== input.chapterId
    )
    const settledCount = input.chapters.filter(
      (chapter) =>
        chapter.status !== "queued" && chapter.status !== "downloading"
    ).length
    const totalChapters = Math.max(1, input.chapters.length)
    const rawOverallFraction = Math.max(
      progress.overallFraction ?? 0,
      settledCount / totalChapters
    )
    const allChaptersSettled = settledCount >= totalChapters
    const overallFraction =
      input.destinationCommitted && allChaptersSettled
        ? 1
        : Math.min(rawOverallFraction, 0.99)
    const currentChapter = activeChapters.reduce(
      (latest, chapter) =>
        !latest || chapter.updatedAt >= latest.updatedAt ? chapter : latest,
      undefined as (typeof activeChapters)[number] | undefined
    )

    await publishActiveTaskProgress(
      {
        taskId: input.taskId,
        chapterId: currentChapter?.chapterId,
        chapterTitle: currentChapter?.chapterTitle,
        imagesProcessed: activeChapters.reduce(
          (sum, chapter) => sum + chapter.imagesProcessed,
          0
        ),
        totalImages: activeChapters.reduce(
          (sum, chapter) => sum + chapter.totalImages,
          0
        ),
        activeChapterCount: activeChapters.length,
        activeChapters,
        stage:
          currentChapter?.stage ?? (allChaptersSettled ? "saving" : "accepted"),
        phaseFraction:
          currentChapter?.phaseFraction ?? (allChaptersSettled ? 1 : 0),
        overallFraction,
        outputCommitted: input.destinationCommitted,
        status: "downloading",
      },
      { forcePersist: true }
    )
  })
}

export function registerActiveTaskProgressPort(
  port: chrome.runtime.Port
): void {
  connectedPorts.add(port)
  port.onDisconnect.addListener(() => {
    connectedPorts.delete(port)
  })
  void getActiveTaskProgressSnapshot()
    .then(({ generation, revision, progress }) => {
      if (!connectedPorts.has(port)) return
      postProgressMessage(port, {
        type: "ACTIVE_TASK_PROGRESS",
        generation,
        revision,
        progress,
      })
    })
    .catch((error) => {
      logger.debug("Failed to hydrate progress Port snapshot:", error)
    })
}
