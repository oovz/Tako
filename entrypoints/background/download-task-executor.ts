import { getEffectiveTaskDestination } from "@/src/domain/queue/task-destination"
import logger from "@/src/runtime/logger"
import type {
  DispatchLeaseAuthority,
  DownloadTaskState,
} from "@/src/domain/queue/state"
import type { QueueRepository } from "@/src/storage/queue-repository"
import { clearActiveTaskProgress } from "./active-task-progress-bus"
import {
  finalizeDownloadTaskAfterDispatch,
  notifyDownloadTaskCompletion,
  type DownloadQueueFinalizationDependencies,
} from "./download-queue-finalization"
import { DestinationPreflightError, DestinationService } from "./destination"
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

interface TaskExecution {
  taskId: string
  currentLeaseForTask?: DispatchLeaseAuthority
  dispatchSession?: ChapterDispatchSession
}

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

    const pending = this.runDownloadTask(taskId, resumeExistingTask)
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

  private async runDownloadTask(
    taskId: string,
    resumeExistingTask: boolean
  ): Promise<TaskExecutionResult> {
    const execution: TaskExecution = { taskId }
    try {
      logger.info("[Queue]", { event: "STARTED", taskId })
      const task = await this.admitTask(taskId, resumeExistingTask)
      if (!task) return "wait"
      await this.providerPolicyCoordinator.acknowledgeAfterAdmission()

      const canReuseEntryLease = await this.prepareEntryLease(
        task,
        resumeExistingTask,
        execution
      )
      // Disabled integrations fail before destination preflight can retain the
      // queue slot for a resumed task with stale FSA permissions.
      const enablement = await this.siteIntegrationEnablementService.getAll()
      if (!isEnabled(task.siteIntegrationId, enablement)) {
        const interruption = await this.cancellationCoordinator.interruptTask({
          taskId,
          errorMessage: "Integration disabled",
        })
        return interruption === "settled" ? "queue-continuation" : "wait"
      }

      await this.prepareProviderPolicy(task, canReuseEntryLease)
      await this.preflightDestination(task, canReuseEntryLease)
      await this.ensureOffscreenReady()
      const session = createDispatchSession(task, execution.currentLeaseForTask)
      execution.dispatchSession = session
      if (await this.dispatchChapters(session)) return "active"
      return await this.completeTask(session)
    } catch (error) {
      return await this.settleExecutionFailure(error, execution)
    }
  }

  private async admitTask(
    taskId: string,
    resumeExistingTask: boolean
  ): Promise<DownloadTaskState | undefined> {
    const task = await this.stateManager.getTask(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (resumeExistingTask) return task
    const transition = await this.stateManager.startDownloadTask({
      taskId,
      now: Date.now(),
    })
    if (transition.outcome === "applied") return transition.task
    logger.info("[Queue]", {
      event: "START_SKIPPED",
      taskId,
      reason: transition.reason,
    })
    return undefined
  }

  private async prepareEntryLease(
    task: DownloadTaskState,
    resumeExistingTask: boolean,
    execution: TaskExecution
  ): Promise<boolean> {
    const activeLease = await this.stateManager.getActiveDispatchLease()
    const lease = activeLease?.taskId === task.id ? activeLease : undefined
    // Preserve the failure-boundary lease until exact producer cancellation
    // succeeds. Chapter admission replaces it on the dispatch session.
    execution.currentLeaseForTask = lease
    const canReuse = canResumeLease(task, lease, resumeExistingTask)
    if (lease && !canReuse) {
      const canceled =
        await this.cancellationCoordinator.cancelProducerAndClearLease(lease)
      if (canceled) execution.currentLeaseForTask = undefined
    }
    return canReuse
  }

  private async prepareProviderPolicy(
    task: DownloadTaskState,
    canReuseEntryLease: boolean
  ): Promise<void> {
    // Session rules disappear at browser shutdown and extension update.
    // Install them before destination and offscreen work for a new producer.
    if (!canReuseEntryLease) {
      await this.sessionRuleManager.ensureNetworkReady(task.siteIntegrationId)
    }
    if (
      task.activeBlock === "provider_network_policy_pending" ||
      task.activeBlock === "provider_network_policy_action_required"
    ) {
      await this.stateManager.releaseProviderPolicyBlock(task.id)
    }
  }

  private async preflightDestination(
    task: DownloadTaskState,
    canReuseEntryLease: boolean
  ): Promise<void> {
    if (canReuseEntryLease || !task.chapters.some(isDispatchableChapter)) return
    const context = {
      taskId: task.id,
      destination: getEffectiveTaskDestination(task),
    } as const
    const preflight = await this.destinationService.preflight(context)
    if (!preflight.ready)
      throw new DestinationPreflightError(context, preflight)
  }

  private async dispatchChapters(
    session: ChapterDispatchSession
  ): Promise<boolean> {
    const indices = session.task.chapters
      .map((chapter, index) => ({ chapter, index }))
      .filter(({ chapter }) => isDispatchableChapter(chapter))
      .map(({ index }) => index)
    // Complete each chapter dispatch before starting the next.
    for (const index of indices) {
      if (session.shouldStopDispatch) break
      if (await this.chapterDispatchCoordinator.dispatch(session, index))
        return true
    }
    return false
  }

  private async completeTask(
    session: ChapterDispatchSession
  ): Promise<TaskExecutionResult> {
    if (session.shouldStopDispatch) {
      await clearActiveTaskProgress()
      return "queue-continuation"
    }
    const { taskId, chapterOutcomesByIndex } = session
    const latestTask = await this.stateManager.getTask(taskId)
    if (!latestTask || latestTask.status !== "downloading") {
      await clearActiveTaskProgress()
      return "queue-continuation"
    }
    const finalization = await finalizeDownloadTaskAfterDispatch({
      stateManager: this.stateManager,
      taskId,
      chapterOutcomesByIndex,
      finalizationDependencies: this.finalizationDependencies,
    })
    await clearActiveTaskProgress()
    if (!finalization.finalized) return "queue-continuation"
    const { chapterOutcomes, completedCount, finalStatus } = finalization
    await notifyDownloadTaskCompletion({
      stateManager: this.stateManager,
      taskId,
      finalStatus,
      completedCount,
      totalChapters: chapterOutcomes.length,
      settingsRepository: this.finalizationDependencies.settingsRepository,
    })
    logger.info("[Queue]", {
      event: "OFFSCREEN_DISPATCHED",
      taskId,
      jobId: `dispatch_loop_${taskId}`,
      mode: session.lastDownloadMode,
      chapters: session.task.chapters.length,
    })
    return "queue-continuation"
  }

  private async settleExecutionFailure(
    error: unknown,
    execution: TaskExecution
  ): Promise<TaskExecutionResult> {
    if (error instanceof DestinationPreflightError) {
      return await this.settleDestinationFailure(error, execution.taskId)
    }
    if (error instanceof ProviderNetworkPolicyPendingError) {
      return await this.blockForProviderPolicy(error, execution)
    }
    const taskId = execution.taskId
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
    const interruption = await this.cancellationCoordinator.interruptTask({
      taskId,
      errorMessage,
    })
    return interruption === "settled" ? "queue-continuation" : "wait"
  }

  private async settleDestinationFailure(
    error: DestinationPreflightError,
    taskId: string
  ): Promise<TaskExecutionResult> {
    const fallback = await this.stateManager.selectChromeFallback({
      taskId,
      now: Date.now(),
    })
    if (fallback.outcome === "applied") {
      await clearActiveTaskProgress()
      return "queue-continuation"
    }
    const failure = await this.cancellationCoordinator.failTaskForSave({
      taskId,
      chapterId: error.context.chapterId,
      errorMessage: error.message,
      errorCategory: error.errorCategory,
    })
    return failure === "quarantined" ? "wait" : "queue-continuation"
  }

  private async blockForProviderPolicy(
    error: ProviderNetworkPolicyPendingError,
    execution: TaskExecution
  ): Promise<TaskExecutionResult> {
    const { taskId } = execution
    const block = await this.stateManager.blockTaskForProviderPolicy({
      taskId,
      block: "provider_network_policy_pending",
    })
    await clearActiveTaskProgress()
    const lease =
      execution.dispatchSession?.currentLeaseForTask ??
      execution.currentLeaseForTask
    if (lease)
      await this.cancellationCoordinator.cancelProducerAndClearLease(lease)
    logger.warn("[Queue]", {
      event: "PROVIDER_NETWORK_POLICY_PENDING",
      taskId,
      siteIntegrationId: error.siteIntegrationId,
      reason: error.message,
    })
    return block.outcome === "applied" ? "queue-continuation" : "wait"
  }
}

function canResumeLease(
  task: DownloadTaskState,
  lease: DispatchLeaseAuthority | undefined,
  resumeExistingTask: boolean
): boolean {
  if (!resumeExistingTask || task.status !== "downloading" || !lease)
    return false
  return task.chapters.some(
    (chapter) =>
      chapter.id === lease.chapterId && chapter.status === "downloading"
  )
}

function isDispatchableChapter(
  chapter: DownloadTaskState["chapters"][number]
): boolean {
  return chapter.status === "queued" || chapter.status === "downloading"
}

function createDispatchSession(
  task: DownloadTaskState,
  currentLeaseForTask: DispatchLeaseAuthority | undefined
): ChapterDispatchSession {
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
  return {
    task,
    taskId: task.id,
    settingsSnapshot: task.settingsSnapshot,
    chapterOutcomesByIndex,
    shouldStopDispatch: false,
    lastDownloadMode: "browser",
    currentLeaseForTask,
  }
}
