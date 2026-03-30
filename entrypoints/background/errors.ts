import logger from '@/src/runtime/logger'
import { isRecord } from '@/src/shared/type-guards'

export type PersistentErrorSeverity = 'warning' | 'error'

type PersistentErrorInput = {
  code: string
  message: string
  severity?: PersistentErrorSeverity
  ts?: number
}

export interface PersistentError {
  code: string
  message: string
  severity: PersistentErrorSeverity
  ts: number
}

const PERSISTENT_ERRORS_STORAGE_KEY = 'persistent_errors'

async function readPersistentErrors(): Promise<PersistentError[]> {
  try {
    const result = await chrome.storage.local.get(PERSISTENT_ERRORS_STORAGE_KEY)
    const raw: unknown = result[PERSISTENT_ERRORS_STORAGE_KEY]
    if (!Array.isArray(raw)) return []
    const errors: PersistentError[] = []
    for (const item of raw) {
      if (isRecord(item) && typeof item.code === 'string' && typeof item.message === 'string') {
        errors.push({
          code: item.code,
          message: item.message,
          severity: (item.severity === 'error' ? 'error' : 'warning') as PersistentErrorSeverity,
          ts: typeof item.ts === 'number' ? item.ts : Date.now(),
        })
      }
    }
    return errors
  } catch (error) {
    logger.error('persistentErrors: failed to read from storage', error)
    return []
  }
}

async function writePersistentErrors(errors: PersistentError[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [PERSISTENT_ERRORS_STORAGE_KEY]: errors })
  } catch (error) {
    logger.error('persistentErrors: failed to write to storage', error)
  }
}

async function updatePersistentErrors(
  update: (existing: PersistentError[]) => PersistentError[],
  errorContext: string,
): Promise<void> {
  try {
    const existing = await readPersistentErrors()
    await writePersistentErrors(update(existing))
  } catch (error) {
    logger.error(`persistentErrors: failed to ${errorContext}`, error)
  }
}

export async function getPersistentErrors(): Promise<PersistentError[]> {
  return readPersistentErrors()
}

export async function addPersistentError(input: PersistentErrorInput): Promise<void> {
  const { code, message } = input
  const severity: PersistentErrorSeverity = input.severity ?? 'error'
  const ts = input.ts ?? Date.now()

  await updatePersistentErrors((existing) => {
    const filtered = existing.filter((error) => error.code !== code)
    return [...filtered, { code, message, severity, ts }]
  }, 'add error')
}

export async function clearPersistentError(code: string): Promise<void> {
  await updatePersistentErrors(
    (existing) => existing.filter((error) => error.code !== code),
    'clear error',
  )
}
