import { useCallback, useEffect, useState } from 'react'

import { toast } from 'sonner'

import logger from '@/src/runtime/logger'
import { normalizePersistedDownloadTask } from '@/src/runtime/persisted-download-task'
import { LOCAL_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import type { DownloadTaskState } from '@/src/types/queue-state'
import { StateAction } from '@/src/types/state-actions'
import type {
  RestartTaskMessage,
  RestartTaskResponse,
  RetryFailedChaptersMessage,
  RetryFailedChaptersResponse,
} from '@/src/types/runtime-command-messages'
import type { StateActionMessage, StateActionResponse } from '@/src/types/state-action-message'
import { isRecord } from '@/src/shared/type-guards'
import { useChromeStorageValue } from '@/src/ui/shared/hooks/useChromeStorageValue'
import { t } from '@/src/runtime/i18n'

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
      const response = await chrome.runtime.sendMessage<StateActionMessage, StateActionResponse>({
        type: 'STATE_ACTION',
        action: StateAction.CANCEL_DOWNLOAD_TASK,
        payload: { taskId },
      })
      if (!response || response.success === false) {
        toast.error(response?.error || t('options_toastCancelFailed'))
      }
    } catch (error) {
      logger.error('[DOWNLOADS TAB] Failed to cancel task:', error)
      toast.error(t('options_toastCancelFailed'))
    }
  }, [])

  const retryTask = useCallback(async (taskId: string) => {
    try {
      const response = await chrome.runtime.sendMessage<RetryFailedChaptersMessage, RetryFailedChaptersResponse>({
        type: 'RETRY_FAILED_CHAPTERS',
        payload: { taskId },
      })
      if (!response || response.success === false) {
        toast.error(response?.error || t('options_toastRetryFailed'))
      }
    } catch (error) {
      logger.error('[DOWNLOADS TAB] Failed to retry task:', error)
      toast.error(t('options_toastRetryFailed'))
    }
  }, [])

  const restartTask = useCallback(async (taskId: string) => {
    try {
      const response = await chrome.runtime.sendMessage<RestartTaskMessage, RestartTaskResponse>({
        type: 'RESTART_TASK',
        payload: { taskId },
      })
      if (!response || response.success === false) {
        toast.error(response?.error || t('options_toastRestartFailed'))
      }
    } catch (error) {
      logger.error('[DOWNLOADS TAB] Failed to restart task:', error)
      toast.error(t('options_toastRestartFailed'))
    }
  }, [])

  const removeTask = useCallback(async (taskId: string) => {
    try {
      const response = await chrome.runtime.sendMessage<StateActionMessage, StateActionResponse>({
        type: 'STATE_ACTION',
        action: StateAction.REMOVE_DOWNLOAD_TASK,
        payload: { taskId },
      })
      if (!response || response.success === false) {
        toast.error(response?.error || t('options_toastRemoveFailed'))
      }
    } catch (error) {
      logger.error('[DOWNLOADS TAB] Failed to remove task:', error)
      toast.error(t('options_toastRemoveFailed'))
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

