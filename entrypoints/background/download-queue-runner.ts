import logger from "@/src/runtime/logger"
import { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { OffscreenDownloadChapterMessage } from "@/src/types/offscreen-messages"
import {
  clearActiveTaskProgress,
  settleActiveTaskProgressChapter,
} from "./active-task-progress-bus"
import {
  resolveDownloadPlan,
  validateDownloadPathForTask,
} from "./queue-helpers"
import {
  finalizeDownloadTaskAfterDispatch,
  notifyDownloadTaskCompletion,
  notifyTerminalDownloadTask,
  persistCompletedChapter,
  type ChapterDispatchOutcome,
} from "./download-queue-finalization"
import {
  createDestinationIssue,
  destinationService,
  issueKindForPreflight,
  notifyDestinationIssue,
} from "./destination"
import { composeSeriesKey } from "@/src/runtime/queue-task-summary"
import {
  siteIntegrationEnablementService,
  type SiteIntegrationEnablementMap,
} from "@/src/storage/site-integration-enablement-service"
import {
  activeDispatchLeaseStore,
  createDispatchLease,
} from "@/src/runtime/active-dispatch-lease"
import type { PendingDownloadsStore } from "./pending-downloads"
import { runDownloadTaskSingleFlight } from "./download-task-runner-registry"
import { progressTimingEstimator } from "@/src/runtime/progress-timing-estimates"
import { normalizeInterruptedTask } from "./task-lifecycle"
import { dispatchOffscreenChapterWithRecovery } from "./offscreen-chapter-dispatch"
import { resolveSiteIntegrationDispatchContext } from "@/src/runtime/site-integration-dispatch-context"
import {
  ensureSiteIntegrationNetworkReady,
  ProviderNetworkPolicyActionRequiredError,
  ProviderNetworkPolicyPendingError,
} from "@/src/site-integrations/session-rule-manager"
import {
  isExecutingDownloadTask,
  isRunnableQueuedTask,
} from "@/src/runtime/download-task-execution-state"
import { getSiteIntegrationManifestById } from "@/src/site-integrations/manifest"

// Current queue scheduling is intentionally single-task and single-chapter dispatch.
// Re-enable chapter concurrency only after the scheduler, offscreen request
// handling, progress state, cancellation, and archive memory behavior are made
// reentrant.
const MAX_CONCURRENT_QUEUED_TASKS = 1

async function releasePendingJobBestEffort(
  store: PendingDownloadsStore | null,
  jobId: string
): Promise<void> {
  if (!store) return
  try {
    await store.releaseJob(jobId)
  } catch (error) {
    // Output cleanup is independently durable and retried by startup/alarm
    // reconciliation. It must never rewrite an already-committed outcome.
    logger.warn("[Queue] Pending output cleanup will be retried", {
      jobId,
      error,
    })
  }
}

async function clearDispatchLeaseForTaskBestEffort(
  taskId: string
): Promise<void> {
  try {
    const lease = await activeDispatchLeaseStore.get()
    if (lease?.taskId === taskId) {
      await activeDispatchLeaseStore.clear({
        jobId: lease.jobId,
        attempt: lease.attempt,
      })
    }
  } catch (error) {
    // A stale lease must not block terminal task state. Startup recovery will
    // retry its durable reconciliation if this best-effort cleanup fails.
    logger.warn("[Queue] Unable to clear disabled integration lease", {
      taskId,
      error,
    })
  }
}

async function cancelActiveDispatchForTaskBestEffort(
  taskId: string
): Promise<void> {
  try {
    const lease = await activeDispatchLeaseStore.get()
    if (lease?.taskId !== taskId) return
    try {
      await chrome.runtime.sendMessage({
        type: "OFFSCREEN_CANCEL_JOB",
        payload: {
          jobId: lease.jobId,
          attempt: lease.attempt,
          taskId: lease.taskId,
          chapterId: lease.chapterId,
        },
      })
    } catch (error) {
      logger.debug(
        "[Queue] Disabled provider job was no longer reachable for cancellation",
        error
      )
    }
    await activeDispatchLeaseStore.clear({
      jobId: lease.jobId,
      attempt: lease.attempt,
    })
  } catch (error) {
    logger.warn("[Queue] Unable to cancel disabled provider dispatch", {
      taskId,
      error,
    })
  }
}

let queuedContinuationStateManager: CentralizedStateManager | null = null
let queuedContinuationEnsureOffscreenReady: (() => Promise<void>) | null = null
let queuedContinuationScheduled = false
let onQueueDrained: (() => Promise<void>) | null = null
let pendingOutputsStore: PendingDownloadsStore | null = null

export function configureDownloadQueueLifecycle(input: {
  onQueueDrained: (() => Promise<void>) | null
  pendingOutputsStore: PendingDownloadsStore
}): void {
  onQueueDrained = input.onQueueDrained
  pendingOutputsStore = input.pendingOutputsStore
}

let queueContinuationPort: MessagePort | null = null

function getQueueContinuationPort(): MessagePort {
  if (queueContinuationPort) {
    return queueContinuationPort
  }

  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    queuedContinuationScheduled = false

    const stateManager = queuedContinuationStateManager
    const ensureOffscreenReady = queuedContinuationEnsureOffscreenReady
    queuedContinuationStateManager = null
    queuedContinuationEnsureOffscreenReady = null

    if (!stateManager || !ensureOffscreenReady) {
      return
    }

    void processDownloadQueue(stateManager, ensureOffscreenReady).catch(
      (error) => {
        logger.error("[Queue] Deferred continuation failed", error)
      }
    )
  }

  queueContinuationPort = channel.port2
  return queueContinuationPort
}

