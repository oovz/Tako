import { useCallback, useEffect, useState } from 'react'
import { isRecord, type StorageValue } from '@/src/shared/type-guards'

export type UIPersistentErrorSeverity = 'warning' | 'error'

export interface UIPersistentError {
  code: string
  message: string
  severity: UIPersistentErrorSeverity
  ts: number
}

const STORAGE_KEY = 'persistent_errors'

function parseErrors(raw: unknown): UIPersistentError[] {
  if (!Array.isArray(raw)) return []
  const now = Date.now()
  const errors: UIPersistentError[] = []
  for (const item of raw) {
    if (isRecord(item) && typeof item.code === 'string' && typeof item.message === 'string') {
      errors.push({
        code: item.code,
        message: item.message,
        severity: item.severity === 'error' ? 'error' : 'warning',
        ts: typeof item.ts === 'number' ? item.ts : now,
      })
    }
  }
  return errors
}

export function useErrors() {
  const [errors, setErrors] = useState<UIPersistentError[]>([])

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEY) as Record<string, StorageValue>
        if (!isMounted) return
        setErrors(parseErrors(result[STORAGE_KEY]))
      } catch {
        if (isMounted) setErrors([])
      }
    }

    // Fire-and-forget: React useEffect is sync; async error load runs in background
    void load()

    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== 'local') return
      const change = changes[STORAGE_KEY]
      if (!change) return
      const next = change.newValue as StorageValue | undefined
      setErrors(parseErrors(next))
    }

    chrome.storage.onChanged.addListener(listener)

    return () => {
      isMounted = false
      chrome.storage.onChanged.removeListener(listener)
    }
  }, [])

  const acknowledgeError = useCallback(async (code: string) => {
    if (!code) return
    try {
      await chrome.runtime.sendMessage({ type: 'ACKNOWLEDGE_ERROR', payload: { code } })
    } catch {
      // Best-effort: optimistically update local state
      setErrors((prev) => prev.filter((e) => e.code !== code))
    }
  }, [])

  return { errors, acknowledgeError }
}

