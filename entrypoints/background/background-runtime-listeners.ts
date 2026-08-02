import logger from "@/src/runtime/logger"
import {
  processDownloadQueue,
  resumeDownloadTask,
} from "@/entrypoints/background/download-queue"
import {
  refreshLivenessAlarmForDurableWork,
  recoverFromLivenessTimeout,
  scheduleOffscreenCloseIfIdle,
} from "@/entrypoints/background/offscreen-lifecycle"
import { markExtensionUpdateActionItemAvailable } from "@/src/runtime/options-action-items"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { PendingDownloadsStore } from "@/entrypoints/background/pending-downloads"
import type { PendingOutputRecord } from "@/src/types/queue-state"
import {
  finalizePendingOutput,
  reconcileAllPendingOutputs,
} from "./native-output-finalizer"
import { isDownloadTaskRunnerActive } from "./download-task-runner-registry"
import { activeDispatchLeaseStore } from "@/src/runtime/active-dispatch-lease"
import { pendingUndoTokenFromAlarmName } from "@/src/runtime/pending-undo-actions"
import { finalizePendingUndoAndCleanup } from "./pending-undo-coordinator"
import {
  ACTIVE_TASK_PROGRESS_PORT_NAME,
  registerActiveTaskProgressPort,
} from "./active-task-progress-bus"
import {
  isExecutingDownloadTask,
  isRunnableQueuedTask,
} from "@/src/runtime/download-task-execution-state"

interface RuntimeListenerTabContextCache {
  handleTabRemoved: (tabId: number) => Promise<void>
  handleTabReplaced: (addedTabId: number, removedTabId: number) => Promise<void>
}

interface RegisterBackgroundRuntimeListenersDependencies {
  ensureStateManagerInitialized: () => Promise<void>
  isStateManagerReady: () => boolean
  getStateManager: () => CentralizedStateManager
  pendingDownloadsStore: PendingDownloadsStore
  requestBlobRevocation: (
    record: Pick<
      PendingOutputRecord,
      "jobId" | "attempt" | "outputId" | "blobUrl"
    >
  ) => Promise<void>
  tabContextCache: RuntimeListenerTabContextCache
  ensureOffscreenDocumentReady: () => Promise<void>
  ensureLivenessAlarm: () => Promise<void>
  livenessAlarmName: string
}

