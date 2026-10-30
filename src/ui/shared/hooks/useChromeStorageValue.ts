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

interface ChromeStorageSubscription<T> {
  getSnapshot: () => StorageSnapshot<T>
  subscribe: (listener: () => void) => () => void
  refresh: () => Promise<void>
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

class ChromeStorageStore<T> {
  readonly subscription: ChromeStorageSubscription<T>
  private readonly storageListener: Parameters<
    typeof chrome.storage.onChanged.addListener
  >[0]
  private snapshot: StorageSnapshot<T>
  private listening = false
  private latestReadId = 0
  private deferredRefreshTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<() => void>()

  constructor(private readonly options: UseChromeStorageValueOptions<T>) {
    this.snapshot = {
      value: options.initialValue,
      hydrated: false,
      status: "loading",
    }
    this.subscription = {
      getSnapshot: this.getSnapshot.bind(this),
      subscribe: this.subscribe.bind(this),
      refresh: this.refresh.bind(this),
    }
    this.storageListener = this.handleStorageChange.bind(this)
  }

  private getSnapshot(): StorageSnapshot<T> {
    return this.snapshot
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private setSnapshot(
    value: T,
    hydrated: boolean,
    status: StorageReadStatus
  ): void {
    if (
      this.snapshot.hydrated === hydrated &&
      this.snapshot.status === status &&
      Object.is(this.snapshot.value, value)
    )
      return
    this.snapshot = { value, hydrated, status }
    this.emit()
  }

  private fail(): void {
    this.setSnapshot(
      this.snapshot.value,
      true,
      this.snapshot.status === "ready" || this.snapshot.status === "stale"
        ? "stale"
        : "error"
    )
  }

  private async readCurrentValue(): Promise<void> {
    const { areaName, key, parse } = this.options
    const readId = ++this.latestReadId

    try {
      const result = await getStorageArea(areaName).get(key)
      if (readId !== this.latestReadId) {
        return
      }

      const raw = Array.isArray(key) ? result : result[key]
      this.setSnapshot(parse(raw), true, "ready")
    } catch {
      if (readId !== this.latestReadId) {
        return
      }

      this.fail()
    }
  }

  private handleStorageChange(
    changes: Record<string, chrome.storage.StorageChange>,
    changedAreaName: chrome.storage.AreaName
  ): void {
    const { areaName, key } = this.options
    if (changedAreaName !== areaName) {
      return
    }

    if (!hasRelevantKeyChange(key, changes)) {
      return
    }

    void this.readCurrentValue()
  }

  private ensureListening(): boolean {
    if (this.listening) return true

    try {
      chrome.storage.onChanged.addListener(this.storageListener)
      this.listening = true
    } catch {
      this.fail()
      return false
    }
    return true
  }

  private async refresh(): Promise<void> {
    if (!this.ensureListening()) return
    if (this.snapshot.status === "error")
      this.setSnapshot(this.snapshot.value, this.snapshot.hydrated, "loading")
    await this.readCurrentValue()
  }

  private start(): void {
    if (!this.ensureListening()) return
    void this.readCurrentValue()

    this.deferredRefreshTimer = setTimeout(() => {
      this.deferredRefreshTimer = null
      void this.readCurrentValue()
    }, 0)
  }

  private cleanup(): void {
    this.latestReadId += 1
    if (this.listening) {
      this.listening = false

      try {
        chrome.storage.onChanged.removeListener(this.storageListener)
      } catch {
        // The extension may already be shutting down.
      }
    }

    if (this.deferredRefreshTimer !== null) {
      clearTimeout(this.deferredRefreshTimer)
      this.deferredRefreshTimer = null
    }
  }

  private subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.cleanup()
      }
    }
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
    return new ChromeStorageStore({
      areaName,
      key: stableKey,
      initialValue: stableInitialValue,
      parse,
    }).subscription
  }, [areaName, keySignature, parse, stableInitialValue])

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )
  return { ...snapshot, refresh: store.refresh }
}
