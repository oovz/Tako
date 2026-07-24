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
import {
  configureImageRefererRewriteRules,
  initializeBackgroundRuntime,
} from "@/entrypoints/background/background-startup"
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
  scheduleOffscreenCloseIfIdle,
} from "@/entrypoints/background/offscreen-lifecycle"
import { configureDownloadQueueLifecycle } from "@/entrypoints/background/download-queue-runner"
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
import type { PendingOutputRecord } from "@/src/types/queue-state"

// Global state manager instance
let stateManager!: CentralizedStateManager // set during initializeExtensionRuntime()
const pendingDownloadsStore = createPendingDownloadsStore()
configureDownloadQueueLifecycle({
  onQueueDrained: () => scheduleOffscreenCloseIfIdle(pendingDownloadsStore),
  pendingOutputsStore: pendingDownloadsStore,
})
const tabUiCoordinator = createTabUiCoordinator()
const initializationBarrier = createInitializationBarrier({
  isInitialized: () => Boolean(stateManager),
  initialize: async () => {
    await initializeExtensionRuntime()
  },
})
const tabContextResolver = createTabContextResolver({
  getStateManager: () => stateManager,
  tabContextCache,
  beforeStateMutation: () => initializationBarrier.ensureInitialized(),
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
  const initializedRuntime = await initializeBackgroundRuntime({
    pendingDownloadsStore,
    ensureLivenessAlarm,
    ensureOffscreenDocumentReady,
    requestBlobRevocation,
  })
  // Publish the state manager before this initialization barrier resolves.
  // Queue activation may dispatch an offscreen job, but message/navigation
  // handlers must never observe an initialized barrier with no manager.
  stateManager = initializedRuntime.stateManager

  // Queue work remains asynchronous after the control plane is available.
  // That avoids startup deadlocks while preserving a fully initialized message
  // and tab-context path for events arriving during queue recovery.
  void initializedRuntime.activateQueue().catch((error) => {
    logger.error("Failed to activate the recovered download queue:", error)
  })
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

    // Initialize architecture
    ensureStateManagerInitialized().catch((error) => {
      logger.error("Failed to initialize architecture:", error)
    })

    void configureImageRefererRewriteRules()

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
        // CRITICAL: Synchronously return false for offscreen-targeted messages
        // This allows the offscreen document's listener to receive and handle them
        // Ref: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
        if (
          offscreenOnlyMessages.includes(
            message.type as (typeof offscreenOnlyMessages)[number]
          )
        ) {
          return false // Don't handle - let offscreen document receive it
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
      livenessAlarmName: LIVENESS_ALARM_NAME,
    })

    if (__TAKO_E2E_STATE_SEED__) {
      registerE2EStateSeedListener({
        ensureStateManagerInitialized,
        getStateManager: () => stateManager,
      })
    }

    // Removed keyboard shortcut open: per user stories, only extension icon opens the Side Panel

    // REMOVED: setInterval polling (violates Chrome service worker guidelines)
    // Queue processing is now event-driven:
    // - Triggered immediately when tasks are added
    // - Triggered when tasks complete/fail
    // - Service worker can sleep when idle (30s timeout)
    // See: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

    registerBackgroundNavigationListeners({
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

      void reconcileBroadHttpsPermissionEnablement().catch((error) => {
        logger.error(
          "Failed to reconcile integration enablement after permission removal:",
          error
        )
      })
    })

    // Register rate-limit storage listener synchronously so limiter cache is
    // cleared on settings/overrides changes. Must run in main() (not module
    // scope) because entrypoints are imported in Node at build time.
    initRateLimitStorageListener()

    logger.info("Background script initialized")
  },
})
