import logger from "@/src/runtime/logger"
import type {
  DispatchLeaseAuthority,
  DownloadTaskState,
} from "@/src/domain/queue/state"
import type { ChapterDispatchOutcome } from "@/src/domain/queue/task-lifecycle"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import { resolveDownloadPlan } from "./queue-helpers"
import type { DestinationService } from "./destination"
import { composeSeriesKey } from "@/src/runtime/queue-task-summary"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import type { SiteIntegrationSettingsService } from "@/src/storage/site-integration-settings-service"
import { isEnabled } from "@/src/site-integrations/catalog"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { runTaskSideEffectExclusive } from "./download-task-side-effect-gate"
import { progressTimingEstimator } from "@/src/runtime/progress-timing-estimates"
import { createOffscreenDispatchFingerprint } from "@/src/runtime/offscreen-job-fingerprint"
import { resolveSiteIntegrationDispatchContext } from "@/src/runtime/site-integration-dispatch-context"
import {
  ProviderNetworkPolicyActionRequiredError,
  ProviderNetworkPolicyPendingError,
} from "@/src/site-integrations/session-rule-manager"
import type { SiteIntegrationSessionRuleManager } from "@/src/site-integrations/session-rule-manager"
import type { DownloadTaskCancellationCoordinator } from "./download-task-cancellation-coordinator"

export interface ChapterDispatchSession {
  task: DownloadTaskState
  taskId: string
  settingsSnapshot: DownloadTaskState["settingsSnapshot"]
  chapterOutcomesByIndex: Array<ChapterDispatchOutcome | undefined>
  shouldStopDispatch: boolean
  lastDownloadMode: "custom" | "browser"
  currentLeaseForTask?: DispatchLeaseAuthority
}

export class ChapterDispatchCoordinator {
  constructor(
    private readonly stateManager: QueueRepository,
    private readonly runOffscreenDocumentAdmissionExclusive: <T>(
      operation: () => Promise<T>
    ) => Promise<T>,
    private readonly cancellationCoordinator: DownloadTaskCancellationCoordinator,
    private readonly sessionRuleManager: SiteIntegrationSessionRuleManager,
    private readonly destinationService: DestinationService,
    private readonly siteIntegrationEnablementService: Pick<
      SiteIntegrationEnablementService,
      "getAll"
    >,
    private readonly siteIntegrationSettingsReader: Pick<
      SiteIntegrationSettingsService,
      "getAll" | "getForSite"
    >
  ) {}

  async dispatch(
    session: ChapterDispatchSession,
    chapterIndex: number
  ): Promise<DispatchLeaseAuthority | undefined> {
    const { task, taskId, settingsSnapshot, chapterOutcomesByIndex } = session
    const stateManager = this.stateManager
    const configuredOffscreenAdmission =
      this.runOffscreenDocumentAdmissionExclusive
    const cancellationCoordinator = this.cancellationCoordinator
    let { shouldStopDispatch, lastDownloadMode, currentLeaseForTask } = session
    try {
      const taskChapter = task.chapters[chapterIndex]
      if (!taskChapter) {
        throw new Error(
          `Task chapter is missing at dispatch index ${chapterIndex}`
        )
      }
      let dispatchLeaseAuthority: DispatchLeaseAuthority | undefined
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
            chapterId: taskChapter.id,
            status: "failed",
            errorMessage: "Chapter missing from resolved dispatch plan",
            errorCategory: "unknown",
          }
          return undefined
        }

        const latestTask = await stateManager.getTask(taskId)
        if (!latestTask || latestTask.status !== "downloading") {
          shouldStopDispatch = true
          logger.info("[Queue]", {
            event: "CHAPTER_DISPATCH_ABORTED",
            taskId,
            reason: "TASK_NOT_DOWNLOADING",
          })
          return undefined
        }

        const destination =
          await this.destinationService.getEffectiveDestination({
            taskId,
            chapterId: chapter.id,
            destination: latestTask.settingsSnapshot.destination,
            destinationOverride: latestTask.destinationOverride,
          })
        const saveMode: RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">["payload"]["saveMode"] =
          destination.kind === "custom" ? "fsa" : "downloads-api"
        lastDownloadMode = destination.kind === "custom" ? "custom" : "browser"

