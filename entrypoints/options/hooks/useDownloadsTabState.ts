import { useCallback, useEffect, useState } from 'react'

import logger from '@/src/runtime/logger'
import { normalizePersistedDownloadTask } from '@/src/runtime/persisted-download-task'
import { LOCAL_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import type { DownloadTaskState } from '@/src/types/queue-state'
import { StateAction } from '@/src/types/state-actions'
import { isRecord } from '@/src/shared/type-guards'
import { useChromeStorageValue } from '@/src/ui/shared/hooks/useChromeStorageValue'

export type FsaErrorState = {
  active?: boolean
  message?: string
}

export function normalizeDownloadQueueState(raw: unknown): DownloadTaskState[] {
  return Array.isArray(raw)
    ? raw.map(normalizePersistedDownloadTask).filter((task): task is DownloadTaskState => task !== null)
    : []
}

export function normalizeFsaErrorState(raw: unknown): FsaErrorState | null {
  if (!isRecord(raw)) {
    return null
  }

  return {
    active: raw.active === true,
    message: typeof raw.message === 'string' ? raw.message : undefined,
  }
}

async function readHistoryStorageBytes(): Promise<number> {
  return chrome.storage.local.getBytesInUse(LOCAL_STORAGE_KEYS.downloadQueue)
}

export function useDownloadsTabState() {
  const [historyStorageBytes, setHistoryStorageBytes] = useState(0)
  const { value: tasks, hydrated: tasksHydrated } = useChromeStorageValue<DownloadTaskState[]>({
    areaName: 'local',
    key: LOCAL_STORAGE_KEYS.downloadQueue,
    initialValue: [],
    parse: normalizeDownloadQueueState,
  })
  const { value: fsaError, hydrated: fsaErrorHydrated } = useChromeStorageValue<FsaErrorState | null>({
    areaName: 'local',
    key: LOCAL_STORAGE_KEYS.fsaError,
    initialValue: null,
    parse: normalizeFsaErrorState,
  })

  const refreshHistoryStorageBytes = useCallback(async () => {
    const bytes = await readHistoryStorageBytes()
    setHistoryStorageBytes(bytes)
  }, [])

  useEffect(() => {
    if (!tasksHydrated) {
      return
    }

    void refreshHistoryStorageBytes().catch((error) => {
      logger.debug('[DOWNLOADS TAB] Failed to refresh history storage usage (non-fatal):', error)
    })
  }, [tasks, tasksHydrated, refreshHistoryStorageBytes])

  const isLoading = !tasksHydrated || !fsaErrorHydrated

  const cancelTask = useCallback(async (taskId: string) => {
    try {
      await chrome.runtime.sendMessage({
        type: 'STATE_ACTION',
        action: StateAction.CANCEL_DOWNLOAD_TASK,
        payload: { taskId },
      })
    } catch (error) {
      logger.error('[DOWNLOADS TAB] Failed to cancel task:', error)
    }
  }, [])

  const retryTask = useCallback(async (taskId: string) => {
    try {
      await chrome.runtime.sendMessage({ type: 'RETRY_FAILED_CHAPTERS', payload: { taskId } })
    } catch (error) {
      logger.error('[DOWNLOADS TAB] Failed to retry task:', error)
    }
  }, [])

  const restartTask = useCallback(async (taskId: string) => {
    try {
      await chrome.runtime.sendMessage({ type: 'RESTART_TASK', payload: { taskId } })
    } catch (error) {
      logger.error('[DOWNLOADS TAB] Failed to restart task:', error)
    }
  }, [])

  const removeTask = useCallback(async (taskId: string) => {
    try {
      await chrome.runtime.sendMessage({
        type: 'STATE_ACTION',
        action: StateAction.REMOVE_DOWNLOAD_TASK,
        payload: { taskId },
      })
    } catch (error) {
      logger.error('[DOWNLOADS TAB] Failed to remove task:', error)
    }
  }, [])

  const clearAllHistory = useCallback(async (): Promise<boolean> => {
    try {
      const response: { success?: boolean; error?: string } = await chrome.runtime.sendMessage({
        type: 'CLEAR_ALL_HISTORY',
        payload: {},
      })
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to clear history')
      }
      return true
    } catch (error) {
      logger.error('[DOWNLOADS TAB] Failed to clear history:', error)
      return false
    }
  }, [])

  const dismissFsaBanner = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: 'ACKNOWLEDGE_ERROR',
        payload: { code: 'FSA_HANDLE_INVALID' },
      })
    } catch (error) {
      logger.debug('[DOWNLOADS TAB] Failed to persist FSA banner dismissal (non-fatal):', error)
    }
  }, [])

  return {
    tasks,
    isLoading,
    fsaError,
    historyStorageBytes,
    cancelTask,
    retryTask,
    restartTask,
    removeTask,
    clearAllHistory,
    dismissFsaBanner,
  }
}

