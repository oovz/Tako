import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { useChromeStorageValue } from '@/src/ui/shared/hooks/useChromeStorageValue'
import { isRecord } from '@/src/shared/type-guards'

export interface InitFailureState {
  initFailed: boolean
  error?: string
}
const DEFAULT_INIT_FAILURE_STATE: InitFailureState = {
  initFailed: false,
  error: undefined,
}

export function normalizeInitFailureState(raw: unknown): InitFailureState {
  if (!isRecord(raw)) {
    return DEFAULT_INIT_FAILURE_STATE
  }

  const initFailed = raw[SESSION_STORAGE_KEYS.initFailed] === true
  const rawError = raw[SESSION_STORAGE_KEYS.initError]
  const error = typeof rawError === 'string' ? rawError : undefined

  return {
    initFailed,
    error,
  }
}

export function useInitFailure(): InitFailureState {
  const { value } = useChromeStorageValue({
    areaName: 'session',
    key: [SESSION_STORAGE_KEYS.initFailed, SESSION_STORAGE_KEYS.initError],
    initialValue: DEFAULT_INIT_FAILURE_STATE,
    parse: normalizeInitFailureState,
  })

  return value
}

