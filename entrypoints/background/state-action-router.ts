/**
 * State Action Router - Background Service Worker Only
 *
 * Routes state action messages to the authoritative service worker handlers.
 * CRITICAL: This should ONLY be used in the Service Worker.
 */

import logger from "@/src/runtime/logger"
import { parseStateActionPayload } from "@/src/runtime/state-action-schemas"
import { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { StateActionMessage } from "@/src/types/state-action-message"
import { StateAction } from "@/src/types/state-actions"
import { classifySenderOrigin, type SenderOrigin } from "./sender-resolution"

// Import action handlers
import {
  handleInitializeTab,
  handleClearTabState,
} from "./action-handlers/tab-state-handlers"
import {
  handleRemoveDownloadTask,
  handleCancelDownloadTask,
  handleRetryDestinationTask,
  handleContinueTaskInDownloads,
  handleUndoPendingAction,
} from "./action-handlers/download-task-handlers"

let stateManagerPromise: Promise<CentralizedStateManager> | null = null

const VALID_STATE_ACTIONS = new Set<StateAction>([
  StateAction.INITIALIZE_TAB,
  StateAction.CLEAR_TAB_STATE,
  StateAction.REMOVE_DOWNLOAD_TASK,
  StateAction.CANCEL_DOWNLOAD_TASK,
  StateAction.RETRY_DESTINATION_TASK,
  StateAction.CONTINUE_TASK_IN_DOWNLOADS,
  StateAction.UNDO_PENDING_ACTION,
])

interface AuthorizedStateActionContext {
  authorized: true
  origin: SenderOrigin | "background"
  tabId?: number
}

interface RejectedStateActionContext {
  authorized: false
  error: string
}

function isValidTabId(tabId: unknown): tabId is number {
  return typeof tabId === "number" && Number.isInteger(tabId) && tabId >= 0
}

function authorizeStateAction(
  message: StateActionMessage,
  sender?: chrome.runtime.MessageSender
): AuthorizedStateActionContext | RejectedStateActionContext {
  const providedTabId = message.tabId
  if (providedTabId !== undefined && !isValidTabId(providedTabId)) {
    return { authorized: false, error: "Invalid tab ID" }
  }

  // Direct calls originate inside the background worker. Runtime messages
  // always supply MessageSender and are subject to the capability matrix below.
  if (!sender) {
    return {
      authorized: true,
      origin: "background",
      tabId: providedTabId,
    }
  }

  const extensionId =
    typeof chrome === "undefined" ? undefined : chrome.runtime?.id
  const origin = classifySenderOrigin(sender, extensionId)

  if (origin !== "extension-page") {
    return {
      authorized: false,
      error: "State actions are only accepted from extension pages",
    }
  }

  return { authorized: true, origin, tabId: providedTabId }
}

/**
 * Initialize and return the centralized state manager
 *
 * @internal This function should ONLY be called from the Service Worker entrypoint (`entrypoints/background/index.ts`).
 *
 * **CRITICAL USAGE CONSTRAINTS**:
 * - ✅ CORRECT: Call from `entrypoints/background/index.ts` to create singleton instance
 * - ❌ WRONG: Import and call from content scripts, popup, or options page
 * - ❌ WRONG: Create multiple instances of CentralizedStateManager
 *
 * **Proper Patterns**:
 * ```typescript
 * // ✅ Service Worker (entrypoints/background/index.ts):
 * import { createStateManager } from '@/entrypoints/background/state-action-router';
 * const stateManager = await createStateManager(); // Single instance
 *
 * // ✅ Content Script / Popup (mutations):
 * import { sendStateAction } from '@/src/runtime/centralized-state';
 * await sendStateAction(StateAction.CLEAR_TAB_STATE, undefined, tabId);
 * ```
 *
 * **Architecture Rationale**:
 * - Enforces single source of truth (Service Worker owns state)
 * - Prevents race conditions from concurrent mutations
 * - chrome.storage.session API only available in Service Worker context
 * - Unidirectional data flow: UI → StateAction → Service Worker → Storage → UI updates
 *
 * @throws {Error} If called outside Service Worker context (chrome.storage undefined)
 * @returns Promise resolving to initialized state manager singleton
 */
export async function createStateManager(): Promise<CentralizedStateManager> {
  if (!stateManagerPromise) {
    stateManagerPromise = (async () => {
      const stateManager = new CentralizedStateManager()
      await stateManager.initialize()
      return stateManager
    })().catch((error) => {
      stateManagerPromise = null
      throw error
    })
  }

  return await stateManagerPromise
}

/**
 * Process state action with proper error handling and logging
 *
 * **Central dispatcher for all state mutations in the extension.**
 *
 * This function:
 * 1. Reads the explicit tabId from the message
 * 2. Validates tabId presence for tab-specific actions
 * 3. Routes to appropriate action handler
 * 4. Returns standardized success/error response
 *
 * **TabId Contract**:
 * - Tab-scoped actions carry `message.tabId` explicitly.
 * - Runtime state actions are accepted only from extension pages.
 *
 * **Coverage**:
 * - All state mutations flow through this function
 * - Enforces single source of truth pattern
 * - See individual handlers for specific mappings
 *
 * @param stateManager - Centralized state manager instance
 * @param message - StateAction message with action enum and payload
 * @param sender - Optional runtime sender used for extension-page authorization
 * @returns Success response with optional data, or error response
 */
export async function processStateAction(
  stateManager: CentralizedStateManager,
  message: StateActionMessage,
  sender?: chrome.runtime.MessageSender
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { action, payload } = message
  const providedTabId = message.tabId

  if (!VALID_STATE_ACTIONS.has(action)) {
    logger.warn(`Unknown state action: ${String(action)}`)
    return { success: false, error: "Unknown action" }
  }

  let parsedPayload: unknown
  try {
    parsedPayload = parseStateActionPayload(action, payload)
  } catch (error) {
    logger.warn(`Invalid payload for state action ${String(action)}`, error)
    return {
      success: false,
      error: `Invalid payload for ${StateAction[action] ?? `action ${String(action)}`}`,
    }
  }

  const authorization = authorizeStateAction(message, sender)
  if (!authorization.authorized) {
    logger.warn(`Rejected state action ${String(action)}`, {
      error: authorization.error,
      providedTabId,
    })
    return { success: false, error: authorization.error }
  }

  const tabId = authorization.tabId
  logger.info(`Processing state action: ${action}`, {
    origin: authorization.origin,
    providedTabId,
    finalTabId: tabId,
  })

  try {
    switch (action) {
      case StateAction.INITIALIZE_TAB:
        if (typeof tabId !== "number")
          throw new Error("Tab ID required for INITIALIZE_TAB")
        return await handleInitializeTab(
          stateManager,
          parsedPayload as Parameters<typeof handleInitializeTab>[1],
          tabId,
          {
            requestId: message.requestId,
            windowId: message.windowId,
            // A direct INITIALIZE_TAB action is authoritative for its tab.
            // Advance the projection revision so provider work that started
            // before this message cannot overwrite the newer context.
            supersedeInFlight: typeof message.requestId !== "number",
          }
        )

      case StateAction.CLEAR_TAB_STATE:
        if (typeof tabId !== "number")
          throw new Error("Tab ID required for CLEAR_TAB_STATE")
        return await handleClearTabState(stateManager, tabId)

      case StateAction.REMOVE_DOWNLOAD_TASK:
        return await handleRemoveDownloadTask(
          stateManager,
          parsedPayload as Parameters<typeof handleRemoveDownloadTask>[1]
        )

      case StateAction.CANCEL_DOWNLOAD_TASK:
        return await handleCancelDownloadTask(
          stateManager,
          parsedPayload as Parameters<typeof handleCancelDownloadTask>[1]
        )

      case StateAction.RETRY_DESTINATION_TASK:
        return await handleRetryDestinationTask(
          stateManager,
          parsedPayload as Parameters<typeof handleRetryDestinationTask>[1]
        )

      case StateAction.CONTINUE_TASK_IN_DOWNLOADS:
        return await handleContinueTaskInDownloads(
          stateManager,
          parsedPayload as Parameters<typeof handleContinueTaskInDownloads>[1]
        )

      case StateAction.UNDO_PENDING_ACTION:
        return await handleUndoPendingAction(
          stateManager,
          parsedPayload as Parameters<typeof handleUndoPendingAction>[1]
        )

      default:
        logger.warn(`Unknown state action: ${String(action)}`)
        return { success: false, error: "Unknown action" }
    }
  } catch (error) {
    logger.error(`Error processing state action ${action}:`, error)
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error"
    return { success: false, error: errorMessage }
  }
}
