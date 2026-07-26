import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"
import { matchUrl } from "@/src/site-integrations/url-matcher"
import logger from "@/src/runtime/logger"
import {
  isExtensionUrl as isExtensionPageUrl,
  isInternalUrl,
  resolveTabUrlForSupportCheck,
} from "@/src/shared/tab-url-helpers"
import type {
  ActiveTabContextByWindow,
  MangaPageState,
  ProjectedTabContext,
  WindowTabContext,
} from "@/src/types/tab-state"

type TabContextError = { error: string }
export type TabContextCacheValue = MangaPageState | TabContextError | null
export type ActiveTabContextValue = TabContextCacheValue | { loading: true }

interface ProjectionCommitOptions {
  requestId?: number
  windowId?: number
  supersedeInFlight?: boolean
}

interface ProjectionMutationResult {
  applied: boolean
  projected: boolean
}

// Maximum number of tab contexts to keep in the in-memory cache.
// Tabs beyond this limit are evicted on the next set (LRU-style via
// Map insertion order). In practice users rarely have more than ~50
// tabs open, but this prevents unbounded growth in edge cases.
const MAX_TAB_CACHE_SIZE = 100

interface TabCacheDependencies {
  readSession: (keys: string[]) => Promise<Record<string, unknown>>
  removeSession: (keys: string | string[]) => Promise<void>
  writeSession: (values: Record<string, unknown>) => Promise<void>
  queryActiveTabs: () => Promise<Array<{ id?: number; windowId?: number }>>
  getTab: (tabId: number) => Promise<
    | (Pick<chrome.tabs.Tab, "url" | "pendingUrl"> & {
        active?: boolean
        windowId?: number
      })
    | undefined
  >
}

function hasResolvedTabUrl(url: string | undefined): boolean {
  return typeof url === "string" && url.length > 0
}

function isLoadingContext(value: unknown): value is { loading: true } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { loading?: unknown }).loading === true
  )
}

function isMangaPageState(value: unknown): value is MangaPageState {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as MangaPageState
  return (
    typeof candidate.siteIntegrationId === "string" &&
    typeof candidate.mangaId === "string" &&
    typeof candidate.seriesTitle === "string" &&
    Array.isArray(candidate.chapters) &&
    Array.isArray(candidate.volumes)
  )
}

