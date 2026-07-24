/**
 * State Action Helpers
 *
 * Functions for sending state actions and controlling download tasks.
 * These are client-side helpers that send messages to the background service worker.
 */

import { StateAction } from "@/src/types/state-actions"
import type {
  StateActionMessage,
  StateActionResponse,
} from "@/src/types/state-action-message"
import logger from "@/src/runtime/logger"
import { isRecord } from "@/src/shared/type-guards"
import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import { isPendingUndoReceipt } from "@/src/runtime/pending-undo-actions"
import type { PendingUndoReceipt } from "@/src/types/queue-state"

const VALID_STATE_ACTIONS = new Set(
  Object.values(StateAction).filter(
    (value): value is number => typeof value === "number"
  )
)

/**
 * Send state action to Service Worker for state mutation
 *
 * **CRITICAL**: This is the ONLY way to mutate state from UI/Content contexts.
 *
 * **Architecture Pattern**:
 * ```
 * UI/Content → sendStateAction() → Service Worker → Handler → State Mutation → Storage Broadcast
 * ```
 *
 * **Usage Examples**:
 *
 * 1. **From Content Script** (tabId inferred from sender):
 * ```typescript
 * await sendStateAction(StateAction.INITIALIZE_TAB, {
 *   context: 'ready',
 *   siteIntegrationId: 'mangadex',
 *   mangaId: 'series-123',
 *   seriesTitle: 'One Piece',
 *   chapters: [...]
 * });
 * ```
 *
 * 2. **From Popup/Options** (tabId must be provided):
 * ```typescript
 * await sendStateAction(StateAction.CLEAR_TAB_STATE, undefined, tabId);
 * ```
 *
 * 3. **Global Actions** (no tabId needed):
 * ```typescript
 * await sendStateAction(StateAction.REMOVE_DOWNLOAD_TASK, { taskId: 'abc' });
 * ```
 *
 *
 * **TabId Parameter**:
 * - Required for tab-specific actions (see StateAction enum JSDoc)
 * - Optional for content scripts (inferred from sender.tab.id)
 * - Required explicit value for popup/options/service worker
 *
 * **Error Handling**:
 * - Throws if action is not a valid StateAction enum value
 * - Throws if chrome.runtime.sendMessage fails
 * - Throws if the service worker returns no structured acknowledgement
 * - Throws if the service worker returns a structured failure
 *   ({ success: false, error }) so callers cannot silently treat a rejected
 *   mutation as a success. Inspect `error.message` for the worker's reason.
 *
 * @param action - StateAction enum value (compile-time type checked)
 * @param payload - Action-specific payload (see state-action-payloads.ts)
 * @param tabId - Optional tab ID (required for tab-specific actions)
 * @returns The structured StateActionResponse on success
 * @throws Error if action is not a StateAction enum value
 * @throws Error if chrome.runtime.sendMessage fails
 * @throws Error if the service worker returns { success: false, error }
 */
export async function sendStateAction(
  action: StateAction,
  payload?: unknown,
  tabId?: number
): Promise<StateActionResponse> {
  // Guard: enforce enum-only action at call site to fail fast
  const isValidEnum = VALID_STATE_ACTIONS.has(action)
  if (!isValidEnum) {
    throw new Error(
      'sendStateAction: "action" must be a StateAction enum value'
    )
  }
  const message: StateActionMessage = {
    type: "STATE_ACTION",
    ...createCommandEnvelope(),
    action,
    payload,
    tabId,
    timestamp: Date.now(),
  }

  try {
    // Send flattened message with enum action; background expects this exact
    // shape. The service worker resolves with a structured StateActionResponse
    // ({ success: true, data? } | { success: false, error }). We must surface
    // failures to callers instead of discarding the response — otherwise a
    // rejected mutation can be silently treated as a success.
    const response: unknown = await chrome.runtime.sendMessage(message)

    if (!isRecord(response) || typeof response.success !== "boolean") {
      throw new Error(
        `State action ${action} did not receive a structured acknowledgement`
      )
    }

    if (response.success === false) {
      const errorMessage =
        (typeof response.error === "string" && response.error) ||
        `State action ${action} was rejected by the service worker`
      throw new Error(errorMessage)
    }

    return {
      success: true,
      ...(Object.hasOwn(response, "data") ? { data: response.data } : {}),
    } satisfies StateActionResponse
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    if (messageText.includes("Extension context invalidated")) {
      logger.debug(
        "state-actions: extension context invalidated before acknowledgement"
      )
      throw error
    }
    logger.error("state-actions: failed to send state action", error)
    throw error
  }
}

export function getPendingUndoReceipt(
  response: StateActionResponse
): PendingUndoReceipt | null {
  if (!response.success || !isRecord(response.data)) return null
  return isPendingUndoReceipt(response.data.undo) ? response.data.undo : null
}

/**
 * Cancel a download task
 */
export async function cancelDownloadTask(
  taskId: string
): Promise<PendingUndoReceipt | null> {
  const response = await sendStateAction(StateAction.CANCEL_DOWNLOAD_TASK, {
    taskId,
  })
  return getPendingUndoReceipt(response)
}

export async function undoPendingAction(token: string): Promise<void> {
  await sendStateAction(StateAction.UNDO_PENDING_ACTION, { token })
}
