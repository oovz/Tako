import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'

const DEFAULT_EXTERNAL_TAB_INIT_WINDOW_MS = 30_000

export function getExternalTabInitStorageKey(tabId: number): string {
  return `${SESSION_STORAGE_KEYS.externalTabInitPrefix}${tabId}`
}

export async function markExternalTabInitialization(
  tabId: number,
  timestamp: number = Date.now(),
): Promise<void> {
  await chrome.storage.session.set({ [getExternalTabInitStorageKey(tabId)]: timestamp })
}

/**
 * Remove the external-init mark for a tab. Called by navigation listeners
 * when a tab navigates to a new URL so a stale mark cannot suppress the
 * fresh content-script initialization on the new page.
 */
export async function clearExternalTabInitialization(tabId: number): Promise<void> {
  await chrome.storage.session.remove(getExternalTabInitStorageKey(tabId))
}

/**
 * Return true when the tab was externally initialized within
 * `freshnessWindowMs` and the mark should still suppress content-script
 * re-initialization.
 *
 * The mark is intentionally **sticky-on-fresh**: this function does not
 * remove a fresh mark, so subsequent content-script re-injections (via
 * `chrome.tabs.onActivated` → `ensureContentScriptPresent`) within the
 * same window are all suppressed. Removing the mark on first consume
 * (the previous single-shot behavior) allowed the second re-injection to
 * clobber the externally-initialized tab state with content-script data.
 *
 * Stale marks are cleaned up when observed, and navigation listeners
 * must call `clearExternalTabInitialization` on URL change so the mark
 * does not leak to the next page.
 */
export async function consumeRecentExternalTabInitialization(
  tabId: number,
  freshnessWindowMs: number = DEFAULT_EXTERNAL_TAB_INIT_WINDOW_MS,
): Promise<boolean> {
  const storageKey = getExternalTabInitStorageKey(tabId)
  const result = await chrome.storage.session.get([storageKey]) as Record<string, unknown>
  const rawTimestamp = result[storageKey]
  const timestamp = typeof rawTimestamp === 'number' ? rawTimestamp : undefined

  if (typeof timestamp !== 'number') {
    if (rawTimestamp !== undefined) {
      await chrome.storage.session.remove(storageKey)
    }
    return false
  }

  const isFresh = Date.now() - timestamp < freshnessWindowMs
  if (!isFresh) {
    await chrome.storage.session.remove(storageKey)
  }
  return isFresh
}