export function createTabContextCache(deps?: Partial<TabCacheDependencies>) {
  const dependencies: TabCacheDependencies = {
    readSession: async (keys) => chrome.storage.session.get(keys),
    removeSession: async (keys) => chrome.storage.session.remove(keys),
    writeSession: async (values) => chrome.storage.session.set(values),
    queryActiveTabs: async () => chrome.tabs.query({ active: true }),
    getTab: async (tabId) => chrome.tabs.get(tabId),
    ...deps,
  }

  const cache = new Map<number, TabContextCacheValue>()
  const projectionMutations = new StorageMutationQueue()

  // LRU-style set: move the entry to the end of the Map (most recently used)
  // and evict the oldest entry if the cache exceeds MAX_TAB_CACHE_SIZE.
  const setCacheEntry = (tabId: number, value: TabContextCacheValue): void => {
    // Delete first so re-insertion moves the entry to the end (most recent).
    cache.delete(tabId)
    cache.set(tabId, value)

    if (cache.size > MAX_TAB_CACHE_SIZE) {
      // Map.keys() returns entries in insertion order; the first is the oldest.
      const oldestKey = cache.keys().next().value
      if (oldestKey !== undefined) {
        cache.delete(oldestKey)
      }
    }
  }

  const readContextForTab = async (
    tabId: number
  ): Promise<TabContextCacheValue> => {
    const tabKey = `tab_${tabId}`
    const errorKey = `seriesContextError_${tabId}`
    const sessionData = await dependencies.readSession([tabKey, errorKey])

    const maybeTabState = sessionData[tabKey]
    if (isMangaPageState(maybeTabState)) {
      return maybeTabState
    }

    const maybeError = sessionData[errorKey]
    if (typeof maybeError === "string" && maybeError.length > 0) {
      return { error: maybeError }
    }

    return null
  }

  const readActiveTabContextByWindow =
    async (): Promise<ActiveTabContextByWindow> => {
      const sessionData = await dependencies.readSession([
        SESSION_STORAGE_KEYS.activeTabContextByWindow,
        SESSION_STORAGE_KEYS.activeTabContext,
      ])

      const raw = sessionData[SESSION_STORAGE_KEYS.activeTabContextByWindow]
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw as ActiveTabContextByWindow
      }

      // Legacy migration: the old global activeTabContext key maps to the
      // default window (window 1) until a per-window projection replaces it.
      const legacy = sessionData[SESSION_STORAGE_KEYS.activeTabContext]
      if (legacy !== undefined && legacy !== null) {
        return {
          1: {
            windowId: 1,
            activeTabId: -1,
            context: legacy as ProjectedTabContext,
            revision: 0,
            timestamp: 0,
          },
        }
      }

      return {}
    }

  const buildWindowContext = (
    windowId: number,
    activeTabId: number,
    context: ProjectedTabContext,
    revision: number
  ): WindowTabContext => ({
    windowId,
    activeTabId,
    context,
    revision,
    timestamp: Date.now(),
  })

  const getCurrentRevisionForWindow = async (
    windowId: number
  ): Promise<number> => {
    const contexts = await readActiveTabContextByWindow()
    return contexts[windowId]?.revision ?? 0
  }

  const writeWindowContext = async (
    windowContext: WindowTabContext
  ): Promise<void> => {
    const existing = await readActiveTabContextByWindow()
    const updated: ActiveTabContextByWindow = {
      ...existing,
      [windowContext.windowId]: windowContext,
    }

    logger.debug("[tab-cache] Writing activeTabContextByWindow projection", {
      windowId: windowContext.windowId,
      activeTabId: windowContext.activeTabId,
      revision: windowContext.revision,
      context: windowContext.context,
    })

    // Write the per-window projection first, then the legacy global key.
    // Keeping both in sync lets consumers migrate without a flag day.
    await dependencies.writeSession({
      [SESSION_STORAGE_KEYS.activeTabContextByWindow]: updated,
    })
    await dependencies.writeSession({
      [SESSION_STORAGE_KEYS.activeTabContext]: windowContext.context,
    })
  }

  const writeNextWindowContext = async (
    windowId: number,
    activeTabId: number,
    context: ProjectedTabContext
  ): Promise<number> =>
    projectionMutations.run(async () => {
      const currentRevision = await getCurrentRevisionForWindow(windowId)
      const nextRevision = currentRevision + 1
      await writeWindowContext(
        buildWindowContext(windowId, activeTabId, context, nextRevision)
      )
      return nextRevision
    })

  const shouldProjectLoadingForTab = async (
    tabId: number
  ): Promise<boolean> => {
    try {
      const tab = await dependencies.getTab(tabId)
      const url = resolveTabUrlForSupportCheck(tab)
      return !isInternalUrl(url) && !!matchUrl(url)
    } catch {
      return false
    }
  }

  const resolveProjectedContext = async (
    tabId: number
  ): Promise<ProjectedTabContext> => {
    if (cache.has(tabId)) {
      logger.debug("[tab-cache] Using in-memory tab context cache", { tabId })
      return cache.get(tabId) ?? null
    }

    const resolved = await readContextForTab(tabId)
    if (resolved !== null) {
      logger.debug("[tab-cache] Restored tab context from session storage", {
        tabId,
        resolved,
      })
      setCacheEntry(tabId, resolved)
      return resolved
    }

    if (await shouldProjectLoadingForTab(tabId)) {
      logger.debug(
        "[tab-cache] Projecting loading state for supported tab with no cached context yet",
        { tabId }
      )
      return { loading: true }
    }

    logger.debug(
      "[tab-cache] No cached context for tab; projecting unsupported state",
      { tabId }
    )
    return null
  }

  const getWindowIdForTab = async (
    tabId: number,
    preferredWindowId?: number
  ): Promise<number | undefined> => {
    if (typeof preferredWindowId === "number") {
      return preferredWindowId
    }

    try {
      const tab = await dependencies.getTab(tabId)
      if (typeof tab?.windowId === "number") {
        return tab.windowId
      }
    } catch {
      // fall through
    }

    try {
      const activeTabs = await dependencies.queryActiveTabs()
      const activeTab = activeTabs.find((t) => t.id === tabId)
      // chrome.tabs.Tab always has a windowId; the ?? 1 fallback is only
      // exercised by tests that supply an incomplete active tab stub.
      if (activeTab) {
        return activeTab.windowId ?? 1
      }
    } catch {
      // fall through
    }

    return undefined
  }

  const syncFromActiveTabs = async (): Promise<void> => {
    const activeTabs = await dependencies.queryActiveTabs()

    if (activeTabs.length === 0) {
      await projectionMutations.run(async () => {
        await dependencies.writeSession({
          [SESSION_STORAGE_KEYS.activeTabContext]: null,
          [SESSION_STORAGE_KEYS.activeTabContextByWindow]: {},
        })
      })
      return
    }

    for (const activeTab of activeTabs) {
      const tabId = activeTab.id
      if (typeof tabId !== "number") {
        continue
      }

      let windowId = activeTab.windowId
      if (typeof windowId !== "number") {
        windowId = await getWindowIdForTab(tabId)
      }
      if (typeof windowId !== "number") {
        continue
      }

      try {
        const tab = await dependencies.getTab(tabId)
        if (tab?.url === "about:blank" && !tab.pendingUrl) {
          const existing = await readActiveTabContextByWindow()
          const currentWindowContext = existing[windowId]
          if (
            currentWindowContext &&
            currentWindowContext.activeTabId === tabId
          ) {
            // Preserve existing projection for a transient about:blank page
            // instead of clearing it while the real pendingUrl resolves.
            continue
          }
        }

        const url = resolveTabUrlForSupportCheck(tab)
        if (!hasResolvedTabUrl(url)) {
          continue
        }

        if (isExtensionPageUrl(url)) {
          await writeNextWindowContext(windowId, tabId, null)
          continue
        }
      } catch {
        // Ignore tab lookup failures and fall through to projection resolution.
      }

      const context = await resolveProjectedContext(tabId)
      await writeNextWindowContext(windowId, tabId, context)
    }
  }

  const commitTabContextMutation = async (
    tabId: number,
    options: ProjectionCommitOptions | undefined,
    mutation: () => Promise<ProjectedTabContext>
  ): Promise<ProjectionMutationResult> =>
    projectionMutations.run(async () => {
      const activeTabs = await dependencies.queryActiveTabs()
      const activeTab = activeTabs.find((tab) => tab.id === tabId)
      const windowId = options?.windowId ?? activeTab?.windowId

      if (!activeTab || typeof windowId !== "number") {
        if (typeof options?.requestId === "number") {
          return { applied: false, projected: false }
        }

        const context = await mutation()
        if (!isLoadingContext(context)) {
          setCacheEntry(tabId, context)
        }
        return { applied: true, projected: false }
      }

      const existing = await readActiveTabContextByWindow()
      const currentWindowContext = existing[windowId]
      const currentRevision = currentWindowContext?.revision ?? 0

      if (
        typeof options?.requestId === "number" &&
        (options.requestId !== currentRevision ||
          currentWindowContext?.activeTabId !== tabId)
      ) {
        logger.debug("[tab-cache] Rejecting stale active tab context commit", {
          tabId,
          windowId,
          requestId: options.requestId,
          currentRevision,
          currentActiveTabId: currentWindowContext?.activeTabId,
        })
        return { applied: false, projected: false }
      }

      const context = await mutation()

      // A direct, externally supplied tab context is authoritative for the
      // current page. Advance the revision so a resolver that began before
      // that context arrived cannot overwrite it when its fetch completes.
      const requestId = options?.supersedeInFlight
        ? currentRevision + 1
        : (options?.requestId ?? currentRevision)

      // Always keep the in-memory cache up to date so activation is fast.
      // The cache stores resolved states only; transient loading projections
      // live in the session-backed window context.
      if (!isLoadingContext(context)) {
        setCacheEntry(tabId, context)
      }

      await writeWindowContext(
        buildWindowContext(windowId, tabId, context, requestId)
      )
      return { applied: true, projected: true }
    })

  const commitActiveTabContext = async (
    tabId: number,
    context: ProjectedTabContext,
    options?: ProjectionCommitOptions
  ): Promise<boolean> =>
    (
      await commitTabContextMutation(tabId, options, () =>
        Promise.resolve(context)
      )
    ).projected

  return {
    getCachedContext(tabId: number): TabContextCacheValue | undefined {
      return cache.get(tabId)
    },

    setCachedContext(tabId: number, value: TabContextCacheValue): void {
      setCacheEntry(tabId, value)
    },

    deleteCachedContext(tabId: number): void {
      cache.delete(tabId)
    },

    async commitTabContextMutation(
      tabId: number,
      options: ProjectionCommitOptions | undefined,
      mutation: () => Promise<ProjectedTabContext>
    ): Promise<boolean> {
      return (await commitTabContextMutation(tabId, options, mutation)).applied
    },

    async handleTabActivated(tabId: number, windowId?: number): Promise<void> {
      const resolvedWindowId = await getWindowIdForTab(tabId, windowId)

      try {
        const tab = await dependencies.getTab(tabId)
        if (tab?.url === "about:blank" && !tab.pendingUrl) {
          const existing = await readActiveTabContextByWindow()
          if (
            typeof resolvedWindowId === "number" &&
            existing[resolvedWindowId]
          ) {
            return
          }
        }

        const url = resolveTabUrlForSupportCheck(tab)
        if (!hasResolvedTabUrl(url)) {
          return
        }

        if (isExtensionPageUrl(url)) {
          if (typeof resolvedWindowId === "number") {
            await writeNextWindowContext(resolvedWindowId, tabId, null)
          }
          return
        }
      } catch {
        // Ignore tab lookup failures and continue with normal projection resolution.
      }

      if (typeof resolvedWindowId !== "number") {
        logger.debug("[tab-cache] Cannot resolve windowId for activated tab", {
          tabId,
        })
        return
      }

      const context = await resolveProjectedContext(tabId)
      await writeNextWindowContext(resolvedWindowId, tabId, context)
    },

    async handleTabUpdated(
      tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo
    ): Promise<void> {
      if (changeInfo.url || changeInfo.status === "loading") {
        logger.debug(
          "[tab-cache] Tab URL changed; invalidating cached context",
          {
            tabId,
            url: changeInfo.url,
          }
        )
        await projectionMutations.run(async () => {
          cache.delete(tabId)
          // Serialize invalidation with resolver commits so a result from the
          // previous URL cannot recreate tab state after navigation cleared it.
          await dependencies.removeSession([
            `tab_${tabId}`,
            `seriesContextError_${tabId}`,
          ])
        })
      }

      // A completed update must not allocate a new projection revision. A
      // DOM-ready resolver may already own the active loading revision, and
      // advancing it here would make that valid provider result look stale
      // and force an unnecessary second resolution. URL changes still
      // reproject immediately so stale/unsupported UI cannot survive a
      // navigation.
      if (changeInfo.url) {
        await syncFromActiveTabs()
      }
    },

    async handleTabRemoved(tabId: number): Promise<void> {
      cache.delete(tabId)
      await syncFromActiveTabs()
    },

    async handleTabReplaced(
      addedTabId: number,
      removedTabId: number
    ): Promise<void> {
      const previous = cache.get(removedTabId)
      cache.delete(removedTabId)

      if (previous !== undefined) {
        setCacheEntry(addedTabId, previous)
      }

      await syncFromActiveTabs()
    },

    async readAndCache(tabId: number): Promise<TabContextCacheValue> {
      const context = await readContextForTab(tabId)
      if (context === null) {
        cache.delete(tabId)
      } else {
        setCacheEntry(tabId, context)
      }
      return context
    },

    async syncActiveTabContext(
      tabId?: number,
      context?: ActiveTabContextValue,
      options?: ProjectionCommitOptions
    ): Promise<boolean> {
      if (typeof tabId === "number") {
        const committed = await commitActiveTabContext(
          tabId,
          context ?? null,
          options
        )
        if (committed) {
          return true
        }
        // A revisioned resolver result that no longer matches the current
        // loading request is stale. Reprojecting here would allocate another
        // revision and could invalidate the genuinely current request.
        if (typeof options?.requestId === "number") {
          return false
        }
        // The resolved tab is no longer active, but the active tab may still
        // need its projection refreshed (e.g. unsupported/inactive init).
        await syncFromActiveTabs()
        return false
      }

      await syncFromActiveTabs()
      return true
    },

    async isRequestIdCurrent(
      windowId: number,
      requestId: number
    ): Promise<boolean> {
      return projectionMutations.run(async () => {
        const currentRevision = await getCurrentRevisionForWindow(windowId)
        return requestId === currentRevision
      })
    },

    async projectLoadingForTab(
      tabId: number,
      windowId?: number
    ): Promise<{ requestId: number } | undefined> {
      const resolvedWindowId = await getWindowIdForTab(tabId, windowId)
      if (typeof resolvedWindowId !== "number") {
        return undefined
      }

      const nextRevision = await writeNextWindowContext(
        resolvedWindowId,
        tabId,
        { loading: true }
      )
      return { requestId: nextRevision }
    },
  }
}

export const tabContextCache = createTabContextCache()
