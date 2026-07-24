import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"

const MAX_COMMAND_RESULTS = 128
const COMMAND_RESULT_TTL_MS = 24 * 60 * 60 * 1000

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
        now - record.startedAt <= COMMAND_RESULT_TTL_MS
    )
    .sort((left, right) => right[1].startedAt - left[1].startedAt)
    .slice(0, MAX_COMMAND_RESULTS)
  // A pending record is the durable proof that its side effect may already
  // have happened. Never evict that proof because of age or completed-result
  // cache pressure; doing so would make a replay execute the mutation again.
  return Object.fromEntries([...pending, ...completed])
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
      const existing = records[input.commandId]
      if (!existing) {
        records[input.commandId] = {
          commandId: input.commandId,
          type: input.type,
          fingerprint: messageFingerprint,
          state: "pending",
          startedAt: Date.now(),
        }
        await chrome.storage.local.set({
          [LOCAL_STORAGE_KEYS.commandResults]: pruneRecords(
            records,
            Date.now()
          ),
        })
        return { kind: "new" as const }
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
