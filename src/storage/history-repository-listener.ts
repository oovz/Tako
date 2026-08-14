import {
  HISTORY_STORAGE_KEYS,
  type HistoryRepository,
} from "@/src/storage/history-repository"

const historyStorageKeys = new Set<string>(Object.values(HISTORY_STORAGE_KEYS))

export function createHistoryRepositoryChangeListener(
  repository: HistoryRepository
): (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName
) => void {
  return (changes, areaName) => {
    if (areaName !== "local") return
    if (!Object.keys(changes).some((key) => historyStorageKeys.has(key))) return
    repository.invalidateCache()
  }
}

export function registerHistoryRepositoryListener(
  repository: HistoryRepository
): void {
  chrome.storage.onChanged.addListener(
    createHistoryRepositoryChangeListener(repository)
  )
}