        const currentEnablement =
          await this.siteIntegrationEnablementService.getAll()
        if (!isEnabled(task.siteIntegrationId, currentEnablement)) {
          throw new ProviderNetworkPolicyActionRequiredError(
            task.siteIntegrationId,
            "integration_disabled"
          )
        }

        const currentChapter = latestTask.chapters.find(
          (taskChapter) => taskChapter.id === chapter.id
        )
        const existingLease = await stateManager.getActiveDispatchLease()
        const reusableLease =
          currentChapter?.status === "downloading" &&
          existingLease?.taskId === taskId &&
          existingLease.chapterId === chapter.id
        if (!reusableLease) {
          await this.sessionRuleManager.ensureNetworkReady(
            task.siteIntegrationId
          )
        }
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
          siteIntegrationSettingsReader: this.siteIntegrationSettingsReader,
        })

        const unsignedPayload = {
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
            index: taskChapter.index,
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
        }
        const fingerprint =
          await createOffscreenDispatchFingerprint(unsignedPayload)
        const dispatchMessage: RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER"> =
          {
            target: "offscreen",
            type: "OFFSCREEN_DOWNLOAD_CHAPTER",
            payload: {
              ...unsignedPayload,
              fingerprint,
            },
          }

        if (reusableLease && existingLease.fingerprint !== fingerprint) {
          throw new Error(
            "Recovered dispatch fingerprint does not match durable lease"
          )
        }
        return await runTaskSideEffectExclusive(taskId, async () => {
          const [taskAtAdmission, leaseAtAdmission] = await Promise.all([
            stateManager.getTask(taskId),
            stateManager.getActiveDispatchLease(),
          ])
          const chapterAtAdmission = taskAtAdmission?.chapters.find(
            (taskChapter) => taskChapter.id === chapter.id
          )
          const reusableAuthorityIsCurrent =
            reusableLease &&
            chapterAtAdmission?.status === "downloading" &&
            leaseAtAdmission?.jobId === existingLease.jobId &&
            leaseAtAdmission.attempt === existingLease.attempt &&
            leaseAtAdmission.taskId === existingLease.taskId &&
            leaseAtAdmission.chapterId === existingLease.chapterId &&
            leaseAtAdmission.fingerprint === existingLease.fingerprint
          const newAuthorityCanStart =
            !reusableLease &&
            chapterAtAdmission?.status === "queued" &&
            leaseAtAdmission === null
          if (
            !taskAtAdmission ||
            taskAtAdmission.status !== "downloading" ||
            (!reusableAuthorityIsCurrent && !newAuthorityCanStart)
          ) {
            shouldStopDispatch = true
            return undefined
          }

          const chapterStart = reusableLease
            ? await stateManager.updateChapterProgress({
                taskId,
                chapterId: chapter.id,
                lease: existingLease,
                now: Date.now(),
              })
            : await stateManager.beginChapterDispatch({
                taskId,
                chapterId: chapter.id,
                expectedPreviousLease: null,
                lease: createDispatchLease({
                  jobId,
                  taskId,
                  chapterId: chapter.id,
                  attempt,
                  fingerprint,
                  saveMode,
                }),
                now: Date.now(),
              })
          if (chapterStart.outcome === "rejected") {
            shouldStopDispatch = true
            return undefined
          }
          dispatchLeaseAuthority = reusableLease
            ? existingLease
            : "lease" in chapterStart
              ? chapterStart.lease
              : undefined
          if (!dispatchLeaseAuthority) {
            throw new Error(
              "Chapter dispatch lease admission produced no authority"
            )
          }
          currentLeaseForTask = dispatchLeaseAuthority

          const response = await configuredOffscreenAdmission(async () => {
            const [taskBeforeSend, leaseBeforeSend] = await Promise.all([
              stateManager.getTask(taskId),
              stateManager.getActiveDispatchLease(),
            ])
            const chapterBeforeSend = taskBeforeSend?.chapters.find(
              (taskChapter) => taskChapter.id === chapter.id
            )
            if (
              taskBeforeSend?.status !== "downloading" ||
              chapterBeforeSend?.status !== "downloading" ||
              leaseBeforeSend?.jobId !== jobId ||
              leaseBeforeSend.attempt !== attempt ||
              leaseBeforeSend.taskId !== taskId ||
              leaseBeforeSend.chapterId !== chapter.id ||
              leaseBeforeSend.fingerprint !== fingerprint
            ) {
              throw new Error(
                "Chapter dispatch authority changed before offscreen admission"
              )
            }
            return await sendRuntimeMessage(dispatchMessage)
          })
          if (!response.success) throw new Error(response.error)
          if (
            response.accepted !== true ||
            response.jobId !== jobId ||
            response.attempt !== attempt ||
            response.taskId !== taskId ||
            response.chapterId !== chapter.id ||
            response.fingerprint !== fingerprint
          ) {
            throw new Error("Offscreen dispatch acknowledgement mismatch")
          }
          const binding = await stateManager.bindDispatchLeaseIncarnation({
            jobId,
            attempt,
            taskId,
            chapterId: chapter.id,
            fingerprint,
            documentInstanceId: response.documentInstanceId,
          })
          if (binding.outcome === "rejected") {
            throw new Error("Offscreen dispatch incarnation binding rejected")
          }
          dispatchLeaseAuthority = binding.lease
          currentLeaseForTask = binding.lease
          logger.info("[Queue]", {
            event: "CHAPTER_DISPATCH_ACCEPTED",
            taskId,
            chapterId: chapter.id,
            jobId,
            attempt,
          })
          return binding.lease
        })
      } catch (error) {
        if (
          error instanceof ProviderNetworkPolicyPendingError ||
          error instanceof ProviderNetworkPolicyActionRequiredError
        ) {
          if (dispatchedJob) {
            const currentLease = await stateManager.getActiveDispatchLease()
            const cleared =
              currentLease !== null &&
              currentLease.jobId === dispatchedJob.jobId &&
              currentLease.attempt === dispatchedJob.attempt &&
              currentLease.taskId === dispatchedJob.taskId &&
              currentLease.chapterId === dispatchedJob.chapterId &&
              (await cancellationCoordinator.cancelProducerAndClearLease(
                currentLease
              )) !== undefined
            if (cleared) currentLeaseForTask = undefined
          }
          throw error
        }
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        chapterOutcomesByIndex[chapterIndex] = {
          chapterId: taskChapter.id,
          status: "failed",
          errorMessage,
          errorCategory: "unknown",
        }

        // Liveness recovery may have already marked the chapter/task terminal
        // with a more accurate "Download process unresponsive" error when the
        // offscreen was closed mid-flight. Don't overwrite that with the
        // sendMessage rejection error ("message channel closed"), which is a
        // downstream symptom of the offscreen being closed, not the root cause.
        const currentTask = await stateManager.getTask(taskId)
        const currentChapter = currentTask?.chapters.find(
          (c) => c.id === taskChapter.id
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
        if (!chapterAlreadyTerminal) {
          const chapterFailure = await stateManager.settleTaskChapter({
            taskId,
            chapterId: taskChapter.id,
            status: "failed",
            lease: dispatchLeaseAuthority,
            now: Date.now(),
            updates: {
              errorMessage,
              errorCategory: "unknown",
            },
          })
          if (chapterFailure.outcome === "rejected") {
            shouldStopDispatch = true
            chapterFailureAccepted = false
          }
        }

        if (!taskAlreadyTerminal && chapterFailureAccepted) {
          await stateManager.recordTaskDispatchError({
            taskId,
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
        }
        return dispatchLeaseAuthority
      }
    } finally {
      session.shouldStopDispatch = shouldStopDispatch
      session.lastDownloadMode = lastDownloadMode
      session.currentLeaseForTask = currentLeaseForTask
    }
  }
}
