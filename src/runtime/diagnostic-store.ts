import type { LogLevel } from "@/src/shared/download-contract"

export const DIAGNOSTIC_CONTEXTS = [
  "background",
  "offscreen",
  "sidepanel",
  "options",
] as const
export type DiagnosticContext = (typeof DIAGNOSTIC_CONTEXTS)[number]

export interface DiagnosticEntry {
  id: string
  capturedAt: number
  level: LogLevel
  context: DiagnosticContext
  incarnationId: string
  sequence: number
  message: string
  details?: unknown
  taskId?: string
  chapterId?: string
}

export interface DiagnosticQuery {
  level?: LogLevel
  context?: DiagnosticContext
  from?: number
  to?: number
  search?: string
}

export type DiagnosticCursor = [capturedAt: number, id: string]

export interface DiagnosticPage {
  revision: number
  entries: DiagnosticEntry[]
  next?: DiagnosticCursor
}

interface RetentionState {
  bytes: number
  revision: number
}

interface StoredEntry {
  id: string
  capturedAt: number
  json: string
  bytes: number
}

const DATABASE = "tako-diagnostics"
const ENTRIES = "entries"
const RETENTION = "retention"
const STATE = "state"
const PAGE_SIZE = 100
const EMPTY_STATE = { bytes: 0, revision: 0 }
const MAX_RETAINED_BYTES = 10 * 1024 * 1024
const MAX_ENTRY_BYTES = 32 * 1024
const encoder = new TextEncoder()

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ENTRIES, {
        keyPath: ["capturedAt", "id"],
      })
      request.result.createObjectStore(RETENTION)
    }
    let blocked = false
    request.onblocked = () => {
      blocked = true
      reject(new Error("Diagnostic database is blocked"))
    }
    request.onerror = () =>
      reject(request.error ?? new Error("Diagnostic storage request failed"))
    request.onsuccess = () => {
      const database = request.result
      if (blocked) {
        database.close()
        return
      }
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Diagnostic storage request failed"))
  })
}

async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const database = await openDatabase()
  try {
    signal?.throwIfAborted()
    const transaction = database.transaction(stores, mode)
    const abort = () => {
      try {
        transaction.abort()
      } catch {
        // The transaction may already have finished.
      }
    }
    const committed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Diagnostic transaction aborted"))
    })
    const work = operation(transaction).catch((error: unknown) => {
      abort()
      throw error
    })
    signal?.addEventListener("abort", abort, { once: true })
    try {
      const [value] = await Promise.all([work, committed])
      return value
    } finally {
      signal?.removeEventListener("abort", abort)
    }
  } finally {
    database.close()
  }
}

export function prepareDiagnosticEntry(entry: DiagnosticEntry): StoredEntry {
  let json = JSON.stringify(entry)
  let bytes = encoder.encode(json).byteLength
  if (bytes > MAX_ENTRY_BYTES) {
    json = JSON.stringify({
      ...entry,
      details: "[Oversized diagnostic omitted]",
    })
    bytes = encoder.encode(json).byteLength
  }
  if (bytes > MAX_ENTRY_BYTES)
    throw new Error("Diagnostic entry exceeds size limit")
  return { capturedAt: entry.capturedAt, id: entry.id, json, bytes }
}

function evictOldest(store: IDBObjectStore, bytes: number): Promise<number> {
  if (bytes <= MAX_RETAINED_BYTES) return Promise.resolve(bytes)
  return new Promise((resolve, reject) => {
    const request = store.openCursor()
    request.onerror = () =>
      reject(request.error ?? new Error("Diagnostic storage request failed"))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        reject(new Error("Diagnostic retention accounting is inconsistent"))
        return
      }
      bytes -= (cursor.value as StoredEntry).bytes
      cursor.delete()
      if (bytes > MAX_RETAINED_BYTES) cursor.continue()
      else resolve(bytes)
    }
  })
}

