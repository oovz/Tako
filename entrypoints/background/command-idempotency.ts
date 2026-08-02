import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"

const MAX_COMMAND_RESULTS = 128
const COMMAND_RESULT_TTL_MS = 24 * 60 * 60 * 1000
export const COMMAND_PENDING_RECONCILIATION_WINDOW_MS = 5 * 60 * 1000
const UNKNOWN_COMMAND_OUTCOME = {
  success: false,
  error: "Command outcome could not be reconciled after worker interruption",
} as const

type CommandRecord = {
  commandId: string
  type: string
  fingerprint: string
  state: "pending" | "completed"
  startedAt: number
  completedAt?: number
  result?: unknown
}

type CommandRecordMap = Record<string, CommandRecord>

type ActiveCommand = {
  type: string
  fingerprint: string
  promise: Promise<unknown>
}

const activeCommands = new Map<string, ActiveCommand>()
let commandStorageChain: Promise<void> = Promise.resolve()

function fingerprint(value: unknown): string {
  const input = JSON.stringify(value)
  let left = 0x811c9dc5
  let right = 0x9e3779b9
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    left = Math.imul(left ^ code, 0x01000193)
    right = Math.imul(right ^ code, 0x85ebca6b)
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0)
    .toString(16)
    .padStart(8, "0")}`
}

function isCommandRecord(value: unknown): value is CommandRecord {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<CommandRecord>
  return (
    typeof record.commandId === "string" &&
    typeof record.type === "string" &&
    typeof record.fingerprint === "string" &&
    (record.state === "pending" || record.state === "completed") &&
    typeof record.startedAt === "number"
  )
}

async function readRecords(): Promise<CommandRecordMap> {
  const stored = await chrome.storage.local.get(
    LOCAL_STORAGE_KEYS.commandResults
  )
  const value = stored[LOCAL_STORAGE_KEYS.commandResults]
  if (!value || typeof value !== "object") return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, CommandRecord] =>
      isCommandRecord(entry[1])
    )
  )
}

function pruneRecords(
  records: CommandRecordMap,
  now: number
): CommandRecordMap {
  const entries = Object.entries(records)
  const pending = entries.filter(([, record]) => record.state === "pending")
  const completed = entries
    .filter(
      ([, record]) =>
        record.state === "completed" &&
        now - (record.completedAt ?? record.startedAt) <= COMMAND_RESULT_TTL_MS
    )
    .sort((left, right) => right[1].startedAt - left[1].startedAt)
    .slice(0, MAX_COMMAND_RESULTS)
  // Pending records inside the reconciliation window remain durable proof that
  // their side effect may already have happened. Expired records are converted
  // to a durable unknown/failure result before this pruning step.
  return Object.fromEntries([...pending, ...completed])
}

function reconcileExpiredPendingRecords(
  records: CommandRecordMap,
  now: number
): boolean {
  let changed = false
  for (const [commandId, record] of Object.entries(records)) {
    if (
      record.state !== "pending" ||
      now - record.startedAt < COMMAND_PENDING_RECONCILIATION_WINDOW_MS
    ) {
      continue
    }
    records[commandId] = {
      ...record,
      state: "completed",
      completedAt: now,
      result: structuredClone(UNKNOWN_COMMAND_OUTCOME),
    }
    changed = true
  }
  return changed
}

async function withCommandStorage<T>(operation: () => Promise<T>): Promise<T> {
  const previous = commandStorageChain
  let release!: () => void
  const owned = new Promise<void>((resolve) => {
    release = resolve
  })
  commandStorageChain = previous.catch(() => undefined).then(() => owned)
  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
  }
}

export async function executeIdempotentCommand<T>(input: {
  commandId: string
  type: string
  message: unknown
  operation: () => Promise<T>
}): Promise<T> {
  const messageFingerprint = fingerprint(input.message)
  const current = activeCommands.get(input.commandId)
  if (current) {
    if (
      current.type !== input.type ||
      current.fingerprint !== messageFingerprint
    ) {
      return {
        success: false,
        error: "Command ID was reused with different input",
      } as T
    }
    return (await current.promise) as T
  }

  const operation = (async (): Promise<T> => {
    const replay = await withCommandStorage(async () => {
      const records = await readRecords()
      const now = Date.now()
      const reconciledExpiredPending = reconcileExpiredPendingRecords(
        records,
        now
      )
      const existing = records[input.commandId]
      if (!existing) {
        records[input.commandId] = {
          commandId: input.commandId,
          type: input.type,
          fingerprint: messageFingerprint,
          state: "pending",
          startedAt: now,
        }
        await chrome.storage.local.set({
          [LOCAL_STORAGE_KEYS.commandResults]: pruneRecords(records, now),
        })
        return { kind: "new" as const }
      }
      if (reconciledExpiredPending) {
        await chrome.storage.local.set({
          [LOCAL_STORAGE_KEYS.commandResults]: pruneRecords(records, now),
        })
      }
      if (
        existing.type !== input.type ||
        existing.fingerprint !== messageFingerprint
      ) {
        return { kind: "collision" as const }
      }
      if (existing.state === "completed") {
        return { kind: "completed" as const, result: existing.result as T }
      }
      return { kind: "pending" as const }
    })

    if (replay.kind === "completed") return structuredClone(replay.result)
    if (replay.kind === "collision") {
      return {
        success: false,
        error: "Command ID was reused with different input",
      } as T
    }
    if (replay.kind === "pending") {
      return {
        success: false,
        error: "Command outcome is pending reconciliation",
      } as T
    }

    let result: T
    try {
      result = await input.operation()
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      } as T
    }

    await withCommandStorage(async () => {
      const records = await readRecords()
      const existing = records[input.commandId]
      if (
        !existing ||
        existing.type !== input.type ||
        existing.fingerprint !== messageFingerprint
      ) {
        throw new Error("Command intent disappeared before result commit")
      }
      records[input.commandId] = {
        ...existing,
        state: "completed",
        completedAt: Date.now(),
        result: structuredClone(result),
      }
      await chrome.storage.local.set({
        [LOCAL_STORAGE_KEYS.commandResults]: pruneRecords(records, Date.now()),
      })
    })
    return result
  })()

  activeCommands.set(input.commandId, {
    type: input.type,
    fingerprint: messageFingerprint,
    promise: operation,
  })
  try {
    return await operation
  } finally {
    if (activeCommands.get(input.commandId)?.promise === operation) {
      activeCommands.delete(input.commandId)
    }
  }
}
