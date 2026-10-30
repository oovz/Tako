import logger from "@/src/runtime/logger"
import { KeyedSerialExecutor } from "@/src/runtime/keyed-serial-executor"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import {
  getActiveTaskProgressSnapshot,
  publishActiveTaskProgress,
  runActiveTaskProgressExclusive,
} from "./active-task-progress-bus"
import { progressTimingEstimatesRepository as progressTimingEstimator } from "@/src/storage/progress-timing-estimates-repository"
import {
  readOffscreenProgress,
  readActiveChapterMap,
  type AcceptedOffscreenProgress,
} from "./offscreen-progress-handler-normalization"
import {
  resolveDestinationProgress,
  shouldPersistChapterProgress,
  updateActiveChapterMap,
  normalizeActiveChapters,
  createTaskProgressProjection,
} from "./offscreen-progress-handler-projection"

type ProgressResponse = RuntimeMessageResponse<"OFFSCREEN_DOWNLOAD_PROGRESS">
type TaskChapter = DownloadTaskState["chapters"][number]

const progressJobs = new KeyedSerialExecutor()

function rejectedRenewalDisposition(
  reason: string
): "stale_or_reordered" | "lease_not_current" | "protocol_error" {
  if (reason === "stale-sequence") return "stale_or_reordered"
  return reason === "lease-not-current" ? "lease_not_current" : "protocol_error"
}

async function renewProgressLease(
  stateManager: QueueRepository,
  progress: AcceptedOffscreenProgress
): Promise<ProgressResponse | undefined> {
  const { jobId, taskId, chapterId, attempt, sequence, stage, payload } =
    progress
  const renewal = await stateManager.renewDispatchLease({
    jobId,
    taskId,
    chapterId,
    attempt,
    fingerprint: payload.fingerprint,
    documentInstanceId: payload.documentInstanceId,
    eventSignature: JSON.stringify(payload),
    stage,
    sequence,
    activityAt: Date.now(),
  })
  if (renewal.outcome === "rejected") {
    logger.debug("Ignoring progress for stale or unknown job", {
      jobId,
      attempt,
      sequence,
    })
    return {
      success: true,
      disposition: rejectedRenewalDisposition(renewal.reason),
    }
  }
  if (renewal.outcome === "unchanged")
    return { success: true, disposition: "stale_or_reordered" }
  return undefined
}

async function persistChapterProgress(
  stateManager: QueueRepository,
  progress: AcceptedOffscreenProgress,
  chapter: TaskChapter
): Promise<boolean> {
  if (!shouldPersistChapterProgress(progress, chapter)) return true
  const { taskId, chapterId, jobId, attempt, payload, status } = progress
  const isFailure = status === "failed" || status === "partial_success"
  const update = await stateManager.updateChapterProgress({
    taskId,
    chapterId,
    lease: {
      jobId,
      attempt,
      taskId,
      chapterId,
      fingerprint: payload.fingerprint,
      documentInstanceId: payload.documentInstanceId,
    },
    now: Date.now(),
    updates: {
      totalImages: progress.totalImages,
      imagesFailed: progress.imagesFailed,
      errorMessage: isFailure ? progress.errorMessage : undefined,
      errorCategory: isFailure
        ? (progress.errorCategory ?? "unknown")
        : undefined,
    },
  })
  if (update.outcome !== "rejected") return true
  logger.debug(
    `Ignoring OFFSCREEN_DOWNLOAD_PROGRESS after parent task transition: ${taskId}`,
    update
  )
  return false
}

async function publishProgressProjection(
  stateManager: QueueRepository,
  progress: AcceptedOffscreenProgress,
  task: DownloadTaskState,
  chapter: TaskChapter
) {
  const destination = resolveDestinationProgress(progress, task)
  const phaseCosts = await progressTimingEstimator.observe({
    jobId: progress.jobId,
    stage: progress.stage,
    context: {
      integrationId: task.siteIntegrationId,
      archiveFormat: task.settingsSnapshot.archiveFormat,
      destination: destination.destination,
    },
  })
  await runActiveTaskProgressExclusive(async () => {
    const stored = await getActiveTaskProgressSnapshot()
    const chapters = readActiveChapterMap(stored.progress, progress.taskId)
    updateActiveChapterMap(chapters, progress, chapter, destination.committed)
    const activeChapters = [...chapters.values()].sort((left, right) =>
      left.chapterId.localeCompare(right.chapterId)
    )
    const taskAfterUpdate = await stateManager.getTask(progress.taskId)
    const normalized = normalizeActiveChapters({
      activeChapters,
      taskChapters: taskAfterUpdate?.chapters ?? [],
    })
    const projection = createTaskProgressProjection(
      progress,
      taskAfterUpdate,
      normalized,
      stored.progress,
      phaseCosts,
      destination.committed
    )
    await publishActiveTaskProgress(projection, {
      forcePersist: projection === null || destination.terminal,
    })
  })
  if (destination.terminal && !destination.awaitingNativeCommit)
    await progressTimingEstimator.finish(progress.jobId)
}

async function applyCurrentProgress(
  stateManager: QueueRepository,
  progress: AcceptedOffscreenProgress
): Promise<ProgressResponse> {
  const renewalResponse = await renewProgressLease(stateManager, progress)
  if (renewalResponse) return renewalResponse
  const task = await stateManager.getTask(progress.taskId)
  if (!task) {
    logger.debug(
      `Ignoring OFFSCREEN_DOWNLOAD_PROGRESS for unknown task: ${progress.taskId}`
    )
    return { success: true, disposition: "lease_not_current" }
  }
  if (task.status !== "downloading") {
    logger.debug(
      `Ignoring OFFSCREEN_DOWNLOAD_PROGRESS for inactive task: ${progress.taskId}`
    )
    return { success: true, disposition: "lease_not_current" }
  }
  const chapter = task.chapters.find(
    (chapter) => chapter.id === progress.chapterId
  )
  if (!chapter) {
    logger.debug(
      `Ignoring OFFSCREEN_DOWNLOAD_PROGRESS for unknown chapter: ${progress.chapterId}`
    )
    return { success: true, disposition: "protocol_error" }
  }
  const projectionChapter = { ...chapter }
  if (!(await persistChapterProgress(stateManager, progress, chapter)))
    return { success: true, disposition: "lease_not_current" }
  await publishProgressProjection(
    stateManager,
    progress,
    task,
    projectionChapter
  )
  return { success: true, disposition: "renewed" }
}

export async function handleOffscreenDownloadProgress(
  stateManager: QueueRepository,
  message: RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_PROGRESS">
): Promise<ProgressResponse> {
  try {
    const progress = readOffscreenProgress(message.payload)
    if (!progress)
      return {
        success: false,
        error:
          "Missing job, task, chapter, sequence, stage, or status in OFFSCREEN_DOWNLOAD_PROGRESS",
      }
    return await progressJobs.run(progress.jobId, () =>
      applyCurrentProgress(stateManager, progress)
    )
  } catch (error: unknown) {
    logger.error("Error handling OFFSCREEN_DOWNLOAD_PROGRESS", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
