import logger from "@/src/runtime/logger"
import { isRecord } from "@/src/shared/type-guards"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import {
  getActiveTaskProgressSnapshot,
  publishActiveTaskProgress,
  runActiveTaskProgressExclusive,
} from "./active-task-progress-bus"
import {
  calculatePhaseWeightedChapterFraction,
  calculateTimeWeightedTaskFraction,
} from "@/src/runtime/progress-calculator"
import { progressTimingEstimator } from "@/src/runtime/progress-timing-estimates"
import type { OffscreenJobStage } from "@/src/runtime/offscreen-job-contracts"
import { isTerminalChapterStatus } from "@/src/domain/queue/task-lifecycle"
import { normalizeDownloadErrorCategory } from "@/src/shared/download-contract"

interface ActiveChapterSnapshot {
  chapterId: string
  chapterTitle?: string
  imagesProcessed: number
  totalImages: number
  stage: OffscreenJobStage
  phaseFraction: number
  updatedAt: number
}

type OffscreenDownloadProgressMessage =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_PROGRESS">
type OffscreenDownloadProgressResponse =
  RuntimeMessageResponse<"OFFSCREEN_DOWNLOAD_PROGRESS">

const progressJobLocks = new Map<string, Promise<void>>()

async function runProgressJobExclusive<T>(
  jobId: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = progressJobLocks.get(jobId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  progressJobLocks.set(jobId, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (progressJobLocks.get(jobId) === current) {
      progressJobLocks.delete(jobId)
    }
  }
}

function normalizeStatus(
  value: unknown
): OffscreenDownloadProgressMessage["payload"]["status"] | undefined {
  return value === "downloading" ||
    value === "completed" ||
    value === "failed" ||
    value === "partial_success"
    ? value
    : undefined
}

function readActiveChapterMap(
  storedProgressValue: unknown,
  taskId: string
): Map<string, ActiveChapterSnapshot> {
  const activeChapterMap = new Map<string, ActiveChapterSnapshot>()

  if (!isRecord(storedProgressValue)) {
    return activeChapterMap
  }

  const previousTaskId =
    typeof storedProgressValue.taskId === "string"
      ? storedProgressValue.taskId
      : undefined
  const previousActiveChapters = storedProgressValue.activeChapters

  if (previousTaskId !== taskId || !Array.isArray(previousActiveChapters)) {
    return activeChapterMap
  }

  for (const chapterSnapshot of previousActiveChapters) {
    if (!isRecord(chapterSnapshot)) {
      continue
    }

    const existingChapterId =
      typeof chapterSnapshot.chapterId === "string"
        ? chapterSnapshot.chapterId
        : undefined
    if (!existingChapterId) {
      continue
    }

    const existingChapterTitle =
      typeof chapterSnapshot.chapterTitle === "string"
        ? chapterSnapshot.chapterTitle.trim()
        : ""

    activeChapterMap.set(existingChapterId, {
      chapterId: existingChapterId,
      chapterTitle:
        existingChapterTitle.length > 0 ? existingChapterTitle : undefined,
      imagesProcessed:
        typeof chapterSnapshot.imagesProcessed === "number"
          ? Math.max(0, chapterSnapshot.imagesProcessed)
          : 0,
      totalImages:
        typeof chapterSnapshot.totalImages === "number"
          ? Math.max(0, chapterSnapshot.totalImages)
          : 0,
      stage:
        chapterSnapshot.stage === "dispatching" ||
        chapterSnapshot.stage === "accepted" ||
        chapterSnapshot.stage === "resolving" ||
        chapterSnapshot.stage === "downloading" ||
        chapterSnapshot.stage === "transforming" ||
        chapterSnapshot.stage === "archiving" ||
        chapterSnapshot.stage === "saving"
          ? chapterSnapshot.stage
          : "downloading",
      phaseFraction:
        typeof chapterSnapshot.phaseFraction === "number"
          ? Math.max(0, Math.min(1, chapterSnapshot.phaseFraction))
          : 0,
      updatedAt:
        typeof chapterSnapshot.updatedAt === "number"
          ? chapterSnapshot.updatedAt
          : 0,
    })
  }

  return activeChapterMap
}

function normalizeActiveChapters(input: {
  activeChapters: ActiveChapterSnapshot[]
  taskChapters: Array<{ id: string; status: string }>
}): ActiveChapterSnapshot[] {
  const knownChapterIds = new Set(
    input.taskChapters.map((chapter) => chapter.id)
  )
  const downloadingChapterIds = new Set(
    input.taskChapters
      .filter((chapter) => chapter.status === "downloading")
      .map((chapter) => chapter.id)
  )

  const normalizedActiveChapterMap = new Map<string, ActiveChapterSnapshot>()
  for (const chapterSnapshot of input.activeChapters) {
    if (!knownChapterIds.has(chapterSnapshot.chapterId)) {
      continue
    }
    if (
      downloadingChapterIds.size > 0 &&
      !downloadingChapterIds.has(chapterSnapshot.chapterId)
    ) {
      continue
    }

    const previousSnapshot = normalizedActiveChapterMap.get(
      chapterSnapshot.chapterId
    )
    if (
      !previousSnapshot ||
      chapterSnapshot.updatedAt >= previousSnapshot.updatedAt
    ) {
      normalizedActiveChapterMap.set(chapterSnapshot.chapterId, chapterSnapshot)
    }
  }

  return [...normalizedActiveChapterMap.values()].sort((left, right) =>
    left.chapterId.localeCompare(right.chapterId)
  )
}

export async function handleOffscreenDownloadProgress(
  stateManager: QueueRepository,
  message: OffscreenDownloadProgressMessage
): Promise<OffscreenDownloadProgressResponse> {
  try {
    const { payload } = message
    const jobId = typeof payload.jobId === "string" ? payload.jobId : undefined
    const attempt =
      typeof payload.attempt === "number" ? payload.attempt : undefined
    const sequence =
      typeof payload.sequence === "number" ? payload.sequence : undefined
    const taskId =
      typeof payload.taskId === "string" ? payload.taskId : undefined
    const chapterId =
      typeof payload.chapterId === "string" ? payload.chapterId : undefined
    const imagesProcessed =
      typeof payload.imagesProcessed === "number"
        ? payload.imagesProcessed
        : undefined
    const totalImages =
      typeof payload.totalImages === "number" ? payload.totalImages : undefined
    const imagesFailed =
      typeof payload.imagesFailed === "number"
        ? payload.imagesFailed
        : undefined
    const chapterTitle =
      typeof payload.chapterTitle === "string"
        ? payload.chapterTitle
        : undefined
    const status = normalizeStatus(payload.status)
    const stage =
      payload.stage === "dispatching" ||
      payload.stage === "accepted" ||
      payload.stage === "resolving" ||
      payload.stage === "downloading" ||
      payload.stage === "transforming" ||
      payload.stage === "archiving" ||
      payload.stage === "saving"
        ? payload.stage
        : undefined
    const payloadPhaseFraction =
      typeof payload.phaseFraction === "number" &&
      Number.isFinite(payload.phaseFraction)
        ? Math.max(0, Math.min(1, payload.phaseFraction))
        : undefined
    const errorMessage =
      typeof payload.error === "string" ? payload.error : undefined
    const errorCategory = normalizeDownloadErrorCategory(payload.errorCategory)

    if (
      !jobId ||
      attempt === undefined ||
      sequence === undefined ||
      !stage ||
      !taskId ||
      !chapterId ||
      !status
    ) {
      return {
        success: false,
        error:
          "Missing job, task, chapter, sequence, stage, or status in OFFSCREEN_DOWNLOAD_PROGRESS",
      }
    }

    return await runProgressJobExclusive(jobId, async () => {
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
          disposition:
            renewal.reason === "stale-sequence"
              ? "stale_or_reordered"
              : renewal.reason === "lease-not-current"
                ? "lease_not_current"
                : "protocol_error",
        }
      }
      if (renewal.outcome === "unchanged") {
        return { success: true, disposition: "stale_or_reordered" }
      }

      const taskBeforeUpdate = await stateManager.getTask(taskId)
      if (!taskBeforeUpdate) {
        logger.debug(
          `Ignoring OFFSCREEN_DOWNLOAD_PROGRESS for unknown task: ${taskId}`
        )
        return { success: true, disposition: "lease_not_current" }
      }
      if (taskBeforeUpdate.status !== "downloading") {
        logger.debug(
          `Ignoring OFFSCREEN_DOWNLOAD_PROGRESS for inactive task: ${taskId}`
        )
        return { success: true, disposition: "lease_not_current" }
      }

      const taskChapter = taskBeforeUpdate.chapters.find(
        (chapter) => chapter.id === chapterId
      )
      if (!taskChapter) {
        logger.debug(
          `Ignoring OFFSCREEN_DOWNLOAD_PROGRESS for unknown chapter: ${chapterId}`
        )
        return { success: true, disposition: "protocol_error" }
      }

      const payloadChapterTitle =
        typeof chapterTitle === "string" ? chapterTitle.trim() : ""
      const stableTaskChapterTitle =
        typeof taskChapter.title === "string" ? taskChapter.title.trim() : ""
      const progressChapterTitle =
        payloadChapterTitle.length > 0
          ? payloadChapterTitle
          : stableTaskChapterTitle.length > 0
            ? stableTaskChapterTitle
            : undefined
      const shouldIgnoreStaleChapterProgress =
        isTerminalChapterStatus(taskChapter.status) && status === "downloading"

      const chapterErrorMessage =
        status === "failed" || status === "partial_success"
          ? errorMessage
          : undefined
      const shouldPersistChapterUpdate =
        status !== "downloading" ||
        (typeof totalImages === "number" &&
          totalImages !== taskChapter.totalImages) ||
        (typeof imagesFailed === "number" &&
          imagesFailed !== taskChapter.imagesFailed) ||
        taskChapter.status !== "downloading"
      if (shouldPersistChapterUpdate) {
        const chapterUpdate = await stateManager.updateChapterProgress({
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
            totalImages:
              typeof totalImages === "number" ? totalImages : undefined,
            imagesFailed:
              typeof imagesFailed === "number" ? imagesFailed : undefined,
            errorMessage: chapterErrorMessage,
            errorCategory:
              status === "failed" || status === "partial_success"
                ? (errorCategory ?? "unknown")
                : undefined,
          },
        })
        if (chapterUpdate.outcome === "rejected") {
          logger.debug(
            `Ignoring OFFSCREEN_DOWNLOAD_PROGRESS after parent task transition: ${taskId}`,
            chapterUpdate
          )
          return { success: true, disposition: "lease_not_current" }
        }
      }
      const isTerminalProgress = status !== "downloading"
      const outputsRequested = Math.max(0, payload.outputsRequested ?? 0)
      const outputsFailedBeforeHandoff = Math.max(
        0,
        payload.outputsFailedBeforeHandoff ?? 0
      )
      const outputsExpectedToCommit = Math.max(
        0,
        outputsRequested - outputsFailedBeforeHandoff
      )
      const outputsCommitted = Math.max(0, payload.outputsCommitted ?? 0)
      const destinationCommitted =
        isTerminalProgress &&
        outputsExpectedToCommit > 0 &&
        outputsCommitted >= outputsExpectedToCommit
      const effectiveDestination =
        taskBeforeUpdate.destinationOverride ??
        taskBeforeUpdate.settingsSnapshot.destination
      const awaitingNativeDestinationCommit =
        isTerminalProgress &&
        effectiveDestination === "downloads-api" &&
        outputsExpectedToCommit > 0 &&
        !destinationCommitted
      const costContext = {
        integrationId: taskBeforeUpdate.siteIntegrationId,
        archiveFormat: taskBeforeUpdate.settingsSnapshot.archiveFormat,
        destination: effectiveDestination,
      } as const
      const phaseCosts = await progressTimingEstimator.observe({
        jobId,
        stage,
        context: costContext,
      })

      await runActiveTaskProgressExclusive(async () => {
        const storedSnapshot = await getActiveTaskProgressSnapshot()
        const storedProgressValue = storedSnapshot.progress
        const activeChapterMap = readActiveChapterMap(
          storedProgressValue,
          taskId
        )

        const existingChapterSnapshot = activeChapterMap.get(chapterId)

        if (shouldIgnoreStaleChapterProgress) {
          activeChapterMap.delete(chapterId)
        } else {
          const nextImagesProcessed = Math.max(
            0,
            imagesProcessed ?? existingChapterSnapshot?.imagesProcessed ?? 0
          )
          const nextTotalImages = Math.max(
            0,
            totalImages ?? existingChapterSnapshot?.totalImages ?? 0
          )
          const imageFraction =
            nextTotalImages > 0
              ? Math.max(0, Math.min(1, nextImagesProcessed / nextTotalImages))
              : 0
          const progressStage = isTerminalProgress ? "saving" : stage
          const phaseFraction = isTerminalProgress
            ? destinationCommitted
              ? 1
              : 0.99
            : (payloadPhaseFraction ??
              (progressStage === "downloading" ? imageFraction : 0))

          activeChapterMap.set(chapterId, {
            chapterId,
            chapterTitle:
              progressChapterTitle ?? existingChapterSnapshot?.chapterTitle,
            imagesProcessed: nextImagesProcessed,
            totalImages: nextTotalImages,
            stage: progressStage,
            phaseFraction,
            updatedAt: Date.now(),
          })
        }

        const activeChapters = [...activeChapterMap.values()].sort(
          (left, right) => left.chapterId.localeCompare(right.chapterId)
        )
        const taskAfterUpdate = await stateManager.getTask(taskId)
        const normalizedActiveChapters = normalizeActiveChapters({
          activeChapters,
          taskChapters: taskAfterUpdate?.chapters ?? [],
        })

        if (normalizedActiveChapters.length === 0) {
          await publishActiveTaskProgress(null, { forcePersist: true })
          return
        }

        const aggregateImagesProcessed = normalizedActiveChapters.reduce(
          (sum, chapterSnapshot) => sum + chapterSnapshot.imagesProcessed,
          0
        )
        const aggregateTotalImages = normalizedActiveChapters.reduce(
          (sum, chapterSnapshot) => sum + chapterSnapshot.totalImages,
          0
        )
        const currentActiveChapter = normalizedActiveChapters.reduce(
          (latest, chapter) =>
            !latest || chapter.updatedAt >= latest.updatedAt ? chapter : latest,
          undefined as ActiveChapterSnapshot | undefined
        )
        const settledChapters = (taskAfterUpdate?.chapters ?? []).filter(
          (chapter) =>
            chapter.status === "completed" ||
            chapter.status === "partial_success" ||
            chapter.status === "failed"
        ).length
        const activeChapterFractions = normalizedActiveChapters.map((chapter) =>
          calculatePhaseWeightedChapterFraction({
            costs: phaseCosts,
            stage: chapter.stage,
            phaseFraction: chapter.phaseFraction,
          })
        )
        const previousOverallFraction =
          storedProgressValue?.taskId === taskId
            ? storedProgressValue.overallFraction
            : 0
        const overallFraction = calculateTimeWeightedTaskFraction({
          totalChapters: taskAfterUpdate?.chapters.length ?? 1,
          settledChapters,
          activeChapterFractions,
          previousDisplayedFraction: previousOverallFraction,
          destinationCommitted,
        })

        await publishActiveTaskProgress(
          {
            taskId,
            chapterId: currentActiveChapter?.chapterId,
            chapterTitle: currentActiveChapter?.chapterTitle,
            activeChapterCount: normalizedActiveChapters.length,
            activeChapters: normalizedActiveChapters,
            imagesProcessed: aggregateImagesProcessed,
            totalImages: aggregateTotalImages,
            stage: currentActiveChapter?.stage ?? stage,
            phaseFraction: currentActiveChapter?.phaseFraction ?? 0,
            overallFraction,
            outputCommitted: destinationCommitted,
            status: "downloading",
          },
          { forcePersist: isTerminalProgress }
        )
      })

      if (isTerminalProgress && !awaitingNativeDestinationCommit) {
        await progressTimingEstimator.finish(jobId)
      }

      return { success: true, disposition: "renewed" }
    })
  } catch (e: unknown) {
    logger.error("Error handling OFFSCREEN_DOWNLOAD_PROGRESS", e)
    const msg = e instanceof Error ? e.message : "Unknown error"
    return { success: false, error: msg }
  }
}
