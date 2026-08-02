/**
 * Background Script - Refactored with Focused Modules
 *
 * Simple orchestrator that delegates to focused modules:
 * - State management → state-action-router.ts
 * - Download queue → download-queue.ts  
 * - Offscreen lifecycle → offscreen-lifecycle.ts
 */

import { defineBackground } from "wxt/utils/define-background"
import type {
  ExtensionMessage,
  ExtensionMessageResponse,
} from "@/src/types/extension-messages"
import logger from "@/src/runtime/logger"

// Import focused modules
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import { beginBackgroundRuntimeInitialization } from "@/entrypoints/background/background-startup"
import {
  backgroundHandledMessages,
  handleBackgroundMessage,
  offscreenOnlyMessages,
} from "@/entrypoints/background/background-message-router"
import { registerBackgroundNavigationListeners } from "@/entrypoints/background/background-navigation-listeners"
import { registerBackgroundRuntimeListeners } from "@/entrypoints/background/background-runtime-listeners"
import {
  ensureOffscreenDocumentReady,
  LIVENESS_ALARM_NAME,
  ensureLivenessAlarm,
  setLivenessAlarmArmed,
  scheduleOffscreenCloseIfIdle,
} from "@/entrypoints/background/offscreen-lifecycle"
import {
  configureDownloadQueueLifecycle,
  failDisabledDnrProviderTasks,
  resumeProviderPolicyBlockedQueue,
} from "@/entrypoints/background/download-queue-runner"
import { createPendingDownloadsStore } from "@/entrypoints/background/pending-downloads"
import { tabContextCache } from "@/entrypoints/background/tab-cache"
import { createTabUiCoordinator } from "@/entrypoints/background/tab-ui-coordinator"
import { createTabContextResolver } from "@/entrypoints/background/tab-context-resolver"
import { createInitializationBarrier } from "@/src/runtime/initialization-barrier"
import { initRateLimitStorageListener } from "@/src/runtime/rate-limit"
import { getNotificationService } from "@/entrypoints/background/notification-service"
import { registerE2EStateSeedListener } from "@/entrypoints/background/e2e-state-seed"
import {
  includesBroadHttpsPermission,
  reconcileBroadHttpsPermissionEnablement,
} from "@/src/site-integrations/host-permission-service"
import { initializeSiteIntegrationMetadataOnly } from "@/src/runtime/site-integration-initialization"
import type { PendingOutputRecord } from "@/src/types/queue-state"
import { setUserSiteIntegrationEnablement } from "@/src/site-integrations/registry"
import { createSiteIntegrationSupportReadiness } from "@/entrypoints/background/site-integration-support-readiness"
import { initializeSiteIntegrationSessionRuleManager } from "@/src/site-integrations/session-rule-manager"

// Global state manager instance
let stateManager!: CentralizedStateManager // set during initializeExtensionRuntime()
let runtimeInitialized = false
let stateManagerPublishedForCurrentAttempt = false
let resolveStateManagerReady!: () => void
let rejectStateManagerReady!: (error: unknown) => void
function createStateManagerReadyPromise(): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    resolveStateManagerReady = resolve
    rejectStateManagerReady = reject
  })
  void promise.catch(() => undefined)
  return promise
}
let stateManagerReady = createStateManagerReadyPromise()

function publishStateManager(nextStateManager: CentralizedStateManager): void {
  stateManager = nextStateManager
  stateManagerPublishedForCurrentAttempt = true
  resolveStateManagerReady()
}

async function waitForStateManagerReady(): Promise<void> {
  if (stateManagerPublishedForCurrentAttempt) return
  await stateManagerReady
}

function resetStateManagerReadinessAfterFailure(error: unknown): void {
  stateManagerPublishedForCurrentAttempt = false
  rejectStateManagerReady(error)
  stateManagerReady = createStateManagerReadyPromise()
}

const siteIntegrationSupportReadiness = createSiteIntegrationSupportReadiness({
  reconcilePermissionEnablement: reconcileBroadHttpsPermissionEnablement,
  initializeMetadata: initializeSiteIntegrationMetadataOnly,
  applyEnablement: setUserSiteIntegrationEnablement,
})

function ensureSiteIntegrationMetadataInitialized(): Promise<void> {
  return siteIntegrationSupportReadiness.ensureInitialized()
}

