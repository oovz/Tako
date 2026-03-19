import logger from '@/src/runtime/logger'
import { processDownloadQueue } from '@/entrypoints/background/download-queue'
import { projectToQueueView, updateActionBadge } from '@/entrypoints/background/projection'
import {
  recoverFromLivenessTimeout,
  scheduleOffscreenCloseIfIdle,
} from '@/entrypoints/background/offscreen-lifecycle'
import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { PendingDownloadsStore } from '@/entrypoints/background/pending-downloads'
import type { DownloadTaskState } from '@/src/types/queue-state'

interface RuntimeListenerTabContextCache {
  handleTabRemoved: (tabId: number) => Promise<void>
  handleTabReplaced: (addedTabId: number, removedTabId: number) => Promise<void>
}

interface RegisterBackgroundRuntimeListenersDependencies {
  ensureStateManagerInitialized: () => Promise<void>
  isStateManagerReady: () => boolean
  getStateManager: () => CentralizedStateManager
  pendingDownloadsStore: PendingDownloadsStore
  requestBlobRevocation: (blobUrl: string) => Promise<void>
  tabContextCache: RuntimeListenerTabContextCache
  ensureOffscreenDocumentReady: () => Promise<void>
  livenessAlarmName: string
}

export function registerBackgroundRuntimeListeners(
  deps: RegisterBackgroundRuntimeListenersDependencies,
): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    void deps.ensureStateManagerInitialized()
      .then(async () => {
        if (areaName !== 'session') {
          return
        }

        const globalStateChange = changes.global_state
        if (!globalStateChange?.newValue || typeof globalStateChange.newValue !== 'object') {
          return
        }

        const maybeQueue = (globalStateChange.newValue as { downloadQueue?: unknown }).downloadQueue
        if (!Array.isArray(maybeQueue)) {
          return
        }

        try {
          const projection = projectToQueueView(maybeQueue as DownloadTaskState[])
          await chrome.storage.session.set({ [SESSION_STORAGE_KEYS.queueView]: projection.queueView })
          await updateActionBadge(projection.nonTerminalCount)
        } catch (error) {
          logger.debug('Failed to sync queue projection from storage change (non-fatal):', error)
        }
      })
      .catch((error) => {
        logger.error('Failed to process storage change with initialized state:', error)
      })
  })

  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    void (async () => {
      try {
        await deps.ensureStateManagerInitialized()
        await deps.tabContextCache.handleTabReplaced(addedTabId, removedTabId)
      } catch (error) {
        logger.error('Failed to handle tab replacement for active context cache:', error)
      }
    })()
  })

  chrome.downloads.onChanged.addListener((delta) => {
    void deps.ensureStateManagerInitialized()
      .then(() => {
        if (typeof delta.id !== 'number') {
          return
        }

        const downloadState = delta.state?.current
        if (!downloadState || downloadState === 'in_progress') {
          return
        }

        const blobUrl = deps.pendingDownloadsStore.get(delta.id)
        if (!blobUrl) {
          logger.debug(`Download ${delta.id} not tracked - likely from canceled/timed-out task`)
          return
        }

        deps.pendingDownloadsStore.remove(delta.id)
        void deps.requestBlobRevocation(blobUrl)
      })
      .catch((error) => {
        logger.error('Failed to process downloads.onChanged with initialized state:', error)
      })
  })

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== deps.livenessAlarmName) {
      return
    }

    void deps.ensureStateManagerInitialized()
      .then(() => recoverFromLivenessTimeout(deps.getStateManager(), deps.pendingDownloadsStore, async () => {
        await processDownloadQueue(deps.getStateManager(), deps.ensureOffscreenDocumentReady)
      }))
      .catch((error) => {
        logger.error('Error handling liveness alarm recovery:', error)
      })
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      try {
        await deps.ensureStateManagerInitialized()
        await deps.getStateManager().clearTabState(tabId)
        await deps.tabContextCache.handleTabRemoved(tabId)
      } catch (error) {
        logger.error(`Error clearing state for removed tab ${tabId}:`, error)
      }
    })()
  })

  chrome.runtime.onSuspend.addListener(() => {
    logger.info('Service worker suspending - cleaning up resources')
    try {
      if (deps.isStateManagerReady()) {
        void (async () => {
          await deps.ensureStateManagerInitialized()
          try {
            await scheduleOffscreenCloseIfIdle(deps.getStateManager(), deps.pendingDownloadsStore)
          } catch (error) {
            logger.debug('Failed to schedule offscreen close on suspend:', error)
          }
        })()
      }

      logger.debug('Service worker cleanup complete')
    } catch (error) {
      logger.error('Error during service worker cleanup:', error)
    }
  })
}

