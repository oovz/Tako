import logger from "@/src/runtime/logger"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import type { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { ProviderPolicyQueueCoordinator } from "@/entrypoints/background/provider-policy-queue-coordinator"
import {
  refreshLivenessAlarmForDurableWork,
  recoverFromLivenessTimeout,
} from "@/entrypoints/background/offscreen-lifecycle"
import { markExtensionUpdateActionItemAvailable } from "@/src/runtime/options-action-items"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import type { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import type { NativeOutputCoordinator } from "./native-output-coordinator"
import { pendingUndoTokenFromAlarmName } from "@/src/runtime/pending-undo-actions"
import { finalizePendingUndo } from "./pending-undo-coordinator"
import {
  ACTIVE_TASK_PROGRESS_PORT_NAME,
  registerActiveTaskProgressPort,
} from "./active-task-progress-bus"
import {
  runtimePortRegistry,
  type RuntimeMessagePrincipal,
  type RuntimeMessageReadiness,
} from "@/src/runtime/runtime-message-contracts"
import { classifyRuntimeMessagePrincipal } from "@/src/runtime/runtime-message-sender"

interface RuntimeListenerTabContextCache {
  handleTabRemoved: (tabId: number) => Promise<void>
  handleTabReplaced: (addedTabId: number, removedTabId: number) => Promise<void>
}

interface RegisterBackgroundRuntimeListenersDependencies {
  waitForReadiness: (readiness: RuntimeMessageReadiness) => Promise<void>
  getTabContextStateService: () => TabContextStateService
  queueRepository: QueueRepository
  nativeOutputCoordinator: NativeOutputCoordinator
  queueScheduler: QueueScheduler
  terminalCoordinator: OffscreenJobTerminalCoordinator
  providerPolicyQueueCoordinator: ProviderPolicyQueueCoordinator
  tabContextCache: RuntimeListenerTabContextCache
  ensureLivenessAlarm: () => Promise<void>
  livenessAlarmName: string
  settingsRepository: Pick<SettingsRepository, "getSettings">
}

class BackgroundRuntimeListeners {
  constructor(
    private readonly deps: RegisterBackgroundRuntimeListenersDependencies
  ) {}
  private registerProgressPorts(): void {
    try {
      chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== ACTIVE_TASK_PROGRESS_PORT_NAME) return
        const contract = runtimePortRegistry.ACTIVE_TASK_PROGRESS
        const principal = classifyRuntimeMessagePrincipal(
          port.sender ?? {},
          chrome.runtime.id
        )
        if (
          !(
            contract.allowedSenders as readonly RuntimeMessagePrincipal[]
          ).includes(principal)
        ) {
          port.disconnect()
          return
        }
        void this.deps
          .waitForReadiness(contract.readiness)
          .then(() => registerActiveTaskProgressPort(port))
          .catch((error) => {
            logger.debug(
              "Rejecting progress Port before queue hydration",
              error
            )
            port.disconnect()
          })
      })
    } catch (error) {
      logger.debug(
        "runtime.onConnect listener unavailable; live progress will use session snapshots",
        error
      )
    }
  }

  private registerTabReplacement(): void {
    chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
      void (async () => {
        try {
          await this.deps.waitForReadiness("integrations-ready")
          await this.deps.tabContextCache.handleTabReplaced(
            addedTabId,
            removedTabId
          )
        } catch (error) {
          logger.error(
            "Failed to handle tab replacement for active context cache:",
            error
          )
        }
      })()
    })
  }

  private registerDownloadChanges(): void {
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

          await this.deps.waitForReadiness("runtime-ready")
          const result =
            await this.deps.nativeOutputCoordinator.handleDownloadChanged(delta)
          if (!result.handled) {
            logger.debug(
              `Download ${delta.id} is not a tracked extension output`
            )
          }
          await this.deps.terminalCoordinator.continueAfterNativeOutputSettlement(
            result.effects
          )
        } catch (error) {
          logger.error("Failed to process downloads.onChanged cleanup:", error)
          try {
            // `onChanged` is the primary terminal signal. If accounting or
            // cleanup fails, retain a one-shot wakeup so the durable accepted
            // download ID is reconciled without waiting for another restart.
            await this.deps.ensureLivenessAlarm()
          } catch (alarmError) {
            logger.error(
              "Unable to schedule native output reconciliation retry:",
              alarmError
            )
          }
        }
      })()
    })
  }

  private registerDownloadRemoval(): void {
    chrome.downloads.onErased.addListener((downloadId) => {
      void (async () => {
        try {
          await this.deps.waitForReadiness("runtime-ready")
          const result =
            await this.deps.nativeOutputCoordinator.handleDownloadErased(
              downloadId
            )
          await this.deps.terminalCoordinator.continueAfterNativeOutputSettlement(
            result.effects
          )
        } catch (error) {
          logger.error("Failed to process downloads.onErased cleanup:", error)
          try {
            await this.deps.ensureLivenessAlarm()
          } catch (alarmError) {
            logger.error(
              "Unable to schedule erased native output reconciliation retry:",
              alarmError
            )
          }
        }
      })()
    })
  }

  private registerAlarms(): void {
    chrome.alarms.onAlarm.addListener((alarm) => {
      const pendingUndoToken = pendingUndoTokenFromAlarmName(alarm.name)
      if (pendingUndoToken) {
        void this.deps
          .waitForReadiness("runtime-ready")
          .then(() =>
            finalizePendingUndo(this.deps.queueRepository, pendingUndoToken)
          )
          .catch((error) => {
            logger.error("Error finalizing pending Undo action:", error)
          })
        return
      }

      if (alarm.name !== this.deps.livenessAlarmName) {
        return
      }

      void this.deps
        .waitForReadiness("runtime-ready")
        .then(async () => {
          let providerContinuationRetryRequired = false
          try {
            // A successful DNR reconciliation leaves provider-policy blocks as
            // durable queue state. Retry that short continuation from the same
            // persisted alarm when the detached callback lost its worker turn.
            try {
              if (
                await this.deps.providerPolicyQueueCoordinator.resumeBlockedQueue()
              ) {
                await this.deps.queueScheduler.activate()
              }
            } catch (error) {
              providerContinuationRetryRequired = true
              logger.warn(
                "Provider policy queue continuation will be retried",
                error
              )
              await this.deps.ensureLivenessAlarm()
            }
            // Retry ambiguous native handoffs and Blob cleanup while the
            // current service worker remains alive. Startup reconciliation
            // alone cannot unblock an output whose acceptance persistence
            // failed transiently.
            const nativeSettlementEffects =
              await this.deps.nativeOutputCoordinator.reconcile()
            await this.deps.terminalCoordinator.continueAfterNativeOutputSettlement(
              nativeSettlementEffects
            )
            await recoverFromLivenessTimeout(
              this.deps.queueRepository,
              this.deps.nativeOutputCoordinator,
              this.deps.terminalCoordinator,
              this.deps.queueScheduler,
              this.deps.settingsRepository
            )
          } finally {
            // One-shot alarms are re-armed only while durable work still
            // needs crash/liveness reconciliation.
            await refreshLivenessAlarmForDurableWork(
              this.deps.queueRepository,
              this.deps.nativeOutputCoordinator
            )
            if (providerContinuationRetryRequired) {
              await this.deps.ensureLivenessAlarm()
            }
          }
        })
        .catch(async (error) => {
          logger.error("Error handling liveness alarm recovery:", error)
          try {
            // The alarm is one-shot. Preserve the durable retry path when
            // initialization or recovery fails before work can be inspected.
            await this.deps.ensureLivenessAlarm()
          } catch (alarmError) {
            logger.error(
              "Unable to re-arm liveness recovery after handler failure:",
              alarmError
            )
          }
        })
    })
  }

  private registerTabRemoval(): void {
    chrome.tabs.onRemoved.addListener((tabId) => {
      void (async () => {
        try {
          await this.deps.waitForReadiness("integrations-ready")
          await this.deps.getTabContextStateService().clearTabState(tabId)
          await this.deps.tabContextCache.handleTabRemoved(tabId)
        } catch (error) {
          logger.error(`Error clearing state for removed tab ${tabId}:`, error)
        }
      })()
    })
  }

  private registerUpdateAvailability(): void {
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
  }
  register(): void {
    this.registerProgressPorts()
    this.registerTabReplacement()
    this.registerDownloadChanges()
    this.registerDownloadRemoval()
    this.registerAlarms()
    this.registerTabRemoval()
    this.registerUpdateAvailability()
  }
}
export function registerBackgroundRuntimeListeners(
  deps: RegisterBackgroundRuntimeListenersDependencies
): void {
  new BackgroundRuntimeListeners(deps).register()
}
