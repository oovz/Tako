import logger from '@/src/runtime/logger'
import { settingsService } from '@/src/storage/settings-service'
import { clearPersistentError } from '@/entrypoints/background/errors'
import {
  enqueueStartDownloadTask,
  processDownloadQueue,
  retryFailedChapters,
  restartTask,
  moveTaskToTop,
  clearAllHistory,
} from '@/entrypoints/background/download-queue'
import { processStateAction } from '@/entrypoints/background/state-manager'
import { handleOffscreenDownloadProgress } from '@/entrypoints/background/offscreen-progress-handler'
import { LOCAL_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import {
  resolveGetTabIdResponse,
  resolveSourceTabId,
  isSenderFromOptionsPage,
} from '@/entrypoints/background/sender-resolution'
import { StateAction } from '@/src/types/state-actions'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { PendingDownloadsStore } from '@/entrypoints/background/pending-downloads'
import type {
  ExtensionMessage,
  ExtensionMessageResponse,
} from '@/src/types/extension-messages'
import type { StartDownloadResponse } from '@/src/types/runtime-command-messages'
import type { StateActionMessage, StateActionResponse } from '@/src/types/state-action-message'

export const offscreenOnlyMessages = [
  'OFFSCREEN_STATUS',
  'OFFSCREEN_CONTROL',
  'REVOKE_BLOB_URL',
  'OFFSCREEN_DOWNLOAD_CHAPTER',
] as const satisfies ReadonlyArray<ExtensionMessage['type']>

export const backgroundHandledMessages = new Set<ExtensionMessage['type']>([
  'GET_TAB_ID',
  'STATE_ACTION',
  'ACKNOWLEDGE_ERROR',
  'GET_SETTINGS',
  'SYNC_SETTINGS_TO_STATE',
  'OFFSCREEN_DOWNLOAD_API_REQUEST',
  'RETRY_FAILED_CHAPTERS',
  'RESTART_TASK',
  'MOVE_TASK_TO_TOP',
  'CLEAR_ALL_HISTORY',
  'OPEN_OPTIONS',
  'START_DOWNLOAD',
  'OFFSCREEN_DOWNLOAD_PROGRESS',
])

interface BackgroundMessageRouterDependencies {
  ensureStateManagerInitialized: () => Promise<void>
  getStateManager: () => CentralizedStateManager
  ensureOffscreenDocumentReady: () => Promise<void>
  pendingDownloadsStore: PendingDownloadsStore
  requestBlobRevocation: (blobUrl: string) => Promise<void>
}

async function handleStateAction(
  message: StateActionMessage,
  sender: chrome.runtime.MessageSender | undefined,
  deps: BackgroundMessageRouterDependencies,
): Promise<StateActionResponse> {
  try {
    await deps.ensureStateManagerInitialized()
    const stateManager = deps.getStateManager()
    const result = await processStateAction(stateManager, message, sender)

    if (result.success && message.action === StateAction.CANCEL_DOWNLOAD_TASK) {
      logger.info('Task canceled, processing queue immediately')
      await processDownloadQueue(stateManager, deps.ensureOffscreenDocumentReady)
    }

    if (result.success) {
      return { success: true, data: result.data }
    }

    return { success: false, error: result.error || 'Unknown error' }
  } catch (error) {
    logger.error('Error in handleStateAction:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: errorMessage }
  }
}

export async function handleBackgroundMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  deps: BackgroundMessageRouterDependencies,
): Promise<ExtensionMessageResponse | null> {
  const { type } = message
  logger.debug('[background-message-router] Received message', {
    type,
    senderUrl: sender.url,
    senderTabId: sender.tab?.id,
  })

  try {
    switch (type) {
      case 'GET_TAB_ID': {
        return resolveGetTabIdResponse(sender)
      }
      case 'STATE_ACTION': {
        if (!Object.prototype.hasOwnProperty.call(message, 'action')) {
          return { success: false, error: 'Invalid STATE_ACTION message shape' }
        }
        if (typeof message.action !== 'number') {
          return { success: false, error: 'STATE_ACTION.action must be a StateAction enum value' }
        }
        return await handleStateAction(message, sender, deps)
      }
      case 'ACKNOWLEDGE_ERROR': {
        try {
          const code = message.payload?.code
          if (code) {
            if (code === 'FSA_HANDLE_INVALID') {
              const current = await chrome.storage.local.get(LOCAL_STORAGE_KEYS.fsaError)
              const raw = current[LOCAL_STORAGE_KEYS.fsaError] as { active?: boolean; message?: string } | undefined
              if (raw && typeof raw === 'object') {
                await chrome.storage.local.set({
                  [LOCAL_STORAGE_KEYS.fsaError]: {
                    ...raw,
                    active: false,
                  },
                })
              }
            }
            await clearPersistentError(code)
          }
        } catch (e) {
          logger.debug('ACKNOWLEDGE_ERROR failed (non-fatal)', e)
          return { success: false, error: 'Failed to acknowledge error' }
        }
        return { success: true }
      }
      case 'GET_SETTINGS': {
        try {
          const settings = await settingsService.getSettings()
          return { success: true, ...settings }
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : 'Failed to load settings'
          return { success: false, error: message }
        }
      }
      case 'SYNC_SETTINGS_TO_STATE': {
        try {
          await deps.ensureStateManagerInitialized()
          const current = await settingsService.getSettings()
          const patch = message.payload.settings
          const merged = patch ? {
            ...current,
            downloads: { ...current.downloads, ...patch.downloads },
            globalPolicy: patch.globalPolicy ? {
              image: { ...current.globalPolicy.image, ...patch.globalPolicy.image },
              chapter: { ...current.globalPolicy.chapter, ...patch.globalPolicy.chapter },
            } : current.globalPolicy,
            globalRetries: patch.globalRetries
              ? { ...current.globalRetries, ...patch.globalRetries }
              : current.globalRetries,
            notifications: typeof patch.notifications === 'boolean' ? patch.notifications : current.notifications,
            advanced: patch.advanced ? { ...current.advanced, ...patch.advanced } : current.advanced,
          } : current

          await deps.getStateManager().updateGlobalState({ settings: merged })
          return { success: true }
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : 'Failed to sync settings to state'
          return { success: false, error: message }
        }
      }
      case 'OFFSCREEN_DOWNLOAD_API_REQUEST': {
        try {
          const { payload } = message
          const taskId = typeof payload.taskId === 'string' ? payload.taskId : ''
          const chapterId = typeof payload.chapterId === 'string' ? payload.chapterId : ''
          const fileUrl = typeof payload.fileUrl === 'string' ? payload.fileUrl : ''
          const filename = typeof payload.filename === 'string' ? payload.filename : ''

          if (!taskId || !chapterId || !fileUrl || !filename) {
            return { success: false, error: 'Invalid OFFSCREEN_DOWNLOAD_API_REQUEST payload' }
          }

          logger.debug('[background-message-router] Processing OFFSCREEN_DOWNLOAD_API_REQUEST', {
            taskId,
            chapterId,
            filename,
          })

          await deps.ensureStateManagerInitialized()

          const settings = await settingsService.getSettings()
          const conflictAction = settings.downloads.overwriteExisting ? 'overwrite' : 'uniquify'
          const downloadId = await chrome.downloads.download({
            url: fileUrl,
            filename,
            conflictAction,
            saveAs: false,
          })

          if (typeof downloadId !== 'number') {
            await deps.requestBlobRevocation(fileUrl)
            return { success: false, error: 'downloads.download returned no download id' }
          }

          deps.pendingDownloadsStore.set(downloadId, fileUrl)
          await deps.getStateManager().updateDownloadTask(taskId, { lastSuccessfulDownloadId: downloadId })
          return { success: true, id: downloadId }
        } catch (error) {
          const fileUrl = typeof message.payload?.fileUrl === 'string' ? message.payload.fileUrl : ''
          if (fileUrl) {
            await deps.requestBlobRevocation(fileUrl)
          }

          const errorMessage = error instanceof Error ? error.message : 'downloads.download failed'
          logger.error('OFFSCREEN_DOWNLOAD_API_REQUEST failed:', error)
          return { success: false, error: errorMessage }
        }
      }
      case 'RETRY_FAILED_CHAPTERS': {
        await deps.ensureStateManagerInitialized()
        const taskId = message.payload?.taskId
        if (!taskId) {
          return { success: false, error: 'Missing taskId' }
        }

        try {
          const result = await retryFailedChapters(deps.getStateManager(), taskId)
          if (!result.success) {
            return { success: false, error: result.reason || 'Retry failed' }
          }

          await processDownloadQueue(deps.getStateManager(), deps.ensureOffscreenDocumentReady)
          return { success: true }
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : 'Retry failed'
          logger.error('Error handling RETRY_FAILED_CHAPTERS:', e)
          return { success: false, error: errorMessage }
        }
      }
      case 'RESTART_TASK': {
        await deps.ensureStateManagerInitialized()
        const taskId = message.payload?.taskId
        if (!taskId) {
          return { success: false, error: 'Missing taskId' }
        }

        try {
          const result = await restartTask(deps.getStateManager(), taskId)
          if (!result.success) {
            return { success: false, error: result.reason || 'Restart failed' }
          }

          await processDownloadQueue(deps.getStateManager(), deps.ensureOffscreenDocumentReady)
          return { success: true }
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : 'Restart failed'
          logger.error('Error handling RESTART_TASK:', e)
          return { success: false, error: errorMessage }
        }
      }
      case 'MOVE_TASK_TO_TOP': {
        await deps.ensureStateManagerInitialized()
        const taskId = message.payload?.taskId
        if (!taskId) {
          return { success: false, error: 'Missing taskId' }
        }

        try {
          const result = await moveTaskToTop(deps.getStateManager(), taskId)
          if (!result.success) {
            return { success: false, error: result.reason || 'Unable to move task to top' }
          }
          return { success: true }
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : 'Unable to move task to top'
          logger.error('Error handling MOVE_TASK_TO_TOP:', e)
          return { success: false, error: errorMessage }
        }
      }
      case 'CLEAR_ALL_HISTORY': {
        const optionsUrlPrefix = chrome.runtime.getURL('options.html')
        if (!isSenderFromOptionsPage(sender, optionsUrlPrefix)) {
          return { success: false, error: 'CLEAR_ALL_HISTORY is only available from Options page' }
        }

        await deps.ensureStateManagerInitialized()
        try {
          const result = await clearAllHistory(deps.getStateManager())
          return { success: true, removedCount: result.removedCount }
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : 'Unable to clear history'
          logger.error('Error handling CLEAR_ALL_HISTORY:', e)
          return { success: false, error: errorMessage }
        }
      }
      case 'OPEN_OPTIONS': {
        const page = message.payload?.page
        const tabParam = page ? `?tab=${encodeURIComponent(page)}` : ''
        const url = chrome.runtime.getURL(`options.html${tabParam}`)

        try {
          const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('options.html*') })
          const existing = tabs[0]
          if (typeof existing?.id === 'number') {
            await chrome.tabs.update(existing.id, { active: true, url })
            if (typeof existing.windowId === 'number') {
              await chrome.windows.update(existing.windowId, { focused: true })
            }
          } else {
            await chrome.tabs.create({ url, active: true })
          }

          return { success: true }
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : 'Failed to open options page'
          logger.error('Error handling OPEN_OPTIONS:', e)
          return { success: false, error: errorMessage }
        }
      }
      case 'START_DOWNLOAD': {
        await deps.ensureStateManagerInitialized()
        const sourceTabId = resolveSourceTabId(
          sender,
          typeof message.payload?.sourceTabId === 'number'
            ? message.payload.sourceTabId
            : undefined,
        )

        if (typeof sourceTabId !== 'number') {
          return { success: false, error: 'Unable to resolve sender tab for START_DOWNLOAD' }
        }

        const result = await enqueueStartDownloadTask(
          deps.getStateManager(),
          message.payload,
          sourceTabId,
        )

        if (!result.success || !result.taskId) {
          return { success: false, error: result.reason || 'Failed to enqueue download task' }
        }

        void processDownloadQueue(deps.getStateManager(), deps.ensureOffscreenDocumentReady).catch((error) => {
          logger.error('Failed to process download queue after START_DOWNLOAD:', error)
        })

        return { success: true, taskId: result.taskId } as StartDownloadResponse
      }
      case 'OFFSCREEN_DOWNLOAD_PROGRESS': {
        await deps.ensureStateManagerInitialized()
        return await handleOffscreenDownloadProgress(deps.getStateManager(), message)
      }
      default:
        logger.debug(`Background ignoring message type: ${type}`)
        return null
    }
  } catch (error) {
    logger.error(`Error handling message ${type}:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: errorMessage } as StateActionResponse
  }
}

