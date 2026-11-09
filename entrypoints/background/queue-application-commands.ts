import { runDestinationAccessExclusive } from "./destination-access"
import logger from "@/src/runtime/logger"
import type { PendingUndoReceipt } from "@/src/domain/queue/state"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import {
  buildStartDownloadTask,
  loadStartDownloadSettingsInputs,
} from "@/entrypoints/background/download-queue-enqueue"
import type { StartDownloadSettingsDependencies } from "@/entrypoints/background/download-queue-enqueue"
import type { CurrentSeriesContext } from "@/entrypoints/background/tab-cache"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import type { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import {
  restorePendingUndo,
  schedulePendingUndoAction,
} from "@/entrypoints/background/pending-undo-coordinator"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import {
  StartDownloadRejectedError,
  type StartDownloadFailureCode,
} from "@/src/runtime/start-download-errors"
import { getDefinition, isEnabled } from "@/src/site-integrations/catalog"
import { hasIntegrationHostPermission } from "@/src/site-integrations/host-permission-service"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import {
  type CancelTaskResult,
  DownloadTaskCancellationCoordinator,
} from "@/entrypoints/background/download-task-cancellation-coordinator"

interface QueueApplicationCommandDependencies {
  startDownloadSettings: StartDownloadSettingsDependencies
  queueRepository: QueueRepository
  nativeOutputCoordinator: NativeOutputCoordinator
  terminalCoordinator: OffscreenJobTerminalCoordinator
  cancellationCoordinator: DownloadTaskCancellationCoordinator
  queueScheduler: QueueScheduler
  siteIntegrationEnablementService: Pick<
    SiteIntegrationEnablementService,
    "getAll"
  >
  getCurrentSeriesContext: (
    tabId: number,
    windowId: number
  ) => Promise<CurrentSeriesContext | undefined>
}

type StartDownloadPayload = RuntimeMessageRequest<"START_DOWNLOAD">["payload"]

const STALE_SERIES_CONTEXT_ERROR =
  "Series context is stale; refresh the page before downloading"
const INVALID_SELECTED_CHAPTERS_ERROR =
  "Selected chapters are not valid for the current series"

function rejected(
  code: StartDownloadFailureCode,
  message: string
): StartDownloadRejectedError {
  return new StartDownloadRejectedError(code, message)
}

function requireCurrentSeriesContext(
  current: CurrentSeriesContext | undefined,
  payload: StartDownloadPayload
) {
  if (
    !current ||
    current.windowId !== payload.sourceWindowId ||
    current.revision !== payload.seriesRevision ||
    current.context.sourceUrl !== payload.sourceUrl ||
    current.context.siteIntegrationId !== payload.siteIntegrationId ||
    current.context.mangaId !== payload.seriesId ||
    current.context.chaptersLoading === true
  ) {
    throw rejected("stale_series_context", STALE_SERIES_CONTEXT_ERROR)
  }

  return current
}

function resolveSelectedChapters(
  current: CurrentSeriesContext | undefined,
  payload: StartDownloadPayload
) {
  const { context } = requireCurrentSeriesContext(current, payload)
  const chaptersById = new Map(
    context.chapters.map((chapter) => [chapter.id, chapter])
  )
  if (chaptersById.size !== context.chapters.length) {
    throw rejected("stale_series_context", STALE_SERIES_CONTEXT_ERROR)
  }

  const selectedChapterIds = new Set(payload.selectedChapterIds)
  if (
    selectedChapterIds.size !== payload.selectedChapterIds.length ||
    payload.selectedChapterIds.length === 0
  ) {
    throw rejected("invalid_chapter_selection", INVALID_SELECTED_CHAPTERS_ERROR)
  }

  const selectedChapters = payload.selectedChapterIds.map((chapterId) => {
    const chapter = chaptersById.get(chapterId)
    if (!chapter || chapter.locked === true) {
      throw rejected(
        "invalid_chapter_selection",
        INVALID_SELECTED_CHAPTERS_ERROR
      )
    }
    return chapter
  })

  return {
    context,
    chapters: selectedChapters,
  }
}

export class QueueApplicationCommands {
  constructor(private readonly deps: QueueApplicationCommandDependencies) {}

  async startDownload(
    payload: StartDownloadPayload,
    commandId: string
  ): Promise<{ taskId: string }> {
    const existingTask = await this.deps.queueRepository.getTask(commandId)
    if (existingTask) return { taskId: commandId }

    const firstContext = await this.deps.getCurrentSeriesContext(
      payload.sourceTabId,
      payload.sourceWindowId
    )
    resolveSelectedChapters(firstContext, payload)
    await this.assertProviderAvailableForDownload(payload.siteIntegrationId)

    const task = await runDestinationAccessExclusive(async () => {
      const settingsInputs = await loadStartDownloadSettingsInputs(
        payload.siteIntegrationId,
        this.deps.startDownloadSettings
      )

      const secondContext = await this.deps.getCurrentSeriesContext(
        payload.sourceTabId,
        payload.sourceWindowId
      )
      const currentSelection = resolveSelectedChapters(secondContext, payload)
      // The command ID is the task ID: a re-delivered START_DOWNLOAD envelope
      // (same commandId) converges on the same durable task instead of creating
      // a duplicate semantic command.
      const task = buildStartDownloadTask({
        context: currentSelection.context,
        selectedChapters: currentSelection.chapters,
        settingsInputs,
        taskId: commandId,
        now: Date.now(),
      })
      const enqueue = await this.deps.queueRepository.enqueueDownloadTask(task)
      if (enqueue.outcome !== "applied") {
        const existing = await this.deps.queueRepository.getTask(commandId)
        if (existing) return existing
        throw new Error(`Download task identity already exists: ${commandId}`)
      }
      return task
    })
    const taskId = commandId
    logger.info("[Queue]", {
      event: "START_DOWNLOAD_ENQUEUED",
      taskId,
      sourceTabId: payload.sourceTabId,
      chapters: task.chapters.length,
      siteIntegrationId: task.siteIntegrationId,
      mangaId: task.mangaId,
    })
    await this.activateQueue()
    return { taskId }
  }

  async retryFailedChapters(
    taskId: string,
    commandId: string
  ): Promise<{ newTaskId: string }> {
    // Deterministic child identity: a re-delivered RETRY command produces the
    // same retry task, and the kernel's already-retried signal closes it.
    const retryTaskId = `retry:${commandId}`
    const existingRetryTask =
      await this.deps.queueRepository.getTask(retryTaskId)
    if (existingRetryTask) return { newTaskId: retryTaskId }
    const result = await runDestinationAccessExclusive(() =>
      this.deps.queueRepository.retryFailedChapters({
        taskId,
        retryTaskId,
        now: Date.now(),
      })
    )
    if (result.outcome !== "applied") {
      return await this.resolveChildTaskRejection(retryTaskId, result.reason, {
        "already-retried":
          "Failed chapters were already retried by another command",
        "retry-task-id-conflict": "Retry task identity already exists",
        "task-not-found": "Task not found",
        "invalid-status":
          "Retry failed chapters is only available for partial-success tasks",
        "no-failed-chapters": "No failed chapters to retry",
      })
    }
    logger.info("[Queue]", {
      event: "RETRY_FAILED_CHAPTERS",
      outcome: "RETRY_CREATED",
      taskId,
      newTaskId: result.retryTask.id,
      failedChapters: result.retryTask.chapters.length,
    })
    await this.activateQueue()
    return { newTaskId: result.retryTask.id }
  }

  async restartTask(
    taskId: string,
    commandId: string
  ): Promise<{ newTaskId: string }> {
    const restartTaskId = `restart:${commandId}`
    const existingRestartTask =
      await this.deps.queueRepository.getTask(restartTaskId)
    if (existingRestartTask) return { newTaskId: restartTaskId }
    const result = await runDestinationAccessExclusive(() =>
      this.deps.queueRepository.restartDownloadTask({
        taskId,
        restartTaskId,
        now: Date.now(),
      })
    )
    if (result.outcome !== "applied") {
      return await this.resolveChildTaskRejection(
        restartTaskId,
        result.reason,
        {
          "already-retried": "Task was already restarted by another command",
          "restart-task-id-conflict": "Restart task identity already exists",
          "task-not-found": "Task not found",
          "invalid-status":
            "Restart is only available for failed, partial-success, or canceled tasks",
        }
      )
    }
    logger.info("[Queue]", {
      event: "RESTART_TASK",
      outcome: "RESTART_CREATED",
      taskId,
      newTaskId: result.restartTask.id,
      chapterCount: result.restartTask.chapters.length,
    })
    await this.activateQueue()
    return { newTaskId: result.restartTask.id }
  }

  async reorderQueuedTasks(input: {
    expectedTaskIds: string[]
    taskIds: string[]
  }): Promise<void> {
    const result = await this.deps.queueRepository.reorderQueuedTasks(input)
    if (result.outcome === "rejected")
      throw new Error("The queue changed. Try moving the task again.")
  }

  async renewQueueUndo(token: string): Promise<PendingUndoReceipt> {
    const result = await this.deps.queueRepository.renewPendingUndoAction(token)
    if (result.outcome !== "applied")
      throw new Error("The Undo period has ended.")
    await schedulePendingUndoAction(this.deps.queueRepository, result.undo)
    return result.undo
  }

  async moveTaskToTop(taskId: string): Promise<void> {
    const result = await this.deps.queueRepository.moveQueuedTaskToTop(taskId)
    if (result.outcome === "applied" || result.outcome === "unchanged") return
    throw new Error(
      result.reason === "task-not-found"
        ? "Task not found"
        : "Only queued tasks can be moved to top"
    )
  }

  async clearTerminalHistory(): Promise<{ removedCount: number }> {
    const result = await this.deps.queueRepository.clearTerminalHistory()
    return { removedCount: result.removedTaskIds.length }
  }

  async removeTask(
    taskId: string,
    commandId: string
  ): Promise<PendingUndoReceipt | undefined> {
    const result = await this.deps.queueRepository.removeTerminalDownloadTask({
      taskId,
      undoToken: `remove:${commandId}`,
      now: Date.now(),
    })
    if (result.outcome !== "applied" && result.outcome !== "unchanged") {
      if (result.reason === "task-not-found") {
        // Replaying a completed removal does not create another Undo action.
        return undefined
      }
      throw new Error(
        "Only completed, failed, partial-success, or canceled tasks can be removed."
      )
    }
    await schedulePendingUndoAction(this.deps.queueRepository, result.undo)
    return result.undo
  }

  async cancelTask(
    taskId: string,
    commandId: string
  ): Promise<CancelTaskResult> {
    const cancellation = await this.deps.cancellationCoordinator.cancelTask(
      taskId,
      commandId
    )
    if (cancellation.queueCanContinue) await this.activateQueue()
    return cancellation.result
  }

  async undoQueueAction(
    token: string
  ): Promise<{ restoredQueuedTask: boolean }> {
    const result = await runDestinationAccessExclusive(() =>
      restorePendingUndo(this.deps.queueRepository, token)
    )
    const restoredQueuedTask = restoredUndoType(result) === "cancel_queued"
    if (restoredQueuedTask) await this.activateQueue()
    return { restoredQueuedTask }
  }

  /**
   * Reject before task construction when the provider is disabled or its
   * required host permission is absent. The executor checks availability again
   * because provider policy can change while a task is queued.
   */
  private async assertProviderAvailableForDownload(
    siteIntegrationId: string
  ): Promise<void> {
    const enablement = await this.deps.siteIntegrationEnablementService.getAll()
    if (!isEnabled(siteIntegrationId, enablement)) {
      throw rejected(
        "integration_disabled",
        `Site integration ${siteIntegrationId} is disabled`
      )
    }
    const definition = getDefinition(siteIntegrationId)
    if (!definition) {
      throw rejected(
        "durable_state_failure",
        `Unknown site integration ID: ${siteIntegrationId}`
      )
    }
    if (!chrome.permissions?.contains) {
      throw rejected(
        "host_permission_required",
        "Required extension capability is unavailable: chrome.permissions.contains"
      )
    }
    const granted = await hasIntegrationHostPermission(siteIntegrationId)
    if (!granted) {
      throw rejected(
        "host_permission_required",
        `Host access is required before ${siteIntegrationId} can download`
      )
    }
  }

  private async resolveChildTaskRejection<TReason extends string>(
    childTaskId: string,
    reason: TReason,
    messages: Record<TReason, string>
  ): Promise<{ newTaskId: string }> {
    if (CHILD_TASK_REPLAY_REASONS.has(reason)) {
      const existing = await this.deps.queueRepository.getTask(childTaskId)
      if (existing) return { newTaskId: childTaskId }
    }
    throw new Error(messages[reason])
  }

  private async activateQueue(): Promise<void> {
    await this.deps.queueScheduler.activate()
  }
}

const CHILD_TASK_REPLAY_REASONS = new Set([
  "already-retried",
  "retry-task-id-conflict",
  "restart-task-id-conflict",
])

function restoredUndoType(
  result: Awaited<ReturnType<typeof restorePendingUndo>>
): PendingUndoReceipt["type"] {
  if (
    (result.outcome !== "applied" && result.outcome !== "unchanged") ||
    !result.restored
  ) {
    throw new Error(
      result.outcome === "applied" && result.reason === "expired"
        ? "The Undo period has ended."
        : "This action can no longer be undone."
    )
  }
  return result.outcome === "applied" ? result.action.type : result.type
}
