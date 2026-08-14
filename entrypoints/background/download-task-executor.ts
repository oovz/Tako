import logger from "@/src/runtime/logger"
import type { DispatchLeaseAuthority } from "@/src/domain/queue/state"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { clearActiveTaskProgress } from "./active-task-progress-bus"
import { validateDownloadPathForTask } from "./queue-helpers"
import {
  finalizeDownloadTaskAfterDispatch,
  notifyDownloadTaskCompletion,
  type DownloadQueueFinalizationDependencies,
} from "./download-queue-finalization"
import { DestinationService } from "./destination"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import { isEnabled } from "@/src/site-integrations/catalog"
import type { ProviderPolicyQueueCoordinator } from "./provider-policy-queue-coordinator"
import type { DownloadTaskCancellationCoordinator } from "./download-task-cancellation-coordinator"
import {
  ProviderNetworkPolicyActionRequiredError,
  ProviderNetworkPolicyPendingError,
} from "@/src/site-integrations/session-rule-manager"
import type { SiteIntegrationSessionRuleManager } from "@/src/site-integrations/session-rule-manager"
import type { ChapterDispatchOutcome } from "@/src/domain/queue/task-lifecycle"
import type {
  ChapterDispatchCoordinator,
  ChapterDispatchSession,
} from "./chapter-dispatch-coordinator"

export type TaskExecutionResult = "active" | "queue-continuation" | "wait"

export class DownloadTaskExecutor {
  private readonly activeTasks = new Map<string, Promise<TaskExecutionResult>>()

  constructor(
    private readonly stateManager: QueueRepository,
    private readonly ensureOffscreenReady: () => Promise<void>,
    private readonly cancellationCoordinator: DownloadTaskCancellationCoordinator,
    private readonly providerPolicyCoordinator: ProviderPolicyQueueCoordinator,
    private readonly chapterDispatchCoordinator: ChapterDispatchCoordinator,
    private readonly sessionRuleManager: SiteIntegrationSessionRuleManager,
    private readonly destinationService: DestinationService,
    private readonly siteIntegrationEnablementService: Pick<
      SiteIntegrationEnablementService,
      "getAll"
    >,
    private readonly finalizationDependencies: DownloadQueueFinalizationDependencies
  ) {}

  async execute(
    taskId: string,
    resumeExistingTask = false
  ): Promise<TaskExecutionResult> {
    const existing = this.activeTasks.get(taskId)
    if (existing) return await existing

    const pending = runDownloadTask(
      this.stateManager,
      taskId,
      this.ensureOffscreenReady,
      this.cancellationCoordinator,
      this.providerPolicyCoordinator,
      this.chapterDispatchCoordinator,
      this.sessionRuleManager,
      this.destinationService,
      this.siteIntegrationEnablementService,
      this.finalizationDependencies,
      resumeExistingTask
    )
    this.activeTasks.set(taskId, pending)
    try {
      return await pending
    } finally {
      if (this.activeTasks.get(taskId) === pending) {
        this.activeTasks.delete(taskId)
      }
    }
  }

  isActive(taskId: string): boolean {
    return this.activeTasks.has(taskId)
  }
}

