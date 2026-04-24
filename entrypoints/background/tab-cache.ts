import { SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { matchUrl } from '@/src/site-integrations/url-matcher'
import logger from '@/src/runtime/logger'
import {
  isExtensionUrl as isExtensionPageUrl,
  isInternalUrl,
  resolveTabUrlForSupportCheck,
} from '@/src/shared/tab-url-helpers'
import type { MangaPageState } from '@/src/types/tab-state'

type TabContextError = { error: string }
export type TabContextCacheValue = MangaPageState | TabContextError | null
type ActiveTabContextValue = TabContextCacheValue | { loading: true }

interface TabCacheDependencies {
  readSession: (keys: string[]) => Promise<Record<string, unknown>>
  removeSession: (keys: string | string[]) => Promise<void>
  writeSession: (values: Record<string, unknown>) => Promise<void>
  queryActiveTabs: () => Promise<Array<{ id?: number }>>
  getTab: (tabId: number) => Promise<Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'> | undefined>
}

function hasResolvedTabUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.length > 0
}

async function hasProjectedActiveContext(
  readSession: (keys: string[]) => Promise<Record<string, unknown>>,
): Promise<boolean> {
  const sessionData = await readSession([SESSION_STORAGE_KEYS.activeTabContext])
  return sessionData[SESSION_STORAGE_KEYS.activeTabContext] !== null && sessionData[SESSION_STORAGE_KEYS.activeTabContext] !== undefined
}

function isMangaPageState(value: unknown): value is MangaPageState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as MangaPageState
  return (
    typeof candidate.siteIntegrationId === 'string' &&
    typeof candidate.mangaId === 'string' &&
    typeof candidate.seriesTitle === 'string' &&
    Array.isArray(candidate.chapters) &&
    Array.isArray(candidate.volumes)
  )
}

export function createTabContextCache(deps?: Partial<TabCacheDependencies>) {
  const dependencies: TabCacheDependencies = {
    readSession: async (keys) => chrome.storage.session.get(keys),
    removeSession: async (keys) => chrome.storage.session.remove(keys),
    writeSession: async (values) => chrome.storage.session.set(values),
    queryActiveTabs: async () => chrome.tabs.query({ active: true, currentWindow: true }),
    getTab: async (tabId) => chrome.tabs.get(tabId),
    ...deps,
  }

  const cache = new Map<number, TabContextCacheValue>()

  const writeActiveContext = async (value: ActiveTabContextValue): Promise<void> => {
    logger.debug('[tab-cache] Writing activeTabContext projection', { value })
    await dependencies.writeSession({ [SESSION_STORAGE_KEYS.activeTabContext]: value })
  }

  const readContextForTab = async (tabId: number): Promise<TabContextCacheValue> => {
    const tabKey = `tab_${tabId}`
    const errorKey = `seriesContextError_${tabId}`
    const sessionData = await dependencies.readSession([tabKey, errorKey])

    const maybeTabState = sessionData[tabKey]
    if (isMangaPageState(maybeTabState)) {
      return maybeTabState
    }

    const maybeError = sessionData[errorKey]
    if (typeof maybeError === 'string' && maybeError.length > 0) {
      return { error: maybeError }
    }

    return null
  }

  const shouldProjectLoadingForTab = async (tabId: number): Promise<boolean> => {
    try {
      const tab = await dependencies.getTab(tabId)
      const url = resolveTabUrlForSupportCheck(tab)
      return !isInternalUrl(url) && !!matchUrl(url)
    } catch {
      return false
    }
  }

  const resolveProjectedContext = async (tabId: number): Promise<ActiveTabContextValue> => {
    if (cache.has(tabId)) {
      logger.debug('[tab-cache] Using in-memory tab context cache', { tabId })
      return cache.get(tabId) ?? null
    }

    const resolved = await readContextForTab(tabId)
    if (resolved !== null) {
      logger.debug('[tab-cache] Restored tab context from session storage', { tabId, resolved })
      cache.set(tabId, resolved)
      return resolved
    }

    if (await shouldProjectLoadingForTab(tabId)) {
      logger.debug('[tab-cache] Projecting loading state for supported tab with no cached context yet', { tabId })
      return { loading: true }
    }

    logger.debug('[tab-cache] No cached context for tab; projecting unsupported state', { tabId })
    return null
  }

  const syncFromActiveTab = async (): Promise<void> => {
    const [activeTab] = await dependencies.queryActiveTabs()
    if (typeof activeTab?.id !== 'number') {
      await writeActiveContext(null)
      return
    }

    try {
      const tab = await dependencies.getTab(activeTab.id)
      if (tab?.url === 'about:blank' && !tab.pendingUrl && await hasProjectedActiveContext(dependencies.readSession)) {
        return
      }
      const url = resolveTabUrlForSupportCheck(tab)
      if (!hasResolvedTabUrl(url)) {
        return
      }
      if (isExtensionPageUrl(url)) {
        await writeActiveContext(null)
        return
      }
    } catch {
      // Ignore tab lookup failures and fall through to projection resolution.
    }

    const context = await resolveProjectedContext(activeTab.id)
    await writeActiveContext(context)
  }

  return {
    getCachedContext(tabId: number): TabContextCacheValue | undefined {
      return cache.get(tabId)
    },

    setCachedContext(tabId: number, value: TabContextCacheValue): void {
      cache.set(tabId, value)
    },

    deleteCachedContext(tabId: number): void {
      cache.delete(tabId)
    },

    async handleTabActivated(tabId: number): Promise<void> {
      try {
        const tab = await dependencies.getTab(tabId)
        if (tab?.url === 'about:blank' && !tab.pendingUrl && await hasProjectedActiveContext(dependencies.readSession)) {
          return
        }
        const url = resolveTabUrlForSupportCheck(tab)
        if (!hasResolvedTabUrl(url)) {
          return
        }
        if (isExtensionPageUrl(url)) {
          await writeActiveContext(null)
          return
        }
      } catch {
        // Ignore tab lookup failures and continue with normal projection resolution.
      }

      const context = await resolveProjectedContext(tabId)
      await writeActiveContext(context)
    },

    async handleTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo): Promise<void> {
      if (changeInfo.url) {
        logger.debug('[tab-cache] Tab URL changed; invalidating cached context', {
          tabId,
          url: changeInfo.url,
        })
        cache.delete(tabId)
        // Drop the external-init mark alongside tab state so a sticky
        // mark from the previous URL cannot suppress the content-script
        // initialization for the new page.
        await dependencies.removeSession([
          `tab_${tabId}`,
          `seriesContextError_${tabId}`,
          `${SESSION_STORAGE_KEYS.externalTabInitPrefix}${tabId}`,
        ])
      }

      if (changeInfo.url || changeInfo.status === 'complete') {
        await syncFromActiveTab()
      }
    },

    async handleTabRemoved(tabId: number): Promise<void> {
      cache.delete(tabId)
      await syncFromActiveTab()
    },

    async handleTabReplaced(addedTabId: number, removedTabId: number): Promise<void> {
      const previous = cache.get(removedTabId)
      cache.delete(removedTabId)

      if (previous !== undefined) {
        cache.set(addedTabId, previous)
      }

      await syncFromActiveTab()
    },

    async readAndCache(tabId: number): Promise<TabContextCacheValue> {
      const context = await readContextForTab(tabId)
      if (context === null) {
        cache.delete(tabId)
      } else {
        cache.set(tabId, context)
      }
      return context
    },

    async syncActiveTabContext(): Promise<void> {
      await syncFromActiveTab()
    },
  }
}

export const tabContextCache = createTabContextCache()
