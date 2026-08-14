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
import type { DestinationService } from "@/entrypoints/background/destination"
import {
  restorePendingUndoAndCleanup,
  schedulePendingUndoAction,
} from "@/entrypoints/background/pending-undo-coordinator"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import {
  StartDownloadRejectedError,
  type StartDownloadFailureCode,
} from "@/src/runtime/start-download-errors"
import { getDefinition, isEnabled } from "@/src/site-integrations/catalog"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import {
  type CancelTaskResult,
  DownloadTaskCancellationCoordinator,
} from "@/entrypoints/background/download-task-cancellation-coordinator"

interface QueueApplicationCommandDependencies {
  startDownloadSettings: StartDownloadSettingsDependencies
  queueRepository: QueueRepository
  nativeOutputCoordinator: NativeOutputCoordinator
  cancellationCoordinator: DownloadTaskCancellationCoordinator
  queueScheduler: QueueScheduler
  destinationService: DestinationService
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

function resolveSelectedChapters(
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

  const chaptersById = new Map(
    current.context.chapters.map((chapter) => [chapter.id, chapter])
  )
  if (chaptersById.size !== current.context.chapters.length) {
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
    context: current.context,
    chapters: selectedChapters,
  }
}

export class QueueApplicationCommands {
  constructor(private readonly deps: QueueApplicationCommandDependencies) {}

  async startDownload(
    payload: StartDownloadPayload,
    commandId: string
  ): Promise<{ taskId: string }> {
    const firstContext = await this.deps.getCurrentSeriesContext(
      payload.sourceTabId,
      payload.sourceWindowId
    )
    resolveSelectedChapters(firstContext, payload)
    await this.assertProviderAvailableForDownload(payload.siteIntegrationId)

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
    const taskId = commandId
    const task = buildStartDownloadTask({
      context: currentSelection.context,
      selectedChapters: currentSelection.chapters,
      settingsInputs,
      taskId,
      now: Date.now(),
    })
    const enqueue = await this.deps.queueRepository.enqueueDownloadTask(task)
    if (enqueue.outcome !== "applied") {
      const existing = await this.deps.queueRepository.getTask(taskId)
      if (existing) return { taskId }
      throw new Error(`Download task identity already exists: ${taskId}`)
    }
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
    const result = await this.deps.queueRepository.retryFailedChapters({
      taskId,
      retryTaskId,
      now: Date.now(),
    })
    if (result.outcome !== "applied") {
      if (
        result.reason === "already-retried" ||
        result.reason === "retry-task-id-conflict"
      ) {
        return { newTaskId: retryTaskId }
      }
      throw new Error(
        result.reason === "task-not-found"
          ? "Task not found"
          : result.reason === "invalid-status"
            ? "Retry failed chapters is only available for partial-success tasks"
            : result.reason === "no-failed-chapters"
              ? "No failed chapters to retry"
              : "Retry task identity already exists"
      )
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
    const result = await this.deps.queueRepository.restartDownloadTask({
      taskId,
      restartTaskId,
      now: Date.now(),
    })
    if (result.outcome !== "applied") {
      if (
        result.reason === "already-retried" ||
        result.reason === "restart-task-id-conflict"
      ) {
        return { newTaskId: restartTaskId }
      }
      throw new Error(
        result.reason === "task-not-found"
          ? "Task not found"
          : result.reason === "invalid-status"
            ? "Restart is only available for failed, partial-success, or canceled tasks"
            : "Restart task identity already exists"
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

  async removeTask(taskId: string): Promise<PendingUndoReceipt | undefined> {
    const result = await this.deps.queueRepository.removeTerminalDownloadTask({
      taskId,
      undoToken: crypto.randomUUID(),
      now: Date.now(),
    })
    if (result.outcome !== "applied") {
      if (result.reason === "task-not-found") {
        // Replay of an already-applied remove: the task is already gone,
        // which IS the durable result of this command. No new Undo exists.
        return undefined
      }
      throw new Error(
        "Only completed, failed, partial-success, or canceled tasks can be removed."
      )
    }
    await schedulePendingUndoAction(
      this.deps.queueRepository,
      result.undo,
      this.deps.destinationService
    )
    return result.undo
  }

  async cancelTask(taskId: string): Promise<CancelTaskResult> {
    const cancellation =
      await this.deps.cancellationCoordinator.cancelTask(taskId)
    if (cancellation.queueCanContinue) await this.activateQueue()
    return cancellation.result
  }

  async forgetUnobservableOutputs(
    taskId: string
  ): Promise<{ surrendered: number }> {
    const result =
      await this.deps.nativeOutputCoordinator.forgetTaskUnobservableOutputs(
        taskId
      )
    return result
  }

  async retryDestination(taskId: string): Promise<void> {
    await this.resumeDestination(taskId, undefined)
  }

  async continueDownload(taskId: string): Promise<void> {
    await this.resumeDestination(taskId, "downloads-api")
  }

  async undoQueueAction(
    token: string
  ): Promise<{ restoredQueuedTask: boolean }> {
    const result = await restorePendingUndoAndCleanup(
      this.deps.queueRepository,
      token,
      this.deps.destinationService
    )
    if (result.outcome !== "applied" || !result.restored) {
      throw new Error(
        result.outcome === "applied" && result.reason === "expired"
          ? "The Undo period has ended."
          : "This action can no longer be undone."
      )
    }

    const restoredQueuedTask = result.action.type === "cancel_queued"
    if (restoredQueuedTask) await this.activateQueue()
    return { restoredQueuedTask }
  }

  private async resumeDestination(
    taskId: string,
    destinationOverride: "downloads-api" | undefined
  ): Promise<void> {
    const result = await this.deps.queueRepository.resumeDestinationTask({
      taskId,
      destinationOverride,
      now: Date.now(),
    })
    if (result.outcome === "rejected") {
      throw new Error("Download task not found.")
    }
    if (result.outcome === "unchanged") {
      throw new Error("This task is not waiting for download-folder action.")
    }

    await this.deps.destinationService.clearDestinationIssuesForTask(taskId)
    await this.activateQueue()
  }

  /**
   * Reject before task construction when the provider is disabled or its
   * required host permission is absent. The executor keeps its own check as
   * defense in depth for the window between enqueue and dispatch.
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
    if (definition.requiredOrigins.length === 0) return
    if (!chrome.permissions?.contains) {
      throw rejected(
        "host_permission_required",
        "Required extension capability is unavailable: chrome.permissions.contains"
      )
    }
    const granted = await chrome.permissions.contains({
      origins: definition.requiredOrigins,
    })
    if (!granted) {
      throw rejected(
        "host_permission_required",
        `Host access is required before ${siteIntegrationId} can download`
      )
    }
  }

  private async activateQueue(): Promise<void> {
    await this.deps.queueScheduler.activate()
  }
}
