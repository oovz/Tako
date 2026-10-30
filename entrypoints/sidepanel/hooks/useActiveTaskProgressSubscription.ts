import {
  ACTIVE_TASK_PROGRESS_PORT_NAME,
  normalizeActiveTaskProgress,
  normalizeActiveTaskProgressPortMessage,
  type ActiveTaskProgressSnapshot,
} from "@/src/runtime/active-task-progress"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"

export interface ProgressRevision {
  generation: string
  revision: number
  progress: ActiveTaskProgressSnapshot | null
}

export function parseProgressRevision(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null
}

export function parseProgressGeneration(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function shouldAcceptProgressRevision(input: {
  currentGeneration: string | null
  currentRevision: number
  nextGeneration: string
  nextRevision: number
  allowEqual?: boolean
}): boolean {
  if (input.currentGeneration !== input.nextGeneration) return true
  return input.allowEqual
    ? input.nextRevision >= input.currentRevision
    : input.nextRevision > input.currentRevision
}

export function coherentProgressSnapshot(
  generation: string | null,
  revision: number | null,
  progress: ActiveTaskProgressSnapshot | null
): ProgressRevision | undefined {
  if (generation === null || revision === null) return
  if (
    progress !== null &&
    (progress.generation !== generation || progress.revision !== revision)
  )
    return
  return { generation, revision, progress }
}

function readStoredProgress(stored: Record<string, unknown>) {
  const raw = stored[SESSION_STORAGE_KEYS.activeTaskProgress]
  const progress = normalizeActiveTaskProgress(raw)
  if (raw !== null && progress === null) return
  return coherentProgressSnapshot(
    parseProgressGeneration(
      stored[SESSION_STORAGE_KEYS.activeTaskProgressGeneration]
    ),
    parseProgressRevision(
      stored[SESSION_STORAGE_KEYS.activeTaskProgressRevision]
    ),
    progress
  )
}

export function createProgressSnapshotReceiver(
  commit: (progress: ActiveTaskProgressSnapshot | null) => void
) {
  let currentGeneration: string | null = null
  let currentRevision = 0
  let live = false

  function accept(snapshot: ProgressRevision, allowEqual: boolean) {
    if (
      !shouldAcceptProgressRevision({
        currentGeneration,
        currentRevision,
        nextGeneration: snapshot.generation,
        nextRevision: snapshot.revision,
        allowEqual,
      })
    )
      return
    currentGeneration = snapshot.generation
    currentRevision = snapshot.revision
    commit(snapshot.progress)
  }

  return {
    hydrate(snapshot: ProgressRevision | undefined) {
      if (live || !snapshot) return
      accept(snapshot, true)
    },
    receive(snapshot: ProgressRevision) {
      live = true
      accept(snapshot, false)
    },
    recover(snapshot: ProgressRevision) {
      accept(snapshot, false)
    },
    disconnect() {
      live = false
    },
  }
}

class ProgressPortSubscription {
  private disposed = false
  private port: chrome.runtime.Port | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly receiver: ReturnType<typeof createProgressSnapshotReceiver>
  ) {}

  private async recover() {
    try {
      const stored = await chrome.storage.session.get([
        SESSION_STORAGE_KEYS.activeTaskProgress,
        SESSION_STORAGE_KEYS.activeTaskProgressRevision,
        SESSION_STORAGE_KEYS.activeTaskProgressGeneration,
      ])
      if (this.disposed) return
      const snapshot = readStoredProgress(stored)
      if (snapshot) this.receiver.recover(snapshot)
    } catch {
      // A later connection or storage notification can restore the projection.
    } finally {
      if (!this.disposed)
        this.reconnectTimer = setTimeout(() => this.connect(), 250)
    }
  }

  private receive(port: chrome.runtime.Port, message: unknown) {
    if (this.disposed || this.port !== port) return
    const snapshot = normalizeActiveTaskProgressPortMessage(message)
    if (snapshot) this.receiver.receive(snapshot)
  }

  private disconnect(port: chrome.runtime.Port) {
    if (this.port !== port) return
    this.port = null
    this.receiver.disconnect()
    if (!this.disposed) void this.recover()
  }

  connect() {
    if (this.disposed) return
    try {
      const port = chrome.runtime.connect({
        name: ACTIVE_TASK_PROGRESS_PORT_NAME,
      })
      this.port = port
      port.onMessage.addListener((message: unknown) =>
        this.receive(port, message)
      )
      port.onDisconnect.addListener(() => this.disconnect(port))
    } catch {
      void this.recover()
    }
  }

  dispose() {
    this.disposed = true
    this.receiver.disconnect()
    clearTimeout(this.reconnectTimer)
    this.port?.disconnect()
  }
}

export function subscribeToActiveTaskProgress(
  receiver: ReturnType<typeof createProgressSnapshotReceiver>
): () => void {
  const subscription = new ProgressPortSubscription(receiver)
  subscription.connect()
  return () => subscription.dispose()
}
