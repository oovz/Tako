import { getEffectiveTaskDestination } from "@/src/domain/queue/task-destination"
import logger from "@/src/runtime/logger"
import { runDestinationAccessExclusive } from "./destination-access"
import type {
  DispatchLeaseAuthority,
  DownloadTaskState,
} from "@/src/domain/queue/state"
import type { ChapterDispatchOutcome } from "@/src/domain/queue/task-lifecycle"
import { isTerminalDownloadTask } from "@/src/domain/queue/task-lifecycle"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import { resolveDownloadPlan } from "./queue-helpers"
import { DestinationPreflightError } from "./destination"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import type { SiteIntegrationSettingsService } from "@/src/storage/site-integration-settings-service"
import { isEnabled } from "@/src/site-integrations/catalog"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { runTaskSideEffectExclusive } from "./download-task-side-effect-gate"
import { progressTimingEstimatesRepository as progressTimingEstimator } from "@/src/storage/progress-timing-estimates-repository"
import {
  ProviderNetworkPolicyActionRequiredError,
  ProviderNetworkPolicyPendingError,
} from "@/src/site-integrations/session-rule-manager"
import type { SiteIntegrationSessionRuleManager } from "@/src/site-integrations/session-rule-manager"
import type { DownloadTaskCancellationCoordinator } from "./download-task-cancellation-coordinator"
import {
  reusableChapterLease,
  canAdmitChapterDispatch,
  canSendChapterDispatch,
  createChapterDispatchMessage,
  assertChapterDispatchAcknowledged,
  sameDispatchJob,
  type ChapterDispatchCandidate,
  type ChapterDispatchContext,
  type ChapterDispatchMessage,
  type ChapterDispatchIdentity,
} from "./chapter-dispatch-coordinator-context"