export function registerBackgroundRuntimeListeners(
  deps: RegisterBackgroundRuntimeListenersDependencies
): void {
  try {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== ACTIVE_TASK_PROGRESS_PORT_NAME) return
      if (
        port.sender?.id &&
        chrome.runtime.id &&
        port.sender.id !== chrome.runtime.id
      ) {
        return
      }
      registerActiveTaskProgressPort(port)
    })
  } catch (error) {
    logger.debug(
      "runtime.onConnect listener unavailable; live progress will use session snapshots",
      error
    )
  }

  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    void (async () => {
      try {
        await deps.ensureStateManagerInitialized()
        await deps.tabContextCache.handleTabReplaced(addedTabId, removedTabId)
      } catch (error) {
        logger.error(
          "Failed to handle tab replacement for active context cache:",
          error
        )
      }
    })()
  })

  chrome.downloads.onChanged.addListener((delta) => {
    void (async () => {
      try {
        if (typeof delta.id !== "number") {
          return
        }

        const downloadState = delta.state?.current
        if (!downloadState || downloadState === "in_progress") {
          return
        }

        await deps.ensureStateManagerInitialized()
        const terminalState =
          downloadState === "complete"
            ? "complete"
            : downloadState === "interrupted"
              ? "interrupted"
              : null
        if (!terminalState) return
        const record = await finalizePendingOutput(
          {
            stateManager: deps.getStateManager(),
            pendingOutputs: deps.pendingDownloadsStore,
            requestBlobRevocation: deps.requestBlobRevocation,
            onOutputSettled: () =>
              scheduleOffscreenCloseIfIdle(deps.pendingDownloadsStore),
          },
          {
            downloadId: delta.id,
            state: terminalState,
            error: delta.error?.current,
          }
        )

        if (!record) {
          logger.debug(`Download ${delta.id} is not a tracked extension output`)
        } else if (record.taskId !== "legacy") {
          const task = (
            await deps.getStateManager().getGlobalState()
          ).downloadQueue.find((candidate) => candidate.id === record.taskId)
          const chapter = task?.chapters.find(
            (candidate) => candidate.id === record.chapterId
          )
          if (
            !isDownloadTaskRunnerActive(record.taskId) &&
            (task?.status === "canceled" ||
              (task?.status === "downloading" &&
                chapter?.status !== "downloading"))
          ) {
            await deps.pendingDownloadsStore.releaseJob(record.jobId)
            await activeDispatchLeaseStore.clear({
              jobId: record.jobId,
              attempt: record.attempt,
            })
            if (task.status === "downloading") {
              await resumeDownloadTask(
                deps.getStateManager(),
                task.id,
                deps.ensureOffscreenDocumentReady
              )
            }
          }
        }
      } catch (error) {
        logger.error("Failed to process downloads.onChanged cleanup:", error)
      }
    })()
  })

  chrome.alarms.onAlarm.addListener((alarm) => {
    const pendingUndoToken = pendingUndoTokenFromAlarmName(alarm.name)
    if (pendingUndoToken) {
      void deps
        .ensureStateManagerInitialized()
        .then(() =>
          finalizePendingUndoAndCleanup(
            deps.getStateManager(),
            pendingUndoToken
          )
        )
        .catch((error) => {
          logger.error("Error finalizing pending Undo action:", error)
        })
      return
    }

    if (alarm.name !== deps.livenessAlarmName) {
      return
    }

    void deps
      .ensureStateManagerInitialized()
      .then(async () => {
        try {
          const finalizerDependencies = {
            stateManager: deps.getStateManager(),
            pendingOutputs: deps.pendingDownloadsStore,
            requestBlobRevocation: deps.requestBlobRevocation,
            onOutputSettled: () =>
              scheduleOffscreenCloseIfIdle(deps.pendingDownloadsStore),
          }
          // Retry ambiguous native handoffs and Blob cleanup while the
          // current service worker remains alive. Startup reconciliation
          // alone cannot unblock an output whose acceptance persistence
          // failed transiently.
          await reconcileAllPendingOutputs(finalizerDependencies)
          await recoverFromLivenessTimeout(
            deps.getStateManager(),
            deps.pendingDownloadsStore,
            async (activeTaskId) => {
              if (activeTaskId) {
                await resumeDownloadTask(
                  deps.getStateManager(),
                  activeTaskId,
                  deps.ensureOffscreenDocumentReady
                )
              } else {
                await processDownloadQueue(
                  deps.getStateManager(),
                  deps.ensureOffscreenDocumentReady
                )
              }
            }
          )
        } finally {
          // One-shot alarms are re-armed only while durable work still
          // needs crash/liveness reconciliation.
          await refreshLivenessAlarmForDurableWork(deps.getStateManager())
        }
      })
      .catch(async (error) => {
        logger.error("Error handling liveness alarm recovery:", error)
        try {
          // The alarm is one-shot. Preserve the durable retry path when
          // initialization or recovery fails before work can be inspected.
          await deps.ensureLivenessAlarm()
        } catch (alarmError) {
          logger.error(
            "Unable to re-arm liveness recovery after handler failure:",
            alarmError
          )
        }
      })
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      try {
        await deps.ensureStateManagerInitialized()
        await deps.getStateManager().clearTabState(tabId)
        await deps.tabContextCache.handleTabRemoved(tabId)
      } catch (error) {
        logger.error(`Error clearing state for removed tab ${tabId}:`, error)
      }
    })()
  })

  try {
    chrome.runtime.onUpdateAvailable.addListener((details) => {
      void markExtensionUpdateActionItemAvailable({
        version: details.version,
      }).catch((error) => {
        logger.debug("Failed to mark extension update action item:", error)
      })
    })
  } catch (error) {
    logger.debug(
      "runtime.onUpdateAvailable listener unavailable; update action indicator disabled",
      error
    )
  }

  try {
    chrome.runtime.onSuspend.addListener(() => {
      logger.info("Service worker suspending - attempting best-effort cleanup")
      try {
        if (deps.isStateManagerReady()) {
          void (async () => {
            await deps.ensureStateManagerInitialized()
            try {
              const state = await deps.getStateManager().getGlobalState()
              if (
                state.downloadQueue.some(
                  (task) =>
                    isRunnableQueuedTask(task) || isExecutingDownloadTask(task)
                )
              ) {
                return
              }
              await scheduleOffscreenCloseIfIdle(deps.pendingDownloadsStore)
            } catch (error) {
              logger.debug(
                "Failed to schedule offscreen close on suspend:",
                error
              )
            }
          })()
        }

        logger.debug("Best-effort suspend cleanup requested")
      } catch (error) {
        logger.error("Error during service worker cleanup:", error)
      }
    })
  } catch (error) {
    logger.debug(
      "runtime.onSuspend listener unavailable; suspend cleanup disabled",
      error
    )
  }
}
