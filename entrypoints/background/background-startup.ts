import logger from '@/src/runtime/logger'
import { initializeSiteIntegrations } from '@/src/runtime/site-integration-initialization'
import { settingsService } from '@/src/storage/settings-service'
import { settingsSyncService } from '@/src/storage/settings-sync-service'
import { createStateManager } from '@/entrypoints/background/state-manager'
import { initializeFromStorage } from '@/entrypoints/background/initialize-from-storage'
import { processDownloadQueue } from '@/entrypoints/background/download-queue'
import { LOCAL_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { PendingDownloadsStore } from '@/entrypoints/background/pending-downloads'
import type { DownloadTaskState } from '@/src/types/queue-state'

const PIXIV_REFERER_REWRITE_RULE_ID = 41001

type RuntimeGetContexts = (params: {
  contextTypes: Array<'OFFSCREEN_DOCUMENT'>
  documentUrls: string[]
}) => Promise<unknown[]>

export async function getOffscreenContexts(): Promise<unknown[]> {
  try {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html')
    const runtimeWithGetContexts = chrome.runtime as unknown as { getContexts?: RuntimeGetContexts }
    if (!runtimeWithGetContexts.getContexts) {
      return []
    }

    return await runtimeWithGetContexts.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    })
  } catch (error) {
    logger.debug('Failed to query offscreen contexts during startup recovery (non-fatal):', error)
    return []
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

    try {
      await initializeSiteIntegrations()
    } catch (error) {
      logger.warn('Warning during site integration initialization (continuing anyway):', error)
    }

    const startupRecovery = await initializeFromStorage({
      readQueue: async () => {
        const result = await chrome.storage.local.get(LOCAL_STORAGE_KEYS.downloadQueue) as Record<string, unknown>
        const queue = result[LOCAL_STORAGE_KEYS.downloadQueue]
        return Array.isArray(queue) ? queue as DownloadTaskState[] : []
      },
      writeQueue: async (queue) => {
        await chrome.storage.local.set({ [LOCAL_STORAGE_KEYS.downloadQueue]: queue })
      },
      writeSession: async (values) => {
        await chrome.storage.session.set(values)
      },
      applyQueue: async (queue) => {
        await stateManager.updateGlobalState({ downloadQueue: queue })
      },
      getOffscreenContexts,
      ensureLivenessAlarm: input.ensureLivenessAlarm,
      resumeQueue: async () => {
        await processDownloadQueue(stateManager, input.ensureOffscreenDocumentReady)
      },
    })

    if (startupRecovery.initFailed) {
      throw new Error(startupRecovery.error ?? 'Extension initialization failed')
    }

    try {
      const settings = await settingsService.getSettings()
      logger.debug(`[Init] Loading settings - defaultFormat: ${settings.downloads.defaultFormat}`)
      await stateManager.updateGlobalState({ settings })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Failed to sync settings to centralized state:', message)
    }

    logger.info('Extension runtime initialized successfully')
    return stateManager
  } catch (error) {
    logger.error('Failed to initialize extension runtime:', error)
    throw error
  }
}

