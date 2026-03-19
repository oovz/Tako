import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { IPC_THROTTLE_MS } from '@/src/constants/timeouts'

export interface PendingDownloadsStore {
  hydrate: () => Promise<void>
  get: (downloadId: number) => string | undefined
  set: (downloadId: number, blobUrl: string) => void
  remove: (downloadId: number) => void
  clear: () => void
  snapshot: () => Map<number, string>
}

function toSerializableRecord(map: Map<number, string>): Record<string, string> {
  const value: Record<string, string> = {}
  for (const [key, blobUrl] of map.entries()) {
    value[String(key)] = blobUrl
  }
  return value
}

export function createPendingDownloadsStore(): PendingDownloadsStore {
  const inMemory = new Map<number, string>()
  let persistTimer: ReturnType<typeof setTimeout> | undefined

  const persist = () => {
    persistTimer = undefined
    const payload = toSerializableRecord(inMemory)
    void chrome.storage.session.set({ [SESSION_STORAGE_KEYS.pendingDownloads]: payload })
  }

  const schedulePersist = () => {
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer)
    }

    persistTimer = setTimeout(() => {
      persist()
    }, IPC_THROTTLE_MS)
  }

  return {
    async hydrate() {
      const result = await chrome.storage.session.get(SESSION_STORAGE_KEYS.pendingDownloads) as Record<string, unknown>
      const raw: unknown = result[SESSION_STORAGE_KEYS.pendingDownloads]
      if (!raw || typeof raw !== 'object') {
        return
      }

      for (const [downloadId, blobUrl] of Object.entries(raw as Record<string, unknown>)) {
        const parsedId = Number(downloadId)
        if (!Number.isFinite(parsedId)) {
          continue
        }

        if (typeof blobUrl === 'string') {
          inMemory.set(parsedId, blobUrl)
        }
      }
    },
    get(downloadId) {
      return inMemory.get(downloadId)
    },
    set(downloadId, blobUrl) {
      inMemory.set(downloadId, blobUrl)
      schedulePersist()
    },
    remove(downloadId) {
      if (!inMemory.has(downloadId)) {
        return
      }

      inMemory.delete(downloadId)
      schedulePersist()
    },
    clear() {
      if (inMemory.size === 0) {
        return
      }

      inMemory.clear()
      schedulePersist()
    },
    snapshot() {
      return new Map(inMemory)
    },
  }
}

