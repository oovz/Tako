/**
 * State Manager Module - Background Service Worker Only
 * 
 * Handles all state management operations for the Chrome extension.
 * CRITICAL: This should ONLY be used in the Service Worker.
 */

import logger from '@/src/runtime/logger';
import { CentralizedStateManager } from '@/src/runtime/centralized-state';
import { matchUrl } from '@/src/site-integrations/url-matcher';
import type { StateActionMessage } from '@/src/types/state-action-message';
import { StateAction } from '@/src/types/state-actions';

// Import action handlers
import {
  handleInitializeTab,
  handleClearTabState
} from './action-handlers/tab-state-handlers';
import {
  handleUpdateDownloadTask,
  handleRemoveDownloadTask,
  handleCancelDownloadTask
} from './action-handlers/download-task-handlers';
import {
  handleUpdateSettings,
  handleClearDownloadHistory
} from './action-handlers/settings-handlers';

/**
 * Initialize and return the centralized state manager
 * 
 * @internal This function should ONLY be called from the Service Worker (background.ts).
 * 
 * **CRITICAL USAGE CONSTRAINTS**:
 * - ✅ CORRECT: Call from `background.ts` to create singleton instance
 * - ❌ WRONG: Import and call from content scripts, popup, or options page
 * - ❌ WRONG: Create multiple instances of CentralizedStateManager
 * 
 * **Proper Patterns**:
 * ```typescript
 * // ✅ Service Worker (background.ts):
 * import { createStateManager } from '@/entrypoints/background/state-manager';
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
  const stateManager = new CentralizedStateManager();
  await stateManager.initialize();
  return stateManager;
}

/**
 * Process state action with proper error handling and logging
 * 
 * **Central dispatcher for all state mutations in the extension.**
 * 
 * This function:
 * 1. Resolves tabId from message or sender context
 * 2. Validates tabId presence for tab-specific actions
 * 3. Routes to appropriate action handler
 * 4. Returns standardized success/error response
 * 
 * **TabId Resolution Logic**:
 * - `message.tabId`: Explicitly provided (from Popup/Options/Service Worker)
 * - `sender.tab.id`: Inferred from sender (from Content Script)
 * - Priority: `message.tabId || sender.tab.id`
 * 
 * **Coverage**:
 * - All state mutations flow through this function
 * - Enforces single source of truth pattern
 * - See individual handlers for specific mappings
 * 
 * @param stateManager - Centralized state manager instance
 * @param message - StateAction message with action enum and payload
 * @param sender - Optional message sender (provides tab context for content scripts)
 * @returns Success response with optional data, or error response
 */
export async function processStateAction(
  stateManager: CentralizedStateManager,
  message: StateActionMessage,
  sender?: chrome.runtime.MessageSender
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { action, payload } = message;
  const providedTabId = message.tabId;
  const senderTabId = sender?.tab?.id;
  const tabId = typeof providedTabId === 'number' && Number.isInteger(providedTabId) && providedTabId >= 0
    ? providedTabId
    : senderTabId;
  
  logger.info(`Processing state action: ${action}`, { 
    providedTabId, 
    senderTabId, 
    finalTabId: tabId, 
    payload 
  });

  const isReadyInitializePayload = action === StateAction.INITIALIZE_TAB
    && !!payload
    && typeof payload === 'object'
    && (payload as { context?: unknown }).context === 'ready'
  
  try {
    switch (action) {
      case StateAction.INITIALIZE_TAB:
        if (typeof tabId !== 'number') throw new Error('Tab ID required for INITIALIZE_TAB');
        {
          if (isReadyInitializePayload) {
            try {
              const targetTab = await chrome.tabs.get(tabId)
              const targetUrl = targetTab.pendingUrl ?? targetTab.url ?? ''
              if (!matchUrl(targetUrl)) {
                logger.info('Skipping stale INITIALIZE_TAB for unsupported current tab URL', {
                  tabId,
                  targetUrl,
                  senderTabId,
                })
                return { success: true, data: { skipped: true, reason: 'stale-target-url' } }
              }
            } catch (error) {
              logger.debug('Unable to verify target tab URL for INITIALIZE_TAB; skipping stale-init guard', error)
            }
          }

          const result = await handleInitializeTab(stateManager, payload, tabId);
          if (result.success && typeof providedTabId === 'number' && typeof senderTabId === 'number' && senderTabId !== tabId) {
            try {
              await chrome.storage.session.set({ [`tabInitLock_${tabId}`]: Date.now() });
            } catch {
              void 0;
            }
          }
          return result;
        }
      
      case StateAction.CLEAR_TAB_STATE:
        if (typeof tabId !== 'number') throw new Error('Tab ID required for CLEAR_TAB_STATE');
        return await handleClearTabState(stateManager, tabId);
      
      case StateAction.UPDATE_DOWNLOAD_TASK:
        return await handleUpdateDownloadTask(stateManager, payload);
      
      case StateAction.REMOVE_DOWNLOAD_TASK:
        return await handleRemoveDownloadTask(stateManager, payload);
      
      case StateAction.CANCEL_DOWNLOAD_TASK:
        return await handleCancelDownloadTask(stateManager, payload);
      
      case StateAction.UPDATE_SETTINGS:
        return await handleUpdateSettings(stateManager, payload);
      
      case StateAction.CLEAR_DOWNLOAD_HISTORY:
        return await handleClearDownloadHistory(stateManager, payload);
      
      default:
        logger.warn(`Unknown state action: ${String(action)}`);
        return { success: false, error: 'Unknown action' };
    }
  } catch (error) {
    logger.error(`Error processing state action ${action}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

