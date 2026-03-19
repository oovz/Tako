/**
 * State Action Enum - Central Registry of All State Mutations
 * 
 * **CRITICAL**: All state mutations MUST use these StateAction values.
 * 
 * This enum serves as the single source of truth for state mutation types.
 * Each action corresponds to a handler in `entrypoints/background/action-handlers/`.
 * 
 * **Architecture Pattern**:
 * 1. UI/Content sends: `sendStateAction(StateAction.*, payload, tabId?)`
 * 2. Service Worker receives via `chrome.runtime.onMessage`
 * 3. `processStateAction()` routes to appropriate handler
 * 4. Handler mutates state via `CentralizedStateManager`
 * 5. `chrome.storage.session.set()` broadcasts change
 * 6. All contexts react via `chrome.storage.session.onChanged`
 * 
 * **Coverage**: See individual action JSDoc comments below
 * 
 * Kept in a tiny module to avoid circular deps and allow safe imports
 * from any context (service worker, content script, UI, offscreen).
 */

export enum StateAction {
  // ===== Tab State Actions (require tabId parameter) =====
  
  /** Initialize tab state with series/chapters */
  INITIALIZE_TAB,
  
  /** Clear all state for tab (cleanup on tab close) */
  CLEAR_TAB_STATE,

  // ===== Download Task Actions =====
  
  /** Update download task state - Uses taskId, no tabId required */
  UPDATE_DOWNLOAD_TASK,
  
  /** Remove completed/failed task - Uses taskId, no tabId required */
  REMOVE_DOWNLOAD_TASK,
  
  /** Cancel active download task - Uses taskId, no tabId required */
  CANCEL_DOWNLOAD_TASK,

  // ===== Settings Actions (global state) =====
  
  /** Update extension settings */
  UPDATE_SETTINGS,

  // ===== Progress Actions =====
  
  /** Clear download history - Optional seriesId in payload */
  CLEAR_DOWNLOAD_HISTORY,
}
