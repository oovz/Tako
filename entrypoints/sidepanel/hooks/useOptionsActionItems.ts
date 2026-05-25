import { useMemo } from 'react'

import {
  hasOptionsActionItems,
  parseOptionsActionItems,
  type OptionsActionItems,
} from '@/src/runtime/options-action-items'
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { useChromeStorageValue } from '@/src/ui/shared/hooks/useChromeStorageValue'

export function useOptionsActionItems(): boolean {
  const parse = useMemo(() => parseOptionsActionItems, [])
  const { value } = useChromeStorageValue<OptionsActionItems>({
    areaName: 'session',
    key: SESSION_STORAGE_KEYS.optionsActionItems,
    initialValue: {},
    parse,
  })

  return hasOptionsActionItems(value)
}