async function runDownloadTask(
  stateManager: QueueRepository,
  taskId: string,
  ensureOffscreenReady: () => Promise<void>,
  cancellationCoordinator: DownloadTaskCancellationCoordinator,
  providerPolicyCoordinator: ProviderPolicyQueueCoordinator,
  chapterDispatchCoordinator: ChapterDispatchCoordinator,
  sessionRuleManager: SiteIntegrationSessionRuleManager,
  destinationService: DestinationService,
  siteIntegrationEnablementService: Pick<
    SiteIntegrationEnablementService,
    "getAll"
  >,
  finalizationDependencies: DownloadQueueFinalizationDependencies,
  resumeExistingTask: boolean = false
): Promise<TaskExecutionResult> {
  let currentLeaseForTask: DispatchLeaseAuthority | undefined
  let dispatchSession: ChapterDispatchSession | undefined
  try {
    logger.info("[Queue]", {
      event: "STARTED",
      taskId,
    })

    let task = await stateManager.getTask(taskId)

    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    if (!resumeExistingTask) {
      const startTransition = await stateManager.startDownloadTask({
        taskId,
        now: Date.now(),
      })
      if (startTransition.outcome !== "applied") {
        logger.info("[Queue]", {
          event: "START_SKIPPED",
          taskId,
          reason: startTransition.reason,
        })
        return "wait"
      }
      task = startTransition.task
    }
    await providerPolicyCoordinator.acknowledgeAfterAdmission()

    // Seed the exact failure-boundary lease at entry. Each successful chapter
    // admission replaces it below so later failures cannot strand a new lease.
    const entryDispatchLease = await stateManager.getActiveDispatchLease()
    const taskEntryLease =
      entryDispatchLease?.taskId === taskId ? entryDispatchLease : undefined
    currentLeaseForTask = taskEntryLease
    const entryLeaseChapter = taskEntryLease
      ? task.chapters.find(
          (chapter) =>
            chapter.id === taskEntryLease.chapterId &&
            chapter.status === "downloading"
        )
      : undefined
    const canReuseEntryLease =
      resumeExistingTask &&
      task.status === "downloading" &&
      entryLeaseChapter !== undefined

    if (taskEntryLease && !canReuseEntryLease) {
      const cleared =
        (await cancellationCoordinator.cancelProducerAndClearLease(
          taskEntryLease
        )) !== undefined
      if (cleared) currentLeaseForTask = undefined
    }

    // An integration being disabled is a definitive task failure. Check it
    // before destination preflight so a stale FSA permission issue cannot
    // leave a resumed task occupying the only active queue slot forever.
    const integrationEnablement =
      await siteIntegrationEnablementService.getAll()
    if (!isEnabled(task.siteIntegrationId, integrationEnablement)) {
      const interruption = await cancellationCoordinator.interruptTask({
        taskId,
        errorMessage: "Integration disabled",
      })
      return interruption === "settled" ? "queue-continuation" : "wait"
    }

    // Session-scoped DNR rules are cleared on browser shutdown and extension
    // update. DNR-dependent providers must not start destination/offscreen work
    // until their current network policy has been installed. Providers without
    // declared session rules return immediately.
    if (!canReuseEntryLease) {
      await sessionRuleManager.ensureNetworkReady(task.siteIntegrationId)
    }
    if (
      task.activeBlock === "provider_network_policy_pending" ||
      task.activeBlock === "provider_network_policy_action_required"
    ) {
      await stateManager.releaseProviderPolicyBlock(taskId)
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
      const transition = await stateManager.blockTaskForDestination({
        taskId,
        now: Date.now(),
      })
      if (transition.outcome === "applied") {
        try {
          await destinationService.recordDestinationIssue(
            taskDestinationContext,
            destinationPreflight
          )
        } catch (error) {
          logger.warn("[Queue] Destination diagnostic write failed", error)
        }
      }
      if (currentLeaseForTask) {
        await cancellationCoordinator.cancelProducerAndClearLease(
          currentLeaseForTask
        )
      }
      await clearActiveTaskProgress()
      logger.info("[Queue]", {
        event: "DESTINATION_ACTION_REQUIRED",
        taskId,
        reason: destinationPreflight.reason,
      })
      return "queue-continuation"
    }
    if (task.activeBlock === "destination_action_required") {
      const transition = await stateManager.releaseDestinationBlock(taskId)
      if (transition.outcome === "applied") {
        try {
          await destinationService.clearDestinationIssuesForTask(taskId)
        } catch (error) {
          logger.warn("[Queue] Destination diagnostic cleanup failed", error)
        }
      }
    }

    await ensureOffscreenReady()

    validateDownloadPathForTask(taskId, {
      downloads: {
        pathTemplate: task.settingsSnapshot.pathTemplate,
      },
    })

    const settingsSnapshot = task.settingsSnapshot
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
    dispatchSession = {
      task,
      taskId,
      settingsSnapshot,
      chapterOutcomesByIndex,
      shouldStopDispatch: false,
      lastDownloadMode: "browser",
      currentLeaseForTask,
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
      if (dispatchSession.shouldStopDispatch) {
        break
      }

      const chapterIndex = chapterIndicesToDispatch[position]
      if (chapterIndex === undefined) break
      const settledDispatchLease = await chapterDispatchCoordinator.dispatch(
        dispatchSession,
        chapterIndex
      )
      if (settledDispatchLease) {
        return "active"
      }
    }

    if (dispatchSession.shouldStopDispatch) {
      await clearActiveTaskProgress()
      return "queue-continuation"
    }

    const latestTaskAfterDispatch = await stateManager.getTask(taskId)
    if (
      !latestTaskAfterDispatch ||
      latestTaskAfterDispatch.status !== "downloading"
    ) {
      await clearActiveTaskProgress()
      return "queue-continuation"
    }

    const finalization = await finalizeDownloadTaskAfterDispatch({
      stateManager,
      taskId,
      chapterOutcomesByIndex,
      settingsSnapshot,
      finalizationDependencies,
    })
    await clearActiveTaskProgress()

    if (!finalization.finalized) {
      return "queue-continuation"
    }

    const { chapterOutcomes, completedCount, finalStatus } = finalization

    await notifyDownloadTaskCompletion({
      stateManager,
      taskId,
      finalStatus,
      completedCount,
      totalChapters: chapterOutcomes.length,
      settingsRepository: finalizationDependencies.settingsRepository,
    })

    logger.info("[Queue]", {
      event: "OFFSCREEN_DISPATCHED",
      taskId,
      jobId: `dispatch_loop_${taskId}`,
      mode: dispatchSession.lastDownloadMode,
      chapters: task.chapters.length,
    })
    return "queue-continuation"
  } catch (error) {
    if (error instanceof ProviderNetworkPolicyPendingError) {
      const blockTransition = await stateManager.blockTaskForProviderPolicy({
        taskId,
        block: "provider_network_policy_pending",
      })
      await clearActiveTaskProgress()
      const leaseForFailure =
        dispatchSession?.currentLeaseForTask ?? currentLeaseForTask
      if (leaseForFailure) {
        await cancellationCoordinator.cancelProducerAndClearLease(
          leaseForFailure
        )
      }
      logger.warn("[Queue]", {
        event: "PROVIDER_NETWORK_POLICY_PENDING",
        taskId,
        siteIntegrationId: error.siteIntegrationId,
        reason: error.message,
      })
      return blockTransition.outcome === "applied"
        ? "queue-continuation"
        : "wait"
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
    const failureTransition = await cancellationCoordinator.interruptTask({
      taskId,
      errorMessage,
    })
    return failureTransition === "settled" ? "queue-continuation" : "wait"
  }
}