function scheduleQueueContinuation(
  stateManager: CentralizedStateManager,
  ensureOffscreenReady: () => Promise<void>
): void {
  queuedContinuationStateManager = stateManager
  queuedContinuationEnsureOffscreenReady = ensureOffscreenReady

  if (queuedContinuationScheduled) {
    return
  }

  queuedContinuationScheduled = true
  getQueueContinuationPort().postMessage(undefined)
}

async function runDownloadTask(
  stateManager: CentralizedStateManager,
  taskId: string,
  ensureOffscreenReady: () => Promise<void>,
  resumeExistingTask: boolean = false
): Promise<void> {
  try {
    logger.info("[Queue]", {
      event: "STARTED",
      taskId,
    })

    const globalState = await stateManager.getGlobalState()
    const task = globalState.downloadQueue.find((t) => t.id === taskId)

    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    // An integration being disabled is a definitive task failure. Check it
    // before destination preflight so a stale FSA permission issue cannot
    // leave a resumed task occupying the only active queue slot forever.
    const integrationEnablement =
      await siteIntegrationEnablementService.getAll()
    if (integrationEnablement[task.siteIntegrationId] === false) {
      const interruptedTask = normalizeInterruptedTask(
        task,
        "Integration disabled"
      )
      const disabledTransition = await stateManager.transitionDownloadTask(
        taskId,
        ["queued", "downloading"],
        {
          status: interruptedTask.status,
          chapters: interruptedTask.chapters,
          errorMessage: interruptedTask.errorMessage,
          errorCategory: interruptedTask.errorCategory,
          completed: interruptedTask.completed,
        }
      )
      if (disabledTransition.success) {
        await clearDispatchLeaseForTaskBestEffort(taskId)
        await clearActiveTaskProgress()
        await notifyTerminalDownloadTask({
          task: disabledTransition.task,
          finalStatus: disabledTransition.task.status,
          completedCount: 0,
          totalChapters: disabledTransition.task.chapters.length,
        })
        scheduleQueueContinuation(stateManager, ensureOffscreenReady)
      }
      return
    }

    // Session-scoped DNR rules are cleared on browser shutdown and extension
    // update. DNR-dependent providers must not start destination/offscreen work
    // until their current network policy has been installed. Providers without
    // declared session rules return immediately.
    await ensureSiteIntegrationNetworkReady(task.siteIntegrationId)
    if (
      task.activeBlock === "provider_network_policy_pending" ||
      task.activeBlock === "provider_network_policy_action_required"
    ) {
      await stateManager.updateDownloadTask(taskId, { activeBlock: undefined })
    }

    const taskDestinationContext = {
      taskId,
      destination: task.settingsSnapshot.destination,
      destinationOverride: task.destinationOverride,
    } as const
    const destinationPreflight = await destinationService.preflight(
      taskDestinationContext
    )
    if (!destinationPreflight.ready) {
      const issue = createDestinationIssue(
        taskDestinationContext,
        issueKindForPreflight(destinationPreflight)
      )
      const transition =
        await stateManager.transitionDownloadTaskWithDestinationIssues(
          taskId,
          ["queued", "downloading"],
          {
            status: "queued",
            activeBlock: "destination_action_required",
          },
          { type: "upsert", issue }
        )
      if (transition.success) await notifyDestinationIssue(issue)
      await clearActiveTaskProgress()
      logger.info("[Queue]", {
        event: "DESTINATION_ACTION_REQUIRED",
        taskId,
        reason: destinationPreflight.reason,
      })
      return
    }
    if (task.activeBlock === "destination_action_required") {
      await stateManager.transitionDownloadTaskWithDestinationIssues(
        taskId,
        ["queued", "downloading"],
        { status: "queued", activeBlock: undefined },
        { type: "clear-task", taskId }
      )
    }

    if (!(resumeExistingTask && task.status === "downloading")) {
      const startTransition = await stateManager.transitionDownloadTask(
        taskId,
        ["queued"],
        {
          status: "downloading",
          started: Date.now(),
        }
      )
      if (!startTransition.success) {
        logger.info("[Queue]", {
          event: "START_SKIPPED",
          taskId,
          reason: startTransition.reason,
        })
        return
      }
    }
    await ensureOffscreenReady()

    validateDownloadPathForTask(taskId, {
      downloads: {
        pathTemplate: task.settingsSnapshot.pathTemplate,
      },
    })

    const settingsSnapshot = task.settingsSnapshot
    let lastDownloadMode: "custom" | "browser" = "browser"
    const chapterDelayMs = Math.max(
      0,
      settingsSnapshot.rateLimitSettings.chapter.delayMs
    )
    const totalChapters = task.chapters.length
    const chapterOutcomesByIndex: Array<ChapterDispatchOutcome | undefined> =
      task.chapters.map((chapter) =>
        chapter.status === "completed" ||
        chapter.status === "failed" ||
        chapter.status === "partial_success"
          ? {
              chapterId: chapter.id,
              status: chapter.status,
              errorMessage: chapter.errorMessage,
              errorCategory: chapter.errorCategory,
              imagesFailed: chapter.imagesFailed,
            }
          : undefined
      )
    let shouldStopDispatch = false
    let retainedDispatchLease:
      | {
          jobId: string
          attempt: number
          taskId: string
          chapterId: string
        }
      | undefined

    const dispatchChapter = async (
      chapterIndex: number
    ): Promise<
      | { jobId: string; attempt: number; taskId: string; chapterId: string }
      | undefined
    > => {
      const fallbackTaskChapter = task.chapters[chapterIndex]
      let dispatchedJob:
        | {
            jobId: string
            attempt: number
            taskId: string
            chapterId: string
            reusedLease: boolean
          }
        | undefined
      try {
        const dispatchPlan = await resolveDownloadPlan(task)
        const chapter = dispatchPlan.chapters[chapterIndex]
        if (!chapter) {
          chapterOutcomesByIndex[chapterIndex] = {
            chapterId:
              fallbackTaskChapter?.id || `missing-chapter-${chapterIndex + 1}`,
            status: "failed",
            errorMessage: "Chapter missing from resolved dispatch plan",
            errorCategory: "unknown",
          }
          return undefined
        }

        const latestTask = (
          await stateManager.getGlobalState()
        ).downloadQueue.find((queuedTask) => queuedTask.id === taskId)
        if (!latestTask || latestTask.status !== "downloading") {
          shouldStopDispatch = true
          logger.info("[Queue]", {
            event: "CHAPTER_DISPATCH_ABORTED",
            taskId,
            reason: "TASK_NOT_DOWNLOADING",
          })
          return undefined
        }

        const destination = await destinationService.getEffectiveDestination({
          taskId,
          chapterId: chapter.id,
          destination: latestTask.settingsSnapshot.destination,
          destinationOverride: latestTask.destinationOverride,
        })
        const saveMode: OffscreenDownloadChapterMessage["payload"]["saveMode"] =
          destination.kind === "custom" ? "fsa" : "downloads-api"
        lastDownloadMode = destination.kind === "custom" ? "custom" : "browser"

        const currentChapter = latestTask.chapters.find(
          (taskChapter) => taskChapter.id === chapter.id
        )
        const existingLease = await activeDispatchLeaseStore.get()
        const reusableLease =
          currentChapter?.status === "downloading" &&
          existingLease?.taskId === taskId &&
          existingLease.chapterId === chapter.id
        const attempt = reusableLease
          ? existingLease.attempt
          : (currentChapter?.dispatchAttempt ?? 0) + 1
        const jobId = reusableLease ? existingLease.jobId : crypto.randomUUID()
        dispatchedJob = {
          jobId,
          attempt,
          taskId,
          chapterId: chapter.id,
          reusedLease: reusableLease,
        }

        const chapterStart = reusableLease
          ? await stateManager.updateDownloadingTaskChapter(
              taskId,
              chapter.id,
              "downloading"
            )
          : await stateManager.beginChapterDispatch({
              taskId,
              chapterId: chapter.id,
              expectedPreviousLease: retainedDispatchLease ?? null,
              lease: createDispatchLease({
                jobId,
                taskId,
                chapterId: chapter.id,
                attempt,
              }),
            })
        if (!chapterStart.success) {
          shouldStopDispatch = true
          return undefined
        }
        const seriesKey = composeSeriesKey(
          dispatchPlan.book.siteId,
          dispatchPlan.book.seriesId
        )
        const integrationContext = await resolveSiteIntegrationDispatchContext({
          siteIntegrationId: dispatchPlan.book.siteId,
          taskId,
          seriesKey,
          chapter,
          settingsSnapshot,
        })

        const dispatchMessage: OffscreenDownloadChapterMessage = {
          type: "OFFSCREEN_DOWNLOAD_CHAPTER",
          payload: {
            jobId,
            attempt,
            taskId,
            seriesKey,
            book: {
              siteIntegrationId: dispatchPlan.book.siteId,
              seriesTitle: dispatchPlan.book.seriesTitle,
              coverUrl: latestTask.seriesCoverUrl ?? dispatchPlan.book.coverUrl,
              metadata: latestTask.settingsSnapshot.comicInfo,
            },
            chapter: {
              id: chapter.id,
              title: chapter.title,
              url: chapter.url,
              index: fallbackTaskChapter?.index || chapterIndex + 1,
              chapterLabel: chapter.chapterLabel,
              chapterNumber: chapter.chapterNumber,
              volumeId: chapter.volumeId,
              volumeNumber: chapter.volumeNumber,
              volumeLabel: chapter.volumeLabel,
              language:
                latestTask.chapters.find(
                  (taskChapter) => taskChapter.id === chapter.id
                )?.language ?? chapter.comicInfo?.LanguageISO,
              resolvedPath: chapter.resolvedPath || chapter.title,
            },
            settingsSnapshot: { ...settingsSnapshot },
            saveMode,
            notBefore: latestTask.nextChapterDispatchAt,
            integrationContext,
          },
        }
        const response = await dispatchOffscreenChapterWithRecovery({
          message: dispatchMessage,
          ensureOffscreenReady,
          isDispatchStillCurrent: async () => {
            const currentTask = (
              await stateManager.getGlobalState()
            ).downloadQueue.find((candidate) => candidate.id === taskId)
            const currentChapter = currentTask?.chapters.find(
              (candidate) => candidate.id === chapter.id
            )
            const currentLease = await activeDispatchLeaseStore.get()
            return (
              currentTask?.status === "downloading" &&
              currentChapter?.status === "downloading" &&
              currentLease?.jobId === jobId &&
              currentLease.attempt === attempt &&
              currentLease.taskId === taskId &&
              currentLease.chapterId === chapter.id
            )
          },
        })

        let chapterStatus = response.success ? response.status : "failed"
        let chapterErrorMessage = response.success
          ? response.errorMessage
          : response.error
        let chapterErrorCategory = response.success
          ? response.errorCategory
          : "unknown"
        if (
          (chapterStatus === "failed" || chapterStatus === "partial_success") &&
          !chapterErrorCategory
        ) {
          chapterErrorCategory = "unknown"
        }
        const imagesFailed = response.success
          ? response.imagesFailed
          : undefined
        let outputAccounting = { requested: 0, committed: 0, failed: 0 }
        if (response.success) {
          const requested = Math.max(0, response.outputsRequested ?? 0)
          const failedBeforeHandoff = Math.max(
            0,
            response.outputsFailedBeforeHandoff ?? 0
          )
          if (saveMode === "downloads-api" && requested > 0) {
            if (!pendingOutputsStore) {
              throw new Error("Pending output coordinator is not configured")
            }
            let outputSummary
            try {
              const browserDownloadWait =
                pendingOutputsStore.describeJobWait(jobId)
              if (!browserDownloadWait) {
                throw new Error(
                  `Chrome download identities are unavailable for job ${jobId}`
                )
              }
              await stateManager.updateDownloadTask(taskId, {
                browserDownloadWait,
              })
              outputSummary = await pendingOutputsStore.waitForJobOutputs({
                jobId,
                requested,
                failedBeforeHandoff,
              })
            } finally {
              await stateManager.updateDownloadTask(taskId, {
                browserDownloadWait: undefined,
              })
              // Native download completion is part of the local saving-phase
              // timing estimate, even though the Blob handoff already ended.
              await progressTimingEstimator.finish(jobId)
            }
            outputAccounting = {
              requested: outputSummary.requested,
              committed: outputSummary.committed,
              failed: outputSummary.failed,
            }
            chapterStatus =
              outputSummary.committed === outputSummary.requested &&
              outputSummary.failed === 0
                ? "completed"
                : outputSummary.committed > 0
                  ? "partial_success"
                  : "failed"
            if (outputSummary.failed > 0) {
              chapterErrorCategory = "browser_download_interrupted"
              chapterErrorMessage =
                outputSummary.committed > 0
                  ? `${outputSummary.failed} output file(s) did not finish saving.`
                  : "Chrome could not finish saving the output."
            }
          } else {
            const committed = Math.max(0, response.outputsCommitted ?? 0)
            const failed = Math.max(failedBeforeHandoff, requested - committed)
            outputAccounting = { requested, committed, failed }
          }
        }

        const destinationIssueKind =
          saveMode === "fsa"
            ? chapterErrorCategory === "folder_permission_required"
              ? "fsa_permission_required"
              : chapterErrorCategory === "folder_unavailable"
                ? "fsa_folder_missing"
                : chapterErrorCategory === "disk_full"
                  ? "disk_full"
                  : chapterErrorCategory === "folder_write_failed"
                    ? "fsa_write_failed"
                    : null
            : null
        if (destinationIssueKind) {
          const blockedTask = (
            await stateManager.getGlobalState()
          ).downloadQueue.find((candidate) => candidate.id === taskId)
          if (blockedTask?.status === "downloading") {
            const destinationContext = {
              taskId,
              chapterId: chapter.id,
              destination: settingsSnapshot.destination,
              destinationOverride: latestTask.destinationOverride,
            } as const
            const issue = createDestinationIssue(
              destinationContext,
              destinationIssueKind
            )
            const transition =
              await stateManager.transitionDownloadTaskWithDestinationIssues(
                taskId,
                ["downloading"],
                {
                  status: "queued",
                  activeBlock: "destination_action_required",
                  errorMessage: chapterErrorMessage,
                  errorCategory: chapterErrorCategory,
                  chapters: blockedTask.chapters.map((taskChapter) =>
                    taskChapter.id === chapter.id
                      ? {
                          ...taskChapter,
                          status: "queued",
                          errorMessage: chapterErrorMessage,
                          errorCategory: chapterErrorCategory,
                          imagesFailed,
                          outputs: outputAccounting,
                          lastUpdated: Date.now(),
                        }
                      : taskChapter
                  ),
                },
                { type: "upsert", issue }
              )
            if (transition.success) {
              await notifyDestinationIssue(issue)
              await releasePendingJobBestEffort(pendingOutputsStore, jobId)
              shouldStopDispatch = true
              return dispatchedJob
            }
          }
        }

        const taskAfterDispatch = (
          await stateManager.getGlobalState()
        ).downloadQueue.find((queuedTask) => queuedTask.id === taskId)
        if (!taskAfterDispatch || taskAfterDispatch.status !== "downloading") {
          await releasePendingJobBestEffort(pendingOutputsStore, jobId)
          shouldStopDispatch = true
          return dispatchedJob
        }

        chapterOutcomesByIndex[chapterIndex] = {
          chapterId: chapter.id,
          status: chapterStatus,
          errorMessage: chapterErrorMessage,
          errorCategory: chapterErrorCategory,
          imagesFailed,
        }

        const chapterCompletion =
          await stateManager.updateDownloadingTaskChapter(
            taskId,
            chapter.id,
            chapterStatus,
            {
              errorMessage: chapterErrorMessage,
              errorCategory: chapterErrorCategory,
              imagesFailed,
              outputs: outputAccounting,
            }
          )
        if (!chapterCompletion.success) {
          shouldStopDispatch = true
          return
        }

        if (chapterStatus === "completed") {
          // Persist as soon as the destination has durably committed the
          // chapter. Final task reconciliation repeats this idempotently so a
          // service-worker restart cannot leave an already-completed chapter
          // absent from download history.
          try {
            await persistCompletedChapter(
              task,
              chapter.id,
              settingsSnapshot.archiveFormat
            )
          } catch (error) {
            // Download history is a projection of the already-committed
            // output. A transient projection write must not rewrite that
            // durable completion as a failed download; finalization retries
            // the same idempotent persistence operation.
            logger.warn(
              "[Queue] Completed chapter history persistence will be retried",
              {
                taskId,
                chapterId: chapter.id,
                error,
              }
            )
          }
        }

        const taskAfterChapterCompletion = (
          await stateManager.getGlobalState()
        ).downloadQueue.find((queuedTask) => queuedTask.id === taskId)
        if (taskAfterChapterCompletion) {
          await settleActiveTaskProgressChapter({
            taskId,
            chapterId: chapter.id,
            chapters: taskAfterChapterCompletion.chapters,
            destinationCommitted:
              outputAccounting.requested > 0 &&
              outputAccounting.committed === outputAccounting.requested &&
              outputAccounting.failed === 0,
          })
        }

        const completedOrPartialCount = chapterOutcomesByIndex.filter(
          (outcome): outcome is NonNullable<typeof outcome> =>
            !!outcome &&
            (outcome.status === "completed" ||
              outcome.status === "partial_success")
        ).length
        await stateManager.updateDownloadTask(taskId, {
          errorMessage:
            chapterStatus === "failed" ? chapterErrorMessage : undefined,
          errorCategory:
            chapterStatus === "failed" ? chapterErrorCategory : undefined,
        })
        await releasePendingJobBestEffort(pendingOutputsStore, jobId)

        logger.info("[Queue]", {
          event: "CHAPTER_DISPATCHED",
          taskId,
          chapterId: chapter.id,
          chapterIndex: chapterIndex + 1,
          totalChapters,
          chapterStatus,
          successfulChapters: completedOrPartialCount,
        })
        return dispatchedJob
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        chapterOutcomesByIndex[chapterIndex] = {
          chapterId:
            fallbackTaskChapter?.id || `failed-chapter-${chapterIndex + 1}`,
          status: "failed",
          errorMessage,
          errorCategory: "unknown",
        }

        // Liveness recovery may have already marked the chapter/task terminal
        // with a more accurate "Download process unresponsive" error when the
        // offscreen was closed mid-flight. Don't overwrite that with the
        // sendMessage rejection error ("message channel closed"), which is a
        // downstream symptom of the offscreen being closed, not the root cause.
        const currentTask = (
          await stateManager.getGlobalState()
        ).downloadQueue.find((t) => t.id === taskId)
        const currentChapter = currentTask?.chapters.find(
          (c) => c.id === fallbackTaskChapter?.id
        )
        const chapterAlreadyTerminal =
          currentChapter &&
          (currentChapter.status === "completed" ||
            currentChapter.status === "failed" ||
            currentChapter.status === "partial_success")
        const taskAlreadyTerminal =
          currentTask &&
          (currentTask.status === "completed" ||
            currentTask.status === "failed" ||
            currentTask.status === "partial_success" ||
            currentTask.status === "canceled")

        let chapterFailureAccepted = true
        if (fallbackTaskChapter?.id && !chapterAlreadyTerminal) {
          const chapterFailure =
            await stateManager.updateDownloadingTaskChapter(
              taskId,
              fallbackTaskChapter.id,
              "failed",
              {
                errorMessage,
                errorCategory: "unknown",
              }
            )
          if (!chapterFailure.success) {
            shouldStopDispatch = true
            chapterFailureAccepted = false
          }
        }

        if (!taskAlreadyTerminal && chapterFailureAccepted) {
          await stateManager.updateDownloadTask(taskId, {
            errorMessage,
            errorCategory: "unknown",
          })
        }

        if (taskAlreadyTerminal) {
          shouldStopDispatch = true
        }

        logger.error("[Queue]", {
          event: "CHAPTER_DISPATCH_FAILED",
          taskId,
          chapterIndex: chapterIndex + 1,
          error,
        })
        if (dispatchedJob) {
          await progressTimingEstimator.finish(dispatchedJob.jobId)
          await releasePendingJobBestEffort(
            pendingOutputsStore,
            dispatchedJob.jobId
          )
        }
        return dispatchedJob
      }
    }

    // Deliberately await each chapter before starting the next one. Parallel
    // chapter dispatch is future scheduler work, not a dormant setting.
    const chapterIndicesToDispatch = task.chapters
      .map((chapter, index) => ({ chapter, index }))
      .filter(
        ({ chapter }) =>
          chapter.status === "queued" || chapter.status === "downloading"
      )
      .map(({ index }) => index)
    for (
      let position = 0;
      position < chapterIndicesToDispatch.length;
      position++
    ) {
      if (shouldStopDispatch) {
        break
      }

      const chapterIndex = chapterIndicesToDispatch[position]
      if (chapterIndex === undefined) break
      const settledDispatchLease = await dispatchChapter(chapterIndex)
      if (settledDispatchLease) {
        retainedDispatchLease = settledDispatchLease
      }

      if (
        position < chapterIndicesToDispatch.length - 1 &&
        chapterDelayMs > 0
      ) {
        // Persist the not-before boundary. The next offscreen job owns the
        // actual wait while its heartbeat keeps liveness independent from
        // visible progress and the service-worker lifetime.
        await stateManager.updateDownloadTask(taskId, {
          nextChapterDispatchAt: Date.now() + chapterDelayMs,
        })
      }
    }

    if (shouldStopDispatch) {
      const stoppedTask = (
        await stateManager.getGlobalState()
      ).downloadQueue.find((candidate) => candidate.id === taskId)
      if (
        retainedDispatchLease &&
        stoppedTask &&
        stoppedTask.status !== "downloading"
      ) {
        await activeDispatchLeaseStore.clear(retainedDispatchLease)
      }
      await clearActiveTaskProgress()
      scheduleQueueContinuation(stateManager, ensureOffscreenReady)
      return
    }

    const latestTaskAfterDispatch = (
      await stateManager.getGlobalState()
    ).downloadQueue.find((queuedTask) => queuedTask.id === taskId)
    if (
      !latestTaskAfterDispatch ||
      latestTaskAfterDispatch.status !== "downloading"
    ) {
      await clearActiveTaskProgress()
      scheduleQueueContinuation(stateManager, ensureOffscreenReady)
      return
    }

    const finalization = await finalizeDownloadTaskAfterDispatch({
      stateManager,
      taskId,
      task,
      chapterOutcomesByIndex,
      settingsSnapshot,
    })
    await stateManager.updateDownloadTask(taskId, {
      nextChapterDispatchAt: undefined,
    })
    if (finalization.finalized && retainedDispatchLease) {
      await activeDispatchLeaseStore.clear(retainedDispatchLease)
    }

    await clearActiveTaskProgress()

    if (!finalization.finalized) {
      scheduleQueueContinuation(stateManager, ensureOffscreenReady)
      return
    }

    const { chapterOutcomes, completedCount, finalStatus } = finalization

    await notifyDownloadTaskCompletion({
      stateManager,
      taskId,
      finalStatus,
      completedCount,
      totalChapters: chapterOutcomes.length,
    })

    scheduleQueueContinuation(stateManager, ensureOffscreenReady)

    logger.info("[Queue]", {
      event: "OFFSCREEN_DISPATCHED",
      taskId,
      jobId: `dispatch_loop_${taskId}`,
      mode: lastDownloadMode,
      chapters: task.chapters.length,
    })
  } catch (error) {
    if (error instanceof ProviderNetworkPolicyPendingError) {
      const blockTransition = await stateManager.transitionDownloadTask(
        taskId,
        ["queued", "downloading"],
        {
          status: "queued",
          activeBlock: "provider_network_policy_pending",
          browserDownloadWait: undefined,
        }
      )
      await clearActiveTaskProgress()
      logger.warn("[Queue]", {
        event: "PROVIDER_NETWORK_POLICY_PENDING",
        taskId,
        siteIntegrationId: error.siteIntegrationId,
        reason: error.message,
      })
      if (blockTransition.success) {
        scheduleQueueContinuation(stateManager, ensureOffscreenReady)
      }
      return
    }

    logger.error("[Queue]", {
      event: "FAILED",
      taskId,
      reason:
        error instanceof ProviderNetworkPolicyActionRequiredError
          ? "PROVIDER_NETWORK_POLICY_ACTION_REQUIRED"
          : "INTERNAL_ERROR",
      error,
    })
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error"

    const failedTask = (await stateManager.getGlobalState()).downloadQueue.find(
      (candidate) => candidate.id === taskId
    )
    const interruptedTask = failedTask
      ? normalizeInterruptedTask(failedTask, errorMessage)
      : null
    const failureTransition = await stateManager.transitionDownloadTask(
      taskId,
      ["queued", "downloading"],
      interruptedTask
        ? {
            status: interruptedTask.status,
            chapters: interruptedTask.chapters,
            errorMessage: interruptedTask.errorMessage,
            errorCategory: interruptedTask.errorCategory,
            completed: interruptedTask.completed,
          }
        : {
            status: "failed",
            errorMessage,
            errorCategory: "unknown",
            completed: Date.now(),
          }
    )
    if (failureTransition.success) {
      await notifyTerminalDownloadTask({
        task: failureTransition.task,
        finalStatus: failureTransition.task.status,
        completedCount: failureTransition.task.chapters.filter(
          (chapter) => chapter.status === "completed"
        ).length,
        totalChapters: failureTransition.task.chapters.length,
      })
    }
    await clearActiveTaskProgress()
    scheduleQueueContinuation(stateManager, ensureOffscreenReady)
  }
}