async function reconcileIntegrationSupportAfterPermissionRemoval(): Promise<void> {
  // Events arriving after this point must wait for the new permission snapshot,
  // not the readiness promise that completed before Chrome removed access.
  siteIntegrationSupportReadiness.invalidate()
  await ensureSiteIntegrationMetadataInitialized()

  const tabs = await chrome.tabs.query({})
  const refreshes = tabs.flatMap((tab) => {
    if (typeof tab.id !== "number") return []
    const url = tab.url ?? tab.pendingUrl ?? ""
    const updates: Promise<unknown>[] = [
      tabUiCoordinator.updateActionForTab(tab.id, url),
      tabUiCoordinator.updateSidePanelForTab(tab.id),
    ]
    if (tab.active) {
      updates.push(
        tabContextResolver.resolveTabContext(tab.id, {
          windowId: tab.windowId,
          allowCached: false,
        })
      )
    }
    return updates
  })
  const outcomes = await Promise.allSettled(refreshes)
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      logger.debug(
        "Failed to refresh tab support after permission removal:",
        outcome.reason
      )
    }
  }
}

const pendingDownloadsStore = createPendingDownloadsStore()
configureDownloadQueueLifecycle({
  onQueueDrained: async () => {
    await scheduleOffscreenCloseIfIdle(pendingDownloadsStore)
    await setLivenessAlarmArmed(false)
  },
  pendingOutputsStore: pendingDownloadsStore,
})
const tabUiCoordinator = createTabUiCoordinator()
const initializationBarrier = createInitializationBarrier({
  isInitialized: () => runtimeInitialized,
  initialize: async () => {
    await initializeExtensionRuntime()
  },
})
const tabContextResolver = createTabContextResolver({
  getStateManager: () => stateManager,
  tabContextCache,
  beforeResolution: ensureSiteIntegrationMetadataInitialized,
  beforeStateMutation: waitForStateManagerReady,
})

async function requestBlobRevocation(
  record: Pick<
    PendingOutputRecord,
    "jobId" | "attempt" | "outputId" | "blobUrl"
  >
): Promise<void> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({
      type: "REVOKE_BLOB_URL",
      payload: {
        jobId: record.jobId,
        attempt: record.attempt,
        outputId: record.outputId,
        blobUrl: record.blobUrl,
      },
    } as ExtensionMessage)
    if (
      response &&
      typeof response === "object" &&
      "success" in response &&
      response.success === false
    ) {
      throw new Error(
        "error" in response && typeof response.error === "string"
          ? response.error
          : "Blob URL revocation was rejected"
      )
    }
  } catch (error) {
    logger.debug("Failed to request blob URL revocation:", error)
    throw error
  }
}

/**
 * Ensure state manager is initialized (lazy initialization)
 */
async function ensureStateManagerInitialized(): Promise<void> {
  await initializationBarrier.ensureInitialized()
}

/**
 * Initialize extension runtime services and state
 */
async function initializeExtensionRuntime(): Promise<void> {
  try {
    const initialization = await beginBackgroundRuntimeInitialization({
      pendingDownloadsStore,
      ensureLivenessAlarm,
      setLivenessAlarmArmed,
      ensureOffscreenDocumentReady,
      requestBlobRevocation,
    })
    // Tab-context commits use only the initialized state manager. Publish it
    // before queue/output recovery so a cold worker does not keep a supported
    // Side Panel in Loading while unrelated recovery work completes.
    publishStateManager(initialization.stateManager)

    const initializedRuntime = await initialization.initialized
    runtimeInitialized = true

    // Queue work remains asynchronous after the control plane is available.
    // That avoids startup deadlocks while preserving a fully initialized message
    // and tab-context path for events arriving during queue recovery.
    void initializedRuntime.activateQueue().catch((error) => {
      logger.error("Failed to activate the recovered download queue:", error)
    })
  } catch (error) {
    resetStateManagerReadinessAfterFailure(error)
    throw error
  }
}

/**
 * Handle state action messages from other components
 */
async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<ExtensionMessageResponse | null> {
  return await handleBackgroundMessage(message, sender, {
    ensureStateManagerInitialized,
    getStateManager: () => stateManager,
    ensureOffscreenDocumentReady,
    pendingDownloadsStore,
    requestBlobRevocation,
    tabContextResolver,
  })
}