async function readRetentionState(
  store: IDBObjectStore
): Promise<RetentionState> {
  return (
    ((await result(store.get(STATE))) as RetentionState | undefined) ??
    EMPTY_STATE
  )
}

export async function appendDiagnosticEntries(
  entries: readonly StoredEntry[]
): Promise<void> {
  await transact([ENTRIES, RETENTION], "readwrite", async (transaction) => {
    const retention = transaction.objectStore(RETENTION)
    const store = transaction.objectStore(ENTRIES)
    const { bytes, revision } = await readRetentionState(retention)
    let incomingBytes = 0
    for (const entry of entries) {
      store.add(entry)
      incomingBytes += entry.bytes
    }
    const retained = await evictOldest(store, bytes + incomingBytes)
    await result(
      retention.put({ bytes: retained, revision: revision + 1 }, STATE)
    )
  })
}

export async function clearDiagnostics(): Promise<void> {
  await transact([ENTRIES, RETENTION], "readwrite", async (transaction) => {
    const retention = transaction.objectStore(RETENTION)
    const { revision } = await readRetentionState(retention)
    transaction.objectStore(ENTRIES).clear()
    await result(retention.put({ bytes: 0, revision: revision + 1 }, STATE))
  })
}

export async function readDiagnosticPage(
  query: DiagnosticQuery,
  before?: DiagnosticCursor,
  knownRevision?: number,
  signal?: AbortSignal
): Promise<DiagnosticPage | null> {
  return transact(
    [ENTRIES, RETENTION],
    "readonly",
    async (transaction) => {
      const { revision } = await readRetentionState(
        transaction.objectStore(RETENTION)
      )
      if (revision === knownRevision) return null
      const entries = await scanEntries(
        transaction.objectStore(ENTRIES),
        query,
        PAGE_SIZE + 1,
        before
      )
      const more = entries.length > PAGE_SIZE
      if (more) entries.pop()
      const last = entries.at(-1)
      return {
        revision,
        entries,
        next: more && last ? [last.capturedAt, last.id] : undefined,
      }
    },
    signal
  )
}

function matchesEntry(
  entry: DiagnosticEntry,
  query: DiagnosticQuery,
  search: string
): boolean {
  if (query.level !== undefined && entry.level !== query.level) return false
  if (query.context !== undefined && entry.context !== query.context)
    return false
  return (
    search === "" ||
    entry.message.toLowerCase().includes(search) ||
    (JSON.stringify(entry.details)?.toLowerCase().includes(search) ?? false) ||
    [entry.taskId, entry.chapterId].some((id) =>
      id?.toLowerCase().includes(search)
    )
  )
}

function scanEntries(
  store: IDBObjectStore,
  query: DiagnosticQuery,
  limit: number,
  before?: DiagnosticCursor
): Promise<DiagnosticEntry[]> {
  const search = query.search?.trim().toLowerCase() ?? ""
  return new Promise((resolve, reject) => {
    const entries: DiagnosticEntry[] = []
    // Array keys sort by timestamp first. The exclusive cursor avoids repeating
    // the last row on the preceding page, even when capture times are equal.
    const range = before ? IDBKeyRange.upperBound(before, true) : null
    const request = store.openCursor(range, "prev")
    request.onerror = () =>
      reject(request.error ?? new Error("Diagnostic storage request failed"))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(entries)
        return
      }
      const stored = cursor.value as StoredEntry
      if (query.from !== undefined && stored.capturedAt < query.from) {
        resolve(entries)
        return
      }
      try {
        if (query.to === undefined || stored.capturedAt <= query.to) {
          const entry = JSON.parse(stored.json) as DiagnosticEntry
          if (matchesEntry(entry, query, search)) entries.push(entry)
        }
        if (entries.length === limit) resolve(entries)
        else cursor.continue()
      } catch (error) {
        reject(
          error instanceof Error ? error : new Error("Invalid diagnostic entry")
        )
      }
    }
  })
}
