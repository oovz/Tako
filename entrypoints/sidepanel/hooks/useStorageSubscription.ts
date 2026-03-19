import { useChromeStorageValue } from '@/src/ui/shared/hooks/useChromeStorageValue'

export interface UseStorageSubscriptionOptions<T> {
  areaName: 'session' | 'local'
  key: string
  initialValue: T
  parse: (raw: unknown) => T
}

export interface UseStorageSubscriptionResult<T> {
  value: T
  hydrated: boolean
}

export function useStorageSubscription<T>(options: UseStorageSubscriptionOptions<T>): UseStorageSubscriptionResult<T> {
  return useChromeStorageValue(options)
}

