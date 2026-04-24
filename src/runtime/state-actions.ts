/**
 * State Action Helpers
 * 
 * Functions for sending state actions and controlling download tasks.
 * These are client-side helpers that send messages to the background service worker.
 */

import { StateAction } from '@/src/types/state-actions';
import type { StateActionMessage } from '@/src/types/state-action-message';
import logger from '@/src/runtime/logger';

const VALID_STATE_ACTIONS = new Set(
  Object.values(StateAction).filter((value): value is number => typeof value === 'number'),
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
 * - Service Worker may return error response (check handler implementation)
 * 
 * @param action - StateAction enum value (compile-time type checked)
 * @param payload - Action-specific payload (see state-action-payloads.ts)
 * @param tabId - Optional tab ID (required for tab-specific actions)
 * @throws Error if action is not a StateAction enum value
 * @throws Error if chrome.runtime.sendMessage fails
 */
export async function sendStateAction(action: StateAction, payload?: unknown, tabId?: number): Promise<void> {
  // Guard: enforce enum-only action at call site to fail fast
  const isValidEnum = VALID_STATE_ACTIONS.has(action);
  if (!isValidEnum) {
    throw new Error('sendStateAction: "action" must be a StateAction enum value');
  }
  const message: StateActionMessage = {
    type: 'STATE_ACTION',
    action,
    payload,
    tabId,
    timestamp: Date.now()
  };

  try {
    // Send flattened message with enum action; background expects this exact shape
    await chrome.runtime.sendMessage<StateActionMessage>(message);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (messageText.includes('Extension context invalidated')) {
      logger.debug('state-actions: extension context invalidated, skipping state action');
      return;
    }
    logger.error('state-actions: failed to send state action', error);
    throw error;
  }
}

/**
 * Cancel a download task
 */
export async function cancelDownloadTask(taskId: string): Promise<void> {
  await sendStateAction(StateAction.CANCEL_DOWNLOAD_TASK, { taskId });
}

