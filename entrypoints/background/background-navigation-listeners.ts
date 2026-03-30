import logger from '@/src/runtime/logger'
import { matchUrl } from '@/src/site-integrations/url-matcher'
import { resolveSpaNavigationAction } from '@/entrypoints/background/spa-navigation'
import { isInternalUrl } from '@/entrypoints/background/tab-ui-coordinator'
import { isMangaPageState } from '@/src/runtime/state-shapes'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'

interface NavigationListenerTabUiCoordinator {
  ensureContentScriptPresent: (tabId: number, url: string | null | undefined, options?: { force?: boolean }) => Promise<void>
  updateActionForTab: (tabId: number, url?: string | null) => Promise<void>
  updateSidePanelForTab: (tabId: number) => Promise<void>
}

interface NavigationListenerTabContextCache {
  handleTabActivated: (tabId: number) => Promise<void>
  handleTabUpdated: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => Promise<void>
  setCachedContext: (tabId: number, value: null) => void
  deleteCachedContext: (tabId: number) => void
  syncActiveTabContext: () => Promise<void>
}

interface RegisterBackgroundNavigationListenersDependencies {
  ensureStateManagerInitialized: () => Promise<void>
  getStateManager: () => CentralizedStateManager
  tabContextCache: NavigationListenerTabContextCache
  tabUiCoordinator: NavigationListenerTabUiCoordinator
}

export function registerBackgroundNavigationListeners(
  deps: RegisterBackgroundNavigationListenersDependencies,
): void {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
      void (async () => {
        await deps.ensureStateManagerInitialized()
        await deps.tabContextCache.handleTabUpdated(tabId, changeInfo)
        const url = changeInfo.url ?? tab.url ?? null
        void deps.tabUiCoordinator.updateActionForTab(tabId, url)
        void deps.tabUiCoordinator.updateSidePanelForTab(tabId)

        if (url && !isInternalUrl(url) && !matchUrl(url)) {
          try {
            deps.tabContextCache.setCachedContext(tabId, null)
            await deps.getStateManager().clearTabState(tabId)
            deps.tabContextCache.deleteCachedContext(tabId)
            await chrome.storage.session.remove(`seriesContextError_${tabId}`)
            logger.info(`background: onUpdated unsupported URL detected, clearing tab state for tab ${tabId}`)
          } catch (error) {
            logger.debug('onUpdated navigation state cleanup failed (non-fatal):', error)
          }
        }
      })()
    }
  })

  try {
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.tabId >= 0 && details.frameId === 0) {
        void (async () => {
          await deps.ensureStateManagerInitialized()
          const resolvedUrl = details.url ?? (await chrome.tabs.get(details.tabId)).url ?? ''
          if (isInternalUrl(resolvedUrl)) {
            return
          }

          void deps.tabUiCoordinator.updateActionForTab(details.tabId, resolvedUrl)
          void deps.tabUiCoordinator.updateSidePanelForTab(details.tabId)

          const isUrlSupported = !!matchUrl(resolvedUrl)
          if (!isUrlSupported) {
            try {
              const storageKey = `tab_${details.tabId}`
              const existing = await chrome.storage.session.get(storageKey)
              if (isMangaPageState(existing[storageKey])) {
                logger.info(`background: unsupported URL detected, clearing tab state for tab ${details.tabId}`)
                deps.tabContextCache.setCachedContext(details.tabId, null)
                await deps.getStateManager().clearTabState(details.tabId)
                deps.tabContextCache.deleteCachedContext(details.tabId)
                await chrome.storage.session.remove(`seriesContextError_${details.tabId}`)
              }
            } catch (error) {
              logger.debug('Navigation state cleanup failed (non-fatal):', error)
            }
          }
        })().catch((error) => logger.debug('webNavigation.onCommitted handler failed (non-fatal):', error))
      }
    })
  } catch (error) {
    logger.debug('webNavigation.onCommitted not available', error)
  }

  try {
    chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
      if (details.tabId >= 0 && details.frameId === 0) {
        (async () => {
          await deps.ensureStateManagerInitialized()
          const url = details.url ?? (await chrome.tabs.get(details.tabId)).url ?? ''
          if (isInternalUrl(url)) {
            return
          }

          void deps.tabUiCoordinator.updateActionForTab(details.tabId, url)
          void deps.tabUiCoordinator.updateSidePanelForTab(details.tabId)

          const isUrlSupported = !!matchUrl(url)
          const storageKey = `tab_${details.tabId}`

          try {
            const existing = await chrome.storage.session.get(storageKey)
            const navigationAction = resolveSpaNavigationAction({
              isUrlSupported,
              hasExistingTabState: isMangaPageState(existing[storageKey]),
            })

            if (navigationAction === 'clear-tab-state') {
              logger.info(`background: SPA navigation to unsupported URL detected, clearing tab state for tab ${details.tabId}`)
              deps.tabContextCache.setCachedContext(details.tabId, null)
              await deps.getStateManager().clearTabState(details.tabId)
              deps.tabContextCache.deleteCachedContext(details.tabId)
              await chrome.storage.session.remove(`seriesContextError_${details.tabId}`)
            }
          } catch (error) {
            logger.debug('SPA navigation state cleanup failed (non-fatal):', error)
          }
        })().catch((error) => logger.debug('onHistoryStateUpdated handler failed (non-fatal):', error))
      }
    })
  } catch (error) {
    logger.debug('webNavigation.onHistoryStateUpdated not available', error)
  }

  chrome.tabs.onActivated.addListener((activeInfo) => {
    void (async () => {
      try {
        await deps.ensureStateManagerInitialized()
        await deps.tabContextCache.handleTabActivated(activeInfo.tabId)
        const tab = await chrome.tabs.get(activeInfo.tabId)
        await deps.tabUiCoordinator.updateActionForTab(activeInfo.tabId, tab?.url || null)
        await deps.tabUiCoordinator.updateSidePanelForTab(activeInfo.tabId)
        void deps.tabUiCoordinator.ensureContentScriptPresent(activeInfo.tabId, tab?.url || null)
      } catch {
        await deps.tabUiCoordinator.updateActionForTab(activeInfo.tabId, null)
        await deps.tabUiCoordinator.updateSidePanelForTab(activeInfo.tabId)
      }
    })()
  })

  chrome.tabs.query({})
    .then((tabs) => {
      for (const tab of tabs) {
        if (typeof tab.id === 'number') {
          void deps.tabUiCoordinator.updateActionForTab(tab.id, tab.url || null)
          void deps.tabUiCoordinator.updateSidePanelForTab(tab.id)
          void deps.tabUiCoordinator.ensureContentScriptPresent(tab.id, tab.url || null)
        }
      }
    })
    .catch(() => {})
}