export async function startDownloadTask(
  stateManager: CentralizedStateManager,
  taskId: string,
  ensureOffscreenReady: () => Promise<void>,
  resumeExistingTask: boolean = false
): Promise<void> {
  await runDownloadTaskSingleFlight(taskId, () =>
    runDownloadTask(
      stateManager,
      taskId,
      ensureOffscreenReady,
      resumeExistingTask
    )
  )
}

export async function resumeDownloadTask(
  stateManager: CentralizedStateManager,
  taskId: string,
  ensureOffscreenReady: () => Promise<void>
): Promise<void> {
  await startDownloadTask(stateManager, taskId, ensureOffscreenReady, true)
}

export async function resumeProviderPolicyBlockedQueue(
  stateManager: CentralizedStateManager,
  ensureOffscreenReady: () => Promise<void>
): Promise<void> {
  const globalState = await stateManager.getGlobalState()
  const blockedTask = globalState.downloadQueue.find(
    (task) =>
      task.status === "queued" &&
      task.activeBlock === "provider_network_policy_pending"
  )
  if (blockedTask) {
    await resumeDownloadTask(stateManager, blockedTask.id, ensureOffscreenReady)
    return
  }

  await processDownloadQueue(stateManager, ensureOffscreenReady)
}

export async function failDisabledDnrProviderTasks(
  stateManager: CentralizedStateManager,
  enablement: SiteIntegrationEnablementMap,
  ensureOffscreenReady: () => Promise<void>
): Promise<void> {
  const globalState = await stateManager.getGlobalState()
  const disabledTasks = globalState.downloadQueue.filter((task) => {
    if (
      (task.status !== "queued" && task.status !== "downloading") ||
      task.browserDownloadWait
    ) {
      return false
    }
    const hasDnrPolicy =
      (getSiteIntegrationManifestById(task.siteIntegrationId)?.network
        ?.sessionRefererRules?.length ?? 0) > 0
    return hasDnrPolicy && enablement[task.siteIntegrationId] === false
  })

  let transitioned = false
  for (const task of disabledTasks) {
    const interruptedTask = normalizeInterruptedTask(
      task,
      "Integration disabled"
    )
    const transition = await stateManager.transitionDownloadTask(
      task.id,
      ["queued", "downloading"],
      {
        status: interruptedTask.status,
        chapters: interruptedTask.chapters,
        activeBlock: undefined,
        browserDownloadWait: undefined,
        errorMessage: interruptedTask.errorMessage,
        errorCategory: interruptedTask.errorCategory,
        completed: interruptedTask.completed,
      }
    )
    if (!transition.success) continue

    transitioned = true
    await cancelActiveDispatchForTaskBestEffort(task.id)
    await notifyTerminalDownloadTask({
      task: transition.task,
      finalStatus: transition.task.status,
      completedCount: transition.task.chapters.filter(
        (chapter) => chapter.status === "completed"
      ).length,
      totalChapters: transition.task.chapters.length,
    })
  }

  if (transitioned) {
    await clearActiveTaskProgress()
    scheduleQueueContinuation(stateManager, ensureOffscreenReady)
  }
}