interface DispatchAttemptState {
  shouldStopDispatch: boolean
  lastDownloadMode: "custom" | "browser"
  currentLeaseForTask?: DispatchLeaseAuthority
  dispatchLeaseAuthority?: DispatchLeaseAuthority
  dispatchedJob?: ChapterDispatchIdentity
}

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
    return runDestinationAccessExclusive(() =>
      this.dispatchChapter(session, chapterIndex)
    )
  }

  private async dispatchChapter(
    session: ChapterDispatchSession,
    chapterIndex: number
  ): Promise<DispatchLeaseAuthority | undefined> {
    const { settingsSnapshot } = session
    const attempt: DispatchAttemptState = {
      shouldStopDispatch: session.shouldStopDispatch,
      lastDownloadMode: session.lastDownloadMode,
      currentLeaseForTask: session.currentLeaseForTask,
    }
    try {
      const taskChapter = session.task.chapters[chapterIndex]
      if (!taskChapter)
        throw new Error(
          `Task chapter is missing at dispatch index ${chapterIndex}`
        )
      try {
        const context = await this.prepareDispatch(
          session,
          chapterIndex,
          attempt
        )
        if (!context) return undefined
        await this.requireIntegrationEnabled(session.task.siteIntegrationId)
        const candidate = await this.prepareCandidate(context, session)
        attempt.dispatchedJob = candidate.identity
        const message = await createChapterDispatchMessage(
          context,
          candidate,
          settingsSnapshot,
          this.siteIntegrationSettingsReader
        )
        return await runTaskSideEffectExclusive(session.taskId, () =>
          this.admitAndSend(context, candidate, message, attempt)
        )
      } catch (error) {
        return await this.handleDispatchError(
          error,
          session,
          chapterIndex,
          taskChapter.id,
          attempt
        )
      }
    } finally {
      session.shouldStopDispatch = attempt.shouldStopDispatch
      session.lastDownloadMode = attempt.lastDownloadMode
      session.currentLeaseForTask = attempt.currentLeaseForTask
    }
  }

  private async prepareDispatch(
    session: ChapterDispatchSession,
    chapterIndex: number,
    attempt: DispatchAttemptState
  ): Promise<ChapterDispatchContext | undefined> {
    const plan = await resolveDownloadPlan(session.task)
    const chapter = plan.chapters[chapterIndex]
    const taskChapter = session.task.chapters[chapterIndex]
    if (!chapter) {
      session.chapterOutcomesByIndex[chapterIndex] = {
        chapterId: taskChapter.id,
        status: "failed",
        errorMessage: "Chapter missing from resolved dispatch plan",
        errorCategory: "unknown",
      }
      return undefined
    }
    const latestTask = await this.stateManager.getTask(session.taskId)
    if (!latestTask || latestTask.status !== "downloading") {
      attempt.shouldStopDispatch = true
      logger.info("[Queue]", {
        event: "CHAPTER_DISPATCH_ABORTED",
        taskId: session.taskId,
        reason: "TASK_NOT_DOWNLOADING",
      })
      return undefined
    }
    const destination = getEffectiveTaskDestination(latestTask)
    const saveMode =
      destination.kind === "file-system-access" ? "fsa" : "downloads-api"
    attempt.lastDownloadMode =
      destination.kind === "file-system-access" ? "custom" : "browser"
    return { plan, chapter, taskChapter, latestTask, destination, saveMode }
  }

  private async requireIntegrationEnabled(siteIntegrationId: string) {
    const enablement = await this.siteIntegrationEnablementService.getAll()
    if (!isEnabled(siteIntegrationId, enablement))
      throw new ProviderNetworkPolicyActionRequiredError(
        siteIntegrationId,
        "integration_disabled"
      )
  }

  private async prepareCandidate(
    context: ChapterDispatchContext,
    session: ChapterDispatchSession
  ): Promise<ChapterDispatchCandidate> {
    const { latestTask, chapter } = context
    const currentChapter = latestTask.chapters.find(
      (taskChapter) => taskChapter.id === chapter.id
    )
    const existingLease = await this.stateManager.getActiveDispatchLease()
    const reusableLease = reusableChapterLease(
      latestTask,
      session.taskId,
      chapter.id,
      existingLease
    )
    if (!reusableLease)
      await this.sessionRuleManager.ensureNetworkReady(
        session.task.siteIntegrationId
      )
    return {
      identity: {
        jobId: reusableLease ? reusableLease.jobId : crypto.randomUUID(),
        attempt: reusableLease
          ? reusableLease.attempt
          : (currentChapter?.dispatchAttempt ?? 0) + 1,
        taskId: session.taskId,
        chapterId: chapter.id,
      },
      reusableLease,
    }
  }

  private async admitAndSend(
    context: ChapterDispatchContext,
    candidate: ChapterDispatchCandidate,
    message: ChapterDispatchMessage,
    attempt: DispatchAttemptState
  ): Promise<DispatchLeaseAuthority | undefined> {
    const { taskId } = candidate.identity
    const [task, lease] = await Promise.all([
      this.stateManager.getTask(taskId),
      this.stateManager.getActiveDispatchLease(),
    ])
    if (!canAdmitChapterDispatch(task, lease, candidate)) {
      attempt.shouldStopDispatch = true
      return undefined
    }
    const admission = await this.beginOrResumeDispatch(
      context,
      candidate,
      message
    )
    if (admission.outcome === "rejected") {
      attempt.shouldStopDispatch = true
      return undefined
    }
    attempt.dispatchLeaseAuthority =
      candidate.reusableLease ??
      ("lease" in admission ? admission.lease : undefined)
    if (!attempt.dispatchLeaseAuthority)
      throw new Error("Chapter dispatch lease admission produced no authority")
    attempt.currentLeaseForTask = attempt.dispatchLeaseAuthority
    const boundLease = await this.sendAndBind(candidate, message)
    attempt.dispatchLeaseAuthority = boundLease
    attempt.currentLeaseForTask = boundLease
    logger.info("[Queue]", {
      event: "CHAPTER_DISPATCH_ACCEPTED",
      taskId: candidate.identity.taskId,
      chapterId: candidate.identity.chapterId,
      jobId: candidate.identity.jobId,
      attempt: candidate.identity.attempt,
    })
    return boundLease
  }

  private async beginOrResumeDispatch(
    context: ChapterDispatchContext,
    candidate: ChapterDispatchCandidate,
    message: ChapterDispatchMessage
  ) {
    const { identity, reusableLease } = candidate
    if (reusableLease)
      return await this.stateManager.updateChapterProgress({
        taskId: identity.taskId,
        chapterId: identity.chapterId,
        lease: reusableLease,
        now: Date.now(),
      })
    return await this.stateManager.beginChapterDispatch({
      taskId: identity.taskId,
      chapterId: identity.chapterId,
      expectedPreviousLease: null,
      lease: createDispatchLease({
        ...identity,
        fingerprint: message.payload.fingerprint,
        saveMode: context.saveMode,
        destinationHandleId:
          context.destination.kind === "file-system-access"
            ? context.destination.handleId!
            : undefined,
      }),
      now: Date.now(),
    })
  }

  private async sendAndBind(
    candidate: ChapterDispatchCandidate,
    message: ChapterDispatchMessage
  ): Promise<DispatchLeaseAuthority> {
    const { identity } = candidate
    const response = await this.runOffscreenDocumentAdmissionExclusive(
      async () => {
        const [task, lease] = await Promise.all([
          this.stateManager.getTask(identity.taskId),
          this.stateManager.getActiveDispatchLease(),
        ])
        if (!canSendChapterDispatch(task, lease, message))
          throw new Error(
            "Chapter dispatch authority changed before offscreen admission"
          )
        return await sendRuntimeMessage(message)
      }
    )
    const accepted = assertChapterDispatchAcknowledged(response, message)
    const binding = await this.stateManager.bindDispatchLeaseIncarnation({
      ...identity,
      fingerprint: message.payload.fingerprint,
      documentInstanceId: accepted.documentInstanceId,
    })
    if (binding.outcome === "rejected")
      throw new Error("Offscreen dispatch incarnation binding rejected")
    return binding.lease
  }

  private async clearPolicyBlockedProducer(attempt: DispatchAttemptState) {
    if (!attempt.dispatchedJob) return
    const lease = await this.stateManager.getActiveDispatchLease()
    if (
      sameDispatchJob(lease, attempt.dispatchedJob) &&
      (await this.cancellationCoordinator.cancelProducerAndClearLease(
        lease
      )) !== undefined
    )
      attempt.currentLeaseForTask = undefined
  }

  private async handleDispatchError(
    error: unknown,
    session: ChapterDispatchSession,
    chapterIndex: number,
    chapterId: string,
    attempt: DispatchAttemptState
  ): Promise<DispatchLeaseAuthority | undefined> {
    if (
      error instanceof ProviderNetworkPolicyPendingError ||
      error instanceof ProviderNetworkPolicyActionRequiredError
    ) {
      await this.clearPolicyBlockedProducer(attempt)
      throw error
    }
    if (error instanceof DestinationPreflightError) throw error
    const errorMessage = error instanceof Error ? error.message : String(error)
    session.chapterOutcomesByIndex[chapterIndex] = {
      chapterId,
      status: "failed",
      errorMessage,
      errorCategory: "unknown",
    }
    await this.persistDispatchFailure(
      session.taskId,
      chapterId,
      errorMessage,
      attempt
    )
    logger.error("[Queue]", {
      event: "CHAPTER_DISPATCH_FAILED",
      taskId: session.taskId,
      chapterIndex: chapterIndex + 1,
      error,
    })
    if (attempt.dispatchedJob)
      await progressTimingEstimator.finish(attempt.dispatchedJob.jobId)
    return attempt.dispatchLeaseAuthority
  }

  private async persistDispatchFailure(
    taskId: string,
    chapterId: string,
    errorMessage: string,
    attempt: DispatchAttemptState
  ) {
    // Recovery can settle the producer before transport rejection arrives. Preserve its cause.
    const task = await this.stateManager.getTask(taskId)
    const chapter = task?.chapters.find((chapter) => chapter.id === chapterId)
    const chapterTerminal = chapter && hasSettledProducerStatus(chapter.status)
    const taskTerminal = task && isTerminalDownloadTask(task)
    let failureAccepted = true
    if (!chapterTerminal) {
      const failure = await this.stateManager.settleTaskChapter({
        taskId,
        chapterId,
        status: "failed",
        lease: attempt.dispatchLeaseAuthority,
        now: Date.now(),
        updates: { errorMessage, errorCategory: "unknown" },
      })
      if (failure.outcome === "rejected") {
        attempt.shouldStopDispatch = true
        failureAccepted = false
      }
    }
    if (!taskTerminal && failureAccepted)
      await this.stateManager.recordTaskDispatchError({
        taskId,
        errorMessage,
        errorCategory: "unknown",
      })
    if (taskTerminal) attempt.shouldStopDispatch = true
  }
}

function hasSettledProducerStatus(status: string) {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "partial_success"
  )
}
