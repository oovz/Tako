import { useMemo, useSyncExternalStore } from 'react'

export interface UseChromeStorageValueOptions<T> {
  areaName: 'session' | 'local'
  key: string | string[]
  initialValue: T
  parse: (raw: unknown) => T
}

export interface UseChromeStorageValueResult<T> {
  value: T
  hydrated: boolean
}

interface StorageSnapshot<T> {
  value: T
  hydrated: boolean
}

function createSnapshot<T>(value: T, hydrated: boolean): StorageSnapshot<T> {
  return { value, hydrated }
}

function getStorageArea(areaName: 'session' | 'local'): chrome.storage.StorageArea {
  return areaName === 'session' ? chrome.storage.session : chrome.storage.local
}

function hasRelevantKeyChange(
  key: string | string[],
  changes: Record<string, chrome.storage.StorageChange>,
): boolean {
  if (Array.isArray(key)) {
    return key.some((item) => item in changes)
  }

  return key in changes
}

function createChromeStorageStore<T>(options: UseChromeStorageValueOptions<T>) {
  const { areaName, key, initialValue, parse } = options

  let snapshot = createSnapshot(initialValue, false)
  let listening = false
  let latestReadId = 0
  let deferredRefreshTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setSnapshot = (nextValue: T, hydrated: boolean): void => {
    if (snapshot.hydrated === hydrated && Object.is(snapshot.value, nextValue)) {
      return
    }

    snapshot = createSnapshot(nextValue, hydrated)
    emit()
  }

  const safeParse = (raw: unknown): T => {
    try {
      return parse(raw)
    } catch {
      return initialValue
    }
  }

  const readCurrentValue = async (): Promise<void> => {
    const readId = ++latestReadId

    try {
      const result = await getStorageArea(areaName).get(key) as Record<string, unknown>
      if (readId !== latestReadId) {
        return
      }

      const raw = Array.isArray(key) ? result : result[key]
      setSnapshot(safeParse(raw), true)
    } catch {
      if (readId !== latestReadId) {
        return
      }

      setSnapshot(initialValue, true)
    }
  }

  const handleStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    changedAreaName: chrome.storage.AreaName,
  ): void => {
    if (changedAreaName !== areaName) {
      return
    }

    if (!hasRelevantKeyChange(key, changes)) {
      return
    }

    void readCurrentValue()
  }

  const ensureListening = (): void => {
    if (listening) {
      return
    }

    listening = true

    try {
      chrome.storage.onChanged.addListener(handleStorageChange)
    } catch {
      setSnapshot(initialValue, true)
      return
    }

    void readCurrentValue()

    deferredRefreshTimer = setTimeout(() => {
      deferredRefreshTimer = null
      void readCurrentValue()
    }, 0)
  }

  const cleanup = (): void => {
    if (!listening) {
      return
    }

    listening = false

    try {
      chrome.storage.onChanged.removeListener(handleStorageChange)
    } catch {
      // noop
    }

    if (deferredRefreshTimer !== null) {
      clearTimeout(deferredRefreshTimer)
      deferredRefreshTimer = null
    }
  }

  return {
    getSnapshot: (): StorageSnapshot<T> => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      ensureListening()

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          cleanup()
        }
      }
    },
  }
}

export function __createChromeStorageStoreForTests<T>(options: UseChromeStorageValueOptions<T>) {
  return createChromeStorageStore(options)
}

export function useChromeStorageValue<T>(
  options: UseChromeStorageValueOptions<T>,
): UseChromeStorageValueResult<T> {
  const keySignature = Array.isArray(options.key) ? options.key.join('\u0000') : options.key

  const store = useMemo(
    () => createChromeStorageStore(options),
    [options.areaName, keySignature, options.parse],
  )

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
