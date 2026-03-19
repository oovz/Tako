import logger from '@/src/runtime/logger'
import { isRecord } from '@/src/shared/type-guards'

export interface DownloadPipelineError {
  message: string
  category: 'network' | 'download' | 'other'
  code?: string
  cause?: unknown
}

export type PersistentErrorSeverity = 'warning' | 'error'

export interface PersistentError {
  code: string
  message: string
  severity: PersistentErrorSeverity
  ts: number
}

export const PERSISTENT_ERRORS_STORAGE_KEY = 'persistent_errors'

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

export async function getPersistentErrors(): Promise<PersistentError[]> {
  return readPersistentErrors()
}

export async function addPersistentError(input: {
  code: string
  message: string
  severity?: PersistentErrorSeverity
  ts?: number
}): Promise<void> {
  const { code, message } = input
  const severity: PersistentErrorSeverity = input.severity ?? 'error'
  const ts = input.ts ?? Date.now()

  try {
    const existing = await readPersistentErrors()
    const filtered = existing.filter((e) => e.code !== code)
    const next: PersistentError[] = [...filtered, { code, message, severity, ts }]
    await writePersistentErrors(next)
  } catch (error) {
    logger.error('persistentErrors: failed to add error', error)
  }
}

export async function clearPersistentError(code: string): Promise<void> {
  try {
    const existing = await readPersistentErrors()
    const next = existing.filter((e) => e.code !== code)
    await writePersistentErrors(next)
  } catch (error) {
    logger.error('persistentErrors: failed to clear error', error)
  }
}

export async function clearAllPersistentErrors(): Promise<void> {
  try {
    await writePersistentErrors([])
  } catch (error) {
    logger.error('persistentErrors: failed to clear all errors', error)
  }
}

export const errorService = {
  emit: addPersistentError,
  clear: clearPersistentError,
  clearAll: clearAllPersistentErrors,
  getAll: getPersistentErrors
}

