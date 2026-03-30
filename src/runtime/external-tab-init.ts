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
  await chrome.storage.session.remove(storageKey)
  return isFresh
}
