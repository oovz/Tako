import { useCallback, useMemo } from 'react'

import type { FormatDisplay, VolumeOrChapter } from '../types'
import { useSidepanelDefaultFormat } from '@/entrypoints/sidepanel/hooks/useSidepanelDefaultFormat'
import { useSidepanelTrackedTabId } from '@/entrypoints/sidepanel/hooks/useSidepanelTrackedTabId'
import {
  deriveSeriesContextFromActiveTabContext,
  normalizeStoredSeriesContext,
  type ActiveTabContextValue,
} from '@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers'
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import type { MangaPageState } from '@/src/types/tab-state'
import { useChromeStorageValue } from '@/src/ui/shared/hooks/useChromeStorageValue'

export interface SidepanelSeriesContextData {
  tabId: number | undefined
  mangaState?: MangaPageState
  items: VolumeOrChapter[]
  mangaTitle: string
  seriesId?: string
  isLoading: boolean
  blockingMessage: string | undefined
  siteId: string | undefined
  author?: string
  coverUrl?: string
  defaultFormat: FormatDisplay
}

export function useSidepanelSeriesContext(): SidepanelSeriesContextData {
  const defaultFormat = useSidepanelDefaultFormat()
  const tabId = useSidepanelTrackedTabId()
  const storageKeys = useMemo(
    () => (
      typeof tabId === 'number'
        ? [`tab_${tabId}`, `seriesContextError_${tabId}`, SESSION_STORAGE_KEYS.activeTabContext]
        : [SESSION_STORAGE_KEYS.activeTabContext]
    ),
    [tabId],
  )
  const parseStoredContext = useCallback(
    (value: unknown) => normalizeStoredSeriesContext(value, tabId),
    [tabId],
  )
  const { value: activeTabContext } = useChromeStorageValue<ActiveTabContextValue>({
    areaName: 'session',
    key: storageKeys,
    initialValue: { kind: 'unsupported' },
    parse: parseStoredContext,
  })

  const data = useMemo(
    () => deriveSeriesContextFromActiveTabContext(activeTabContext, defaultFormat),
    [activeTabContext, defaultFormat],
  )

  return {
    tabId,
    ...data,
  }
}


