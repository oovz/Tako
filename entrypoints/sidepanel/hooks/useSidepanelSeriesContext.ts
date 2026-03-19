import { useState, useEffect } from 'react'

import type { FormatDisplay, VolumeOrChapter } from '../types'
import { useSidepanelDefaultFormat } from '@/entrypoints/sidepanel/hooks/useSidepanelDefaultFormat'
import {
  isInternalUrl,
  queryActiveTabInLastFocusedNormalWindow,
  resolveTabUrlForSupportCheck,
} from '@/entrypoints/sidepanel/hooks/sidepanelActiveTabHelpers'
import { useSidepanelTrackedTabId } from '@/entrypoints/sidepanel/hooks/useSidepanelTrackedTabId'
import { useStorageSubscription } from '@/entrypoints/sidepanel/hooks/useStorageSubscription'
import {
  deriveSeriesContextFromActiveTabContext,
  groupChapters,
  normalizeActiveTabContext,
  selectPreferredSeriesContextTask,
  type ActiveTabContextValue,
} from '@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers'
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import logger from '@/src/runtime/logger'
import type { DownloadTaskState } from '@/src/types/queue-state'
import type { MangaPageState } from '@/src/types/tab-state'

export { groupChapters, isInternalUrl, queryActiveTabInLastFocusedNormalWindow }

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

export function __resolveTabUrlForSupportCheckForTests(
  tab: Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'> | undefined,
): string {
  return resolveTabUrlForSupportCheck(tab)
}

export function __selectPreferredSeriesContextTaskForTests(
  tasks: DownloadTaskState[],
): DownloadTaskState | undefined {
  return selectPreferredSeriesContextTask(tasks)
}

export function __deriveSeriesContextFromActiveTabContextForTests(
  context: ActiveTabContextValue,
  defaultFormat: FormatDisplay,
): Omit<SidepanelSeriesContextData, 'tabId'> {
  return deriveSeriesContextFromActiveTabContext(context, defaultFormat)
}

export function useSidepanelSeriesContext(): SidepanelSeriesContextData {
  const defaultFormat = useSidepanelDefaultFormat()
  const tabId = useSidepanelTrackedTabId()
  const { value: activeTabContext } = useStorageSubscription<ActiveTabContextValue>({
    areaName: 'session',
    key: SESSION_STORAGE_KEYS.activeTabContext,
    initialValue: { loading: true },
    parse: normalizeActiveTabContext,
  })

  const [data, setData] = useState<Omit<SidepanelSeriesContextData, 'tabId'>>({
    mangaState: undefined,
    items: [],
    mangaTitle: 'Loading...',
    seriesId: undefined,
    isLoading: true,
    blockingMessage: undefined,
    siteId: undefined,
    author: undefined,
    coverUrl: undefined,
    defaultFormat,
  })

  useEffect(() => {
    logger.debug('[sidepanel] Initializing series-context hook')
    return () => {
      logger.debug('[sidepanel] Disposing series-context hook')
    }
  }, [])

  useEffect(() => {
    logger.debug('[sidepanel] Deriving series context from activeTabContext', {
      tabId,
      defaultFormat,
      activeTabContext,
    })
    setData((prev) => ({
      ...deriveSeriesContextFromActiveTabContext(activeTabContext, defaultFormat, prev.items),
    }))
  }, [activeTabContext, defaultFormat, tabId])

  return {
    tabId,
    ...data,
  }
}
export default useSidepanelSeriesContext;


