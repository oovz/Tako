import { useCallback, useState } from 'react'

import { toast } from 'sonner'

import { cancelDownloadTask, sendStateAction } from '@/src/runtime/centralized-state'
import logger from '@/src/runtime/logger'
import { openOptionsPage } from '@/src/runtime/open-options'
import { StateAction } from '@/src/types/state-actions'
import type {
  MoveTaskToTopMessage,
  MoveTaskToTopResponse,
  RestartTaskMessage,
  RestartTaskResponse,
  RetryFailedChaptersMessage,
  RetryFailedChaptersResponse,
} from '@/src/types/runtime-command-messages'

export function useCommandCenterActions() {
  const [cancelingTaskIds, setCancelingTaskIds] = useState<Set<string>>(new Set())

  const handleCancelTask = useCallback(async (taskId: string) => {
    setCancelingTaskIds((previousIds) => {
      const nextIds = new Set(previousIds)
      nextIds.add(taskId)
      return nextIds
    })

    try {
      await cancelDownloadTask(taskId)
    } catch (error) {
      logger.error('[CommandCenter] Failed to cancel task:', error)
    } finally {
      setCancelingTaskIds((previousIds) => {
        if (!previousIds.has(taskId)) {
          return previousIds
        }

        const nextIds = new Set(previousIds)
        nextIds.delete(taskId)
        return nextIds
      })
    }
  }, [])

  const handleRetryFailed = useCallback(async (taskId: string) => {
    try {
      const response = await chrome.runtime.sendMessage<RetryFailedChaptersMessage, RetryFailedChaptersResponse>({
        type: 'RETRY_FAILED_CHAPTERS',
        payload: { taskId },
      })

      if (!response || response.success === false) {
        toast.error(response?.error || 'Failed to retry failed chapters')
      }
    } catch (error) {
      logger.error('[CommandCenter] Failed to retry failed chapters:', error)
      toast.error('Failed to retry failed chapters')
    }
  }, [])

  const handleRemoveTask = useCallback(async (taskId: string) => {
    try {
      await sendStateAction(StateAction.REMOVE_DOWNLOAD_TASK, { taskId })
    } catch (error) {
      logger.error('[CommandCenter] Failed to remove task:', error)
    }
  }, [])

  const handleRestartTask = useCallback(async (taskId: string) => {
    try {
      const response = await chrome.runtime.sendMessage<RestartTaskMessage, RestartTaskResponse>({
        type: 'RESTART_TASK',
        payload: { taskId },
      })

      if (!response || response.success === false) {
        toast.error(response?.error || 'Failed to restart task')
      }
    } catch (error) {
      logger.error('[CommandCenter] Failed to restart task:', error)
      toast.error('Failed to restart task')
    }
  }, [])

  const handleMoveTaskToTop = useCallback(async (taskId: string) => {
    try {
      const response = await chrome.runtime.sendMessage<MoveTaskToTopMessage, MoveTaskToTopResponse>({
        type: 'MOVE_TASK_TO_TOP',
        payload: { taskId },
      })

      if (!response || response.success === false) {
        toast.error(response?.error || 'Failed to move task to top')
      }
    } catch (error) {
      logger.error('[CommandCenter] Failed to move task to top:', error)
      toast.error('Failed to move task to top')
    }
  }, [])

  const openSettings = useCallback(async () => {
    try {
      await openOptionsPage()
    } catch (error) {
      logger.error('[CommandCenter] Failed to open Options page:', error)
    }
  }, [])

  const openFullHistory = useCallback(async () => {
    try {
      await openOptionsPage('downloads')
    } catch (error) {
      logger.error('[CommandCenter] Failed to open full history:', error)
    }
  }, [])

  return {
    cancelingTaskIds,
    handleCancelTask,
    handleRetryFailed,
    handleRemoveTask,
    handleRestartTask,
    handleMoveTaskToTop,
    openSettings,
    openFullHistory,
  }
}

