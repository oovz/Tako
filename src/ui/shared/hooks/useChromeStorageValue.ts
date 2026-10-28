import { useMemo, useState, useSyncExternalStore } from "react"

export interface UseChromeStorageValueOptions<T> {
  areaName: "session" | "local"
  key: string | string[]
  initialValue: T
  parse: (raw: unknown) => T
}

export type StorageReadStatus = "loading" | "ready" | "error" | "stale"

export interface UseChromeStorageValueResult<T> {
  value: T
  /** The initial subscription/read attempt has finished. Status describes data validity. */
  hydrated: boolean
  status: StorageReadStatus
  refresh: () => Promise<void>
}

interface StorageSnapshot<T> {
  value: T
  hydrated: boolean
  status: StorageReadStatus
}

function getStorageArea(
  areaName: "session" | "local"
): chrome.storage.StorageArea {
  return areaName === "session" ? chrome.storage.session : chrome.storage.local
}

function hasRelevantKeyChange(
  key: string | string[],
  changes: Record<string, chrome.storage.StorageChange>
): boolean {
  if (Array.isArray(key)) {
    return key.some((item) => item in changes)
  }

  return key in changes
}

function createChromeStorageStore<T>(options: UseChromeStorageValueOptions<T>) {
  const { areaName, key, initialValue, parse } = options

  let snapshot: StorageSnapshot<T> = {
    value: initialValue,
    hydrated: false,
    status: "loading",
  }
  let listening = false
  let latestReadId = 0
  let deferredRefreshTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setSnapshot = (
    value: T,
    hydrated: boolean,
    status: StorageReadStatus
  ): void => {
    if (
      snapshot.hydrated === hydrated &&
      snapshot.status === status &&
      Object.is(snapshot.value, value)
    )
      return
    snapshot = { value, hydrated, status }
    emit()
  }

  const fail = (): void => {
    setSnapshot(
      snapshot.value,
      true,
      snapshot.status === "ready" || snapshot.status === "stale"
        ? "stale"
        : "error"
    )
  }

  const readCurrentValue = async (): Promise<void> => {
    const readId = ++latestReadId

    try {
      const result = await getStorageArea(areaName).get(key)
      if (readId !== latestReadId) {
        return
      }

      const raw = Array.isArray(key) ? result : result[key]
      setSnapshot(parse(raw), true, "ready")
    } catch {
      if (readId !== latestReadId) {
        return
      }

      fail()
    }
  }

  const handleStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    changedAreaName: chrome.storage.AreaName
  ): void => {
    if (changedAreaName !== areaName) {
      return
    }

    if (!hasRelevantKeyChange(key, changes)) {
      return
    }

    void readCurrentValue()
  }

  const ensureListening = (): boolean => {
    if (listening) return true

    try {
      chrome.storage.onChanged.addListener(handleStorageChange)
      listening = true
    } catch {
      fail()
      return false
    }
    return true
  }

  const refresh = async (): Promise<void> => {
    if (!ensureListening()) return
    if (snapshot.status === "error")
      setSnapshot(snapshot.value, snapshot.hydrated, "loading")
    await readCurrentValue()
  }

  const start = (): void => {
    if (!ensureListening()) return
    void readCurrentValue()

    deferredRefreshTimer = setTimeout(() => {
      deferredRefreshTimer = null
      void readCurrentValue()
    }, 0)
  }

  const cleanup = (): void => {
    latestReadId += 1
    if (listening) {
      listening = false

      try {
        chrome.storage.onChanged.removeListener(handleStorageChange)
      } catch {
        // The extension may already be shutting down.
      }
    }

    if (deferredRefreshTimer !== null) {
      clearTimeout(deferredRefreshTimer)
      deferredRefreshTimer = null
    }
  }

  return {
    getSnapshot: (): StorageSnapshot<T> => snapshot,
    refresh,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      if (listeners.size === 1) start()

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          cleanup()
        }
      }
    },
  }
}

export function useChromeStorageValue<T>(
  options: UseChromeStorageValueOptions<T>
): UseChromeStorageValueResult<T> {
  const { areaName, key, initialValue, parse } = options
  const keySignature = JSON.stringify(key)
  const [stableInitialValue] = useState(() => initialValue)

  const store = useMemo(() => {
    const stableKey = JSON.parse(keySignature) as string | string[]
    return createChromeStorageStore({
      areaName,
      key: stableKey,
      initialValue: stableInitialValue,
      parse,
    })
  }, [areaName, keySignature, parse, stableInitialValue])

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )
  return { ...snapshot, refresh: store.refresh }
}