export async function processDownloadQueue(
  stateManager: CentralizedStateManager,
  ensureOffscreenReady: () => Promise<void>
): Promise<void> {
  try {
    const globalState = await stateManager.getGlobalState()
    const queuedTasks = globalState.downloadQueue.filter(isRunnableQueuedTask)
    const activeTasks = globalState.downloadQueue.filter(
      isExecutingDownloadTask
    )
    const concurrentLimit = MAX_CONCURRENT_QUEUED_TASKS
    const availableSlots = Math.max(0, concurrentLimit - activeTasks.length)

    if (queuedTasks.length === 0) {
      if (activeTasks.length === 0) {
        await onQueueDrained?.()
      }
      return
    }

    if (availableSlots === 0) {
      return
    }

    logger.info("[Queue]", {
      event: "PROCESSING",
      queued: queuedTasks.length,
      active: activeTasks.length,
      availableSlots,
    })

    let startedTasks = 0
    for (const task of queuedTasks) {
      if (startedTasks >= availableSlots) {
        break
      }

      const latestGlobalState = await stateManager.getGlobalState()
      const latestTask = latestGlobalState.downloadQueue.find(
        (currentTask) => currentTask.id === task.id
      )
      if (!latestTask || !isRunnableQueuedTask(latestTask)) {
        continue
      }

      const latestActiveTasks = latestGlobalState.downloadQueue.filter(
        isExecutingDownloadTask
      )
      if (latestActiveTasks.length >= concurrentLimit) {
        break
      }

      let startedTask = false

      const currentTask = (
        await stateManager.getGlobalState()
      ).downloadQueue.find(
        (currentQueuedTask) => currentQueuedTask.id === latestTask.id
      )
      if (currentTask && isRunnableQueuedTask(currentTask)) {
        await startDownloadTask(
          stateManager,
          latestTask.id,
          ensureOffscreenReady
        )
        startedTask = true
      }

      if (startedTask) {
        startedTasks += 1
      }
    }
  } catch (error) {
    logger.error("[Queue]", {
      event: "FAILED",
      reason: "INTERNAL_ERROR",
      error,
    })
  }
}
