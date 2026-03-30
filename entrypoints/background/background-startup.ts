import logger from '@/src/runtime/logger'
import { initializeSiteIntegrations } from '@/src/runtime/site-integration-initialization'
import { settingsService } from '@/src/storage/settings-service'
import { settingsSyncService } from '@/src/storage/settings-sync-service'
import { createStateManager } from '@/entrypoints/background/state-action-router'
import { initializeFromStorage } from '@/entrypoints/background/initialize-from-storage'
import { processDownloadQueue } from '@/entrypoints/background/download-queue'
import { getOffscreenContexts } from '@/entrypoints/background/offscreen-lifecycle'
import { LOCAL_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { normalizePersistedDownloadTask } from '@/src/runtime/persisted-download-task'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { PendingDownloadsStore } from '@/entrypoints/background/pending-downloads'
import type { DownloadTaskState } from '@/src/types/queue-state'

const PIXIV_REFERER_REWRITE_RULE_ID = 41001

async function readPersistedDownloadQueue(): Promise<DownloadTaskState[]> {
  const result = await chrome.storage.local.get(LOCAL_STORAGE_KEYS.downloadQueue) as Record<string, unknown>
  const queue = result[LOCAL_STORAGE_KEYS.downloadQueue]
  return Array.isArray(queue)
    ? queue.map(normalizePersistedDownloadTask).filter((task): task is DownloadTaskState => task !== null)
    : []
}

async function writePersistedDownloadQueue(queue: DownloadTaskState[]): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_STORAGE_KEYS.downloadQueue]: queue })
}

async function applyRecoveredQueue(
  stateManager: CentralizedStateManager,
  queue: DownloadTaskState[],
): Promise<void> {
  await stateManager.updateGlobalState({ downloadQueue: queue })
}

async function resumeRecoveredQueue(
  stateManager: CentralizedStateManager,
  ensureOffscreenDocumentReady: () => Promise<void>,
): Promise<void> {
  await processDownloadQueue(stateManager, ensureOffscreenDocumentReady)
}

async function initializeSiteIntegrationsSafely(): Promise<void> {
  try {
    await initializeSiteIntegrations()
  } catch (error) {
    logger.warn('Warning during site integration initialization (continuing anyway):', error)
  }
}

async function syncSettingsToState(stateManager: CentralizedStateManager): Promise<void> {
  try {
    const settings = await settingsService.getSettings()
    logger.debug(`[Init] Loading settings - defaultFormat: ${settings.downloads.defaultFormat}`)
    await stateManager.updateGlobalState({ settings })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Failed to sync settings to centralized state:', message)
  }
}

export async function configurePixivImageRefererRewriteRule(): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateSessionRules) {
    logger.debug('declarativeNetRequest API unavailable; skipping Pixiv referer rewrite rule setup')
    return
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [PIXIV_REFERER_REWRITE_RULE_ID],
      addRules: [
        {
          id: PIXIV_REFERER_REWRITE_RULE_ID,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: 'referer',
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: 'https://comic.pixiv.net/',
              },
            ],
          },
          condition: {
            requestDomains: ['img-comic.pximg.net'],
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
              chrome.declarativeNetRequest.ResourceType.OTHER,
            ],
          },
        },
      ],
    })
    logger.debug('Configured Pixiv image referer rewrite session rule')
  } catch (error) {
    logger.warn('Failed to configure Pixiv image referer rewrite rule (non-fatal)', error)
  }
}

export async function initializeBackgroundRuntime(input: {
  pendingDownloadsStore: PendingDownloadsStore
  ensureLivenessAlarm: () => Promise<void>
  ensureOffscreenDocumentReady: () => Promise<void>
}): Promise<CentralizedStateManager> {
  try {
    logger.info('Initializing extension runtime services and state...')

    settingsSyncService.initialize()

    const stateManager = await createStateManager()

    await input.pendingDownloadsStore.hydrate()

    await initializeSiteIntegrationsSafely()

    const startupRecovery = await initializeFromStorage({
      readQueue: readPersistedDownloadQueue,
      writeQueue: writePersistedDownloadQueue,
      writeSession: async (values) => {
        await chrome.storage.session.set(values)
      },
      applyQueue: async (queue) => applyRecoveredQueue(stateManager, queue),
      getOffscreenContexts,
      ensureLivenessAlarm: input.ensureLivenessAlarm,
      resumeQueue: async () => resumeRecoveredQueue(stateManager, input.ensureOffscreenDocumentReady),
    })

    if (startupRecovery.initFailed) {
      throw new Error(startupRecovery.error ?? 'Extension initialization failed')
    }

    await syncSettingsToState(stateManager)

    logger.info('Extension runtime initialized successfully')
    return stateManager
  } catch (error) {
    logger.error('Failed to initialize extension runtime:', error)
    throw error
  }
}

