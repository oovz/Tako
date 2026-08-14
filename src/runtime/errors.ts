import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"
import {
  PersistentErrorsSchema,
  type PersistentError,
  type PersistentErrorSeverity,
} from "@/src/runtime/persistent-error-schema"

type PersistentErrorInput = {
  code: string
  message: string
  severity?: PersistentErrorSeverity
  ts?: number
}

const PERSISTENT_ERRORS_STORAGE_KEY = LOCAL_STORAGE_KEYS.persistentErrors
const persistentErrorMutations = new StorageMutationQueue()

async function readPersistentErrors(): Promise<PersistentError[]> {
  const result = await chrome.storage.local.get(PERSISTENT_ERRORS_STORAGE_KEY)
  if (!(PERSISTENT_ERRORS_STORAGE_KEY in result)) return []

  const parsed = PersistentErrorsSchema.safeParse(
    result[PERSISTENT_ERRORS_STORAGE_KEY]
  )
  if (!parsed.success) {
    throw new InvalidDurableStateError(
      "Invalid durable persistent error state",
      { cause: parsed.error }
    )
  }
  return parsed.data
}

async function writePersistentErrors(errors: PersistentError[]): Promise<void> {
  await chrome.storage.local.set({ [PERSISTENT_ERRORS_STORAGE_KEY]: errors })
}

async function updatePersistentErrors(
  update: (existing: PersistentError[]) => PersistentError[]
): Promise<void> {
  await persistentErrorMutations.run(async () => {
    const existing = await readPersistentErrors()
    await writePersistentErrors(update(existing))
  })
}

export async function getPersistentErrors(): Promise<PersistentError[]> {
  return persistentErrorMutations.run(readPersistentErrors)
}

export async function addPersistentError(
  input: PersistentErrorInput
): Promise<void> {
  const { code, message } = input
  const severity: PersistentErrorSeverity = input.severity ?? "error"
  const ts = input.ts ?? Date.now()

  await updatePersistentErrors((existing) => {
    const filtered = existing.filter((error) => error.code !== code)
    return [...filtered, { code, message, severity, ts }]
  })
}

export async function clearPersistentError(code: string): Promise<void> {
  await updatePersistentErrors((existing) =>
    existing.filter((error) => error.code !== code)
  )
}