export default defineBackground({
  type: "module",
  main() {
    logger.info("Background script starting")

    // Configure side panel behavior: open on action click
    try {
      chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => {
          logger.debug("sidePanel.setPanelBehavior failed:", error)
        })
    } catch (e) {
      logger.debug("sidePanel.setPanelBehavior unavailable", e)
    }

    // Set up message listener
    chrome.runtime.onMessage.addListener(
      (
        message: ExtensionMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: ExtensionMessageResponse) => void
      ) => {
        // Offscreen listeners receive runtime messages independently. Return
        // false only to indicate that this background listener will not send
        // an asynchronous response for offscreen-owned message types.
        if (
          offscreenOnlyMessages.includes(
            message.type as (typeof offscreenOnlyMessages)[number]
          )
        ) {
          return false
        }

        // Only keep channel open for message types background is responsible for.
        // Avoids "listener indicated an asynchronous response" errors for pass-through messages.
        if (!backgroundHandledMessages.has(message.type)) {
          logger.debug(
            `Background skipping unowned message type: ${message.type}`
          )
          return false
        }

        handleMessage(message, sender)
          .then((response) => {
            if (response === null) {
              sendResponse({
                success: false,
                error: `Unhandled message type in background: ${message.type}`,
              })
              return
            }
            sendResponse(response)
          })
          .catch((error) => {
            const msg = error instanceof Error ? error.message : "Unknown error"
            logger.error("Message handler error:", error)
            sendResponse({ success: false, error: msg })
          })
        return true // Keep message channel open for async response
      }
    )

    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized,
      isStateManagerReady: () => Boolean(stateManager),
      getStateManager: () => stateManager,
      pendingDownloadsStore,
      requestBlobRevocation,
      tabContextCache,
      ensureOffscreenDocumentReady,
      ensureLivenessAlarm,
      livenessAlarmName: LIVENESS_ALARM_NAME,
    })

    if (__TAKO_E2E_STATE_SEED__) {
      registerE2EStateSeedListener({
        ensureStateManagerInitialized,
        getStateManager: () => stateManager,
      })
    }

    // Removed keyboard shortcut open: per user stories, only extension icon opens the Side Panel

    // Queue processing and native download completion are event-driven. The
    // liveness alarm is reserved for active offscreen work and dispatch leases.
    // See: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

    registerBackgroundNavigationListeners({
      ensureSiteIntegrationMetadataInitialized,
      ensureStateManagerInitialized,
      getStateManager: () => stateManager,
      tabContextCache,
      tabContextResolver,
      tabUiCoordinator,
    })

    // Register notification click listener synchronously in main() so it
    // survives service worker restarts. The service is lazily instantiated
    // on first notification show; this listener delegates to it on click.
    chrome.notifications.onClicked.addListener((notificationId) => {
      void getNotificationService().handleNotificationClick(notificationId)
    })

    // Optional host permission removal invalidates broad-host integrations.
    // Register synchronously so Chrome can wake the service worker for it.
    chrome.permissions.onRemoved.addListener((permissions) => {
      if (!includesBroadHttpsPermission(permissions)) {
        return
      }

      void reconcileIntegrationSupportAfterPermissionRemoval().catch(
        (error) => {
          logger.error(
            "Failed to reconcile integration enablement after permission removal:",
            error
          )
        }
      )
    })

    // Register rate-limit storage listener synchronously so limiter cache is
    // cleared on settings/overrides changes. Must run in main() (not module
    // scope) because entrypoints are imported in Node at build time.
    initRateLimitStorageListener()

    // Provider-specific DNR rules are declarative integration capabilities.
    // Listener registration is synchronous; task dispatch consumes the
    // returned readiness promise through the manager's provider-specific
    // readiness barrier.
    const initialSessionRuleReconciliation =
      initializeSiteIntegrationSessionRuleManager({
        onReconciled: async (enablement) => {
          await ensureStateManagerInitialized()
          await failDisabledDnrProviderTasks(
            stateManager,
            enablement,
            ensureOffscreenDocumentReady
          )
          await resumeProviderPolicyBlockedQueue(
            stateManager,
            ensureOffscreenDocumentReady
          )
        },
      })
    void initialSessionRuleReconciliation.catch((error) => {
      logger.warn("Initial provider session DNR reconciliation failed", error)
    })

    // All event listeners above are registered during this synchronous main()
    // turn. Start the asynchronous runtime work only after registration so an
    // MV3 wakeup can dispatch navigation events immediately.
    void ensureSiteIntegrationMetadataInitialized().catch((error) => {
      logger.error("Failed to initialize site integration metadata:", error)
    })
    ensureStateManagerInitialized().catch((error) => {
      logger.error("Failed to initialize architecture:", error)
    })
    logger.info("Background script initialized")
  },
})
