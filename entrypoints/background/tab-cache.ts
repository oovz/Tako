import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"
import { matchUrl } from "@/src/site-integrations/url-matcher"
import logger from "@/src/runtime/logger"
import {
  isLoadingTabContext,
  isMangaPageState,
  parseActiveTabContextByWindow,
} from "@/src/runtime/tab-state-schemas"
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
  expectedUrl?: string
  ownerSignal?: AbortSignal
}

interface ProjectionMutationResult {
  applied: boolean
  projected: boolean
}

export interface CurrentSeriesContext {
  context: MangaPageState
  revision: number
  windowId: number
}

// Cache writes evict the oldest entries once this limit is reached.
const MAX_TAB_CACHE_SIZE = 100

interface TabCacheDependencies {
  readSession: (keys: string[]) => Promise<Record<string, unknown>>
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

class TabContextCache {
  private readonly cache = new Map<number, TabContextCacheValue>()
  private readonly projectionMutations = new StorageMutationQueue()
  private readonly dependencies: TabCacheDependencies
  constructor(deps?: Partial<TabCacheDependencies>) {
    this.dependencies = {
      readSession: async (keys) => chrome.storage.session.get(keys),
      writeSession: async (values) => chrome.storage.session.set(values),
      queryActiveTabs: async () => chrome.tabs.query({ active: true }),
      getTab: async (tabId) => chrome.tabs.get(tabId),
      ...deps,
    }
  }
  private setCacheEntry(tabId: number, value: TabContextCacheValue): void {
    // Delete first so re-insertion moves the entry to the end (most recent).
    this.cache.delete(tabId)
    this.cache.set(tabId, value)
    if (this.cache.size > MAX_TAB_CACHE_SIZE) {
      // Map.keys() returns entries in insertion order; the first is the oldest.
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }
  }

  private async readContextForTab(
    tabId: number
  ): Promise<TabContextCacheValue> {
    const tabKey = `tab_${tabId}`
    const errorKey = `seriesContextError_${tabId}`
    const sessionData = await this.dependencies.readSession([tabKey, errorKey])
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

  private async readActiveTabContextByWindow(): Promise<ActiveTabContextByWindow> {
    const sessionData = await this.dependencies.readSession([
      SESSION_STORAGE_KEYS.activeTabContextByWindow,
    ])
    const raw = sessionData[SESSION_STORAGE_KEYS.activeTabContextByWindow]
    return parseActiveTabContextByWindow(raw) ?? {}
  }

  private buildWindowContext(
    windowId: number,
    activeTabId: number,
    context: ProjectedTabContext,
    revision: number
  ): WindowTabContext {
    return {
      windowId,
      activeTabId,
      context,
      revision,
      timestamp: Date.now(),
    }
  }

  private async getCurrentRevisionForWindow(windowId: number): Promise<number> {
    const contexts = await this.readActiveTabContextByWindow()
    return contexts[windowId]?.revision ?? 0
  }

  private async writeWindowContext(
    windowContext: WindowTabContext
  ): Promise<void> {
    const existing = await this.readActiveTabContextByWindow()
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
    await this.dependencies.writeSession({
      [SESSION_STORAGE_KEYS.activeTabContextByWindow]: updated,
    })
  }

  private async writeNextWindowContext(
    windowId: number,
    activeTabId: number,
    context: ProjectedTabContext,
    supersedeCurrent = false
  ): Promise<number | undefined> {
    return this.projectionMutations.run(async () => {
      // Re-check ownership at the serialized write boundary. Any active-tab
      // snapshot read before this queue turn may have become stale while a
      // newer activation was being processed.
      const activeTabs = await this.dependencies.queryActiveTabs()
      const ownsWindow = ownsActiveWindow(activeTabs, activeTabId, windowId)
      if (!ownsWindow) {
        logger.debug("[tab-cache] Skipping projection for inactive tab", {
          tabId: activeTabId,
          windowId,
        })
        return undefined
      }
      const contexts = await this.readActiveTabContextByWindow()
      const currentWindowContext = contexts[windowId]
      if (
        !supersedeCurrent &&
        currentWindowContext?.activeTabId === activeTabId &&
        isLoadingTabContext(currentWindowContext.context) &&
        isLoadingTabContext(context)
      ) {
        return currentWindowContext.revision
      }
      const currentRevision = currentWindowContext?.revision ?? 0
      const nextRevision = currentRevision + 1
      await this.writeWindowContext(
        this.buildWindowContext(windowId, activeTabId, context, nextRevision)
      )
      return nextRevision
    })
  }

  private async shouldProjectLoadingForTab(tabId: number): Promise<boolean> {
    try {
      const tab = await this.dependencies.getTab(tabId)
      const url = resolveTabUrlForSupportCheck(tab)
      return !isInternalUrl(url) && !!matchUrl(url)
    } catch {
      return false
    }
  }

  private async resolveProjectedContext(
    tabId: number
  ): Promise<ProjectedTabContext> {
    if (this.cache.has(tabId)) {
      logger.debug("[tab-cache] Using in-memory tab context cache", { tabId })
      return this.cache.get(tabId) ?? null
    }
    const resolved = await this.readContextForTab(tabId)
    if (resolved !== null) {
      logger.debug("[tab-cache] Restored tab context from session storage", {
        tabId,
        resolved,
      })
      this.setCacheEntry(tabId, resolved)
      return resolved
    }
    if (await this.shouldProjectLoadingForTab(tabId)) {
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

  private async getWindowIdForTab(
    tabId: number,
    preferredWindowId?: number
  ): Promise<number | undefined> {
    if (typeof preferredWindowId === "number") {
      return preferredWindowId
    }
    try {
      const tab = await this.dependencies.getTab(tabId)
      if (typeof tab?.windowId === "number") {
        return tab.windowId
      }
    } catch {
      // fall through
    }
    try {
      const activeTabs = await this.dependencies.queryActiveTabs()
      const activeTab = activeTabs.find((t) => t.id === tabId)
      if (typeof activeTab?.windowId === "number") {
        return activeTab.windowId
      }
    } catch {
      // fall through
    }
    return undefined
  }

  private async syncFromActiveTabs(updatedTabId?: number): Promise<void> {
    const activeTabs = await this.dependencies.queryActiveTabs()
    if (activeTabs.length === 0 && updatedTabId === undefined) {
      await this.projectionMutations.run(() =>
        this.dependencies.writeSession({
          [SESSION_STORAGE_KEYS.activeTabContextByWindow]: {},
        })
      )
      return
    }
    for (const activeTab of activeTabs) {
      const tabId = activeTab.id
      if (
        typeof tabId !== "number" ||
        (updatedTabId !== undefined && tabId !== updatedTabId)
      )
        continue
      const windowId =
        activeTab.windowId ?? (await this.getWindowIdForTab(tabId))
      if (typeof windowId !== "number") continue
      await this.handleTabActivated(tabId, windowId)
    }
  }

  private async applyTabContextMutation(
    tabId: number,
    options: ProjectionCommitOptions | undefined,
    mutation: () => Promise<ProjectedTabContext>
  ): Promise<ProjectionMutationResult> {
    return this.projectionMutations.run(async () => {
      if (options?.ownerSignal?.aborted)
        return { applied: false, projected: false }
      const owner = await this.resolveCommitOwner(tabId, options)
      if (owner.kind === "rejected") return { applied: false, projected: false }
      if (owner.kind === "inactive") {
        const context = await mutation()
        this.cacheResolvedContext(tabId, context)
        return { applied: true, projected: false }
      }
      return this.mutateActiveContext(tabId, owner, options, mutation)
    })
  }

  private async mutateActiveContext(
    tabId: number,
    owner: { windowId: number; revision: number },
    options: ProjectionCommitOptions | undefined,
    mutation: () => Promise<ProjectedTabContext>
  ): Promise<ProjectionMutationResult> {
    const context = await mutation()
    if (options?.ownerSignal?.aborted)
      return { applied: false, projected: false }
    const requestId = options?.supersedeInFlight
      ? owner.revision + 1
      : (options?.requestId ?? owner.revision)
    this.cacheResolvedContext(tabId, context)
    await this.writeWindowContext(
      this.buildWindowContext(owner.windowId, tabId, context, requestId)
    )
    return { applied: true, projected: true }
  }

  private cacheResolvedContext(
    tabId: number,
    context: ProjectedTabContext
  ): void {
    // Loading state belongs to the revisioned window projection, not the cache.
    if (!isLoadingTabContext(context)) this.setCacheEntry(tabId, context)
  }

  private async resolveCommitOwner(
    tabId: number,
    options?: ProjectionCommitOptions
  ): Promise<
    | { kind: "rejected" }
    | { kind: "inactive" }
    | { kind: "active"; windowId: number; revision: number }
  > {
    const window = await this.resolveMutationWindow(tabId, options?.windowId)
    if (window.kind === "inactive")
      return {
        kind: typeof options?.requestId === "number" ? "rejected" : "inactive",
      }
    if (window.kind === "rejected") return window
    if (
      !(await this.matchesExpectedUrl(
        tabId,
        window.windowId,
        options?.expectedUrl
      ))
    )
      return { kind: "rejected" }
    return this.resolveRevisionOwner(tabId, window.windowId, options?.requestId)
  }

  private async resolveMutationWindow(
    tabId: number,
    preferredWindowId?: number
  ): Promise<
    | { kind: "rejected" }
    | { kind: "inactive" }
    | { kind: "active"; windowId: number }
  > {
    const active = (await this.dependencies.queryActiveTabs()).find(
      (tab) => tab.id === tabId
    )
    const windowId = preferredWindowId ?? active?.windowId
    if (!active || typeof windowId !== "number") return { kind: "inactive" }
    if (typeof active.windowId === "number" && active.windowId !== windowId)
      return { kind: "rejected" }
    return { kind: "active", windowId }
  }

  private async resolveRevisionOwner(
    tabId: number,
    windowId: number,
    requestId?: number
  ): Promise<
    | { kind: "rejected" }
    | { kind: "active"; windowId: number; revision: number }
  > {
    const current = (await this.readActiveTabContextByWindow())[windowId]
    const revision = current?.revision ?? 0
    if (
      !this.matchesCommitRevision(tabId, windowId, revision, current, requestId)
    )
      return { kind: "rejected" }
    return { kind: "active", windowId, revision }
  }

  private async matchesExpectedUrl(
    tabId: number,
    windowId: number,
    expectedUrl?: string
  ): Promise<boolean> {
    if (!expectedUrl) return true
    try {
      const tab = await this.dependencies.getTab(tabId)
      return (
        tab?.windowId === windowId &&
        resolveTabUrlForSupportCheck(tab) === expectedUrl
      )
    } catch {
      return false
    }
  }

  private matchesCommitRevision(
    tabId: number,
    windowId: number,
    revision: number,
    current: WindowTabContext | undefined,
    requestId?: number
  ): boolean {
    if (
      typeof requestId !== "number" ||
      (requestId === revision && current?.activeTabId === tabId)
    )
      return true
    logger.debug("[tab-cache] Rejecting stale active tab context commit", {
      tabId,
      windowId,
      requestId,
      currentRevision: revision,
      currentActiveTabId: current?.activeTabId,
    })
    return false
  }

  private async commitActiveTabContext(
    tabId: number,
    context: ProjectedTabContext,
    options?: ProjectionCommitOptions
  ): Promise<boolean> {
    return (
      await this.applyTabContextMutation(tabId, options, () =>
        Promise.resolve(context)
      )
    ).projected
  }
  async getCurrentSeriesContext(
    tabId: number,
    windowId?: number
  ): Promise<CurrentSeriesContext | undefined> {
    return this.projectionMutations.run(async () => {
      const resolvedWindowId = await this.getWindowIdForTab(tabId, windowId)
      if (typeof resolvedWindowId !== "number") return undefined
      const tab = await this.getActiveSeriesTab(tabId, resolvedWindowId)
      if (!tab) return undefined
      const matched = matchUrl(tab.url, { includeDisabled: true })
      if (!matched) return undefined
      const current = (await this.readActiveTabContextByWindow())[
        resolvedWindowId
      ]
      if (
        !this.matchesSeriesProjection(
          current,
          tabId,
          tab.url,
          matched.integrationId
        )
      )
        return undefined
      return {
        context: structuredClone(current.context),
        revision: current.revision,
        windowId: resolvedWindowId,
      }
    })
  }

  private async getActiveSeriesTab(
    tabId: number,
    windowId: number
  ): Promise<{ url: string } | undefined> {
    try {
      const tab = await this.dependencies.getTab(tabId)
      if (!tab?.active || tab.windowId !== windowId) return undefined
      if (typeof tab.pendingUrl === "string" && tab.pendingUrl.length > 0)
        return undefined
      if (typeof tab.url !== "string" || tab.url.length === 0) return undefined
      return { url: tab.url }
    } catch {
      return undefined
    }
  }

  private matchesSeriesProjection(
    context: WindowTabContext | undefined,
    tabId: number,
    url: string,
    integrationId: string
  ): context is WindowTabContext & { context: MangaPageState } {
    return (
      !!context &&
      context.activeTabId === tabId &&
      isMangaPageState(context.context) &&
      context.context.sourceUrl === url &&
      context.context.siteIntegrationId === integrationId
    )
  }

  getCachedContext(tabId: number): TabContextCacheValue | undefined {
    return this.cache.get(tabId)
  }

  setCachedContext(tabId: number, value: TabContextCacheValue): void {
    this.setCacheEntry(tabId, value)
  }

  deleteCachedContext(tabId: number): void {
    this.cache.delete(tabId)
  }

  async commitTabContextMutation(
    tabId: number,
    options: ProjectionCommitOptions | undefined,
    mutation: () => Promise<ProjectedTabContext>
  ): Promise<boolean> {
    return (await this.applyTabContextMutation(tabId, options, mutation))
      .applied
  }

  async handleTabActivated(tabId: number, windowId?: number): Promise<void> {
    const resolvedWindowId = await this.getWindowIdForTab(tabId, windowId)
    if (await this.shouldSkipProjection(tabId, resolvedWindowId)) return
    if (typeof resolvedWindowId !== "number") {
      logger.debug("[tab-cache] Cannot resolve windowId for activated tab", {
        tabId,
      })
      return
    }
    const context = await this.resolveProjectedContext(tabId)
    await this.writeNextWindowContext(resolvedWindowId, tabId, context)
  }

  private async shouldSkipProjection(
    tabId: number,
    windowId?: number
  ): Promise<boolean> {
    try {
      const tab = await this.dependencies.getTab(tabId)
      if (await this.hasTransientBlankProjection(tabId, windowId, tab))
        return true
      const url = resolveTabUrlForSupportCheck(tab)
      if (!hasResolvedTabUrl(url)) return true
      if (isExtensionPageUrl(url)) {
        if (typeof windowId === "number")
          await this.writeNextWindowContext(windowId, tabId, null)
        return true
      }
    } catch {
      // A missing tab snapshot still permits restoration from the session cache.
    }
    return false
  }

  private async hasTransientBlankProjection(
    tabId: number,
    windowId: number | undefined,
    tab: Awaited<ReturnType<TabCacheDependencies["getTab"]>>
  ): Promise<boolean> {
    if (tab?.url !== "about:blank" || tab.pendingUrl) return false
    const existing = await this.readActiveTabContextByWindow()
    return (
      typeof windowId === "number" && existing[windowId]?.activeTabId === tabId
    )
  }

  async handleTabUpdated(
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo
  ): Promise<void> {
    if (changeInfo.url || changeInfo.status === "loading") {
      logger.debug("[tab-cache] Tab URL changed; invalidating cached context", {
        tabId,
        url: changeInfo.url,
      })
      // Session tab/error state is owned and cleared by
      // TabContextStateService. This cache operation only drops the local
      // resolved projection; navigation callers clear durable state through
      // the service before invoking this method.
      this.cache.delete(tabId)
    }
    // A completed update must not allocate a new projection revision. A
    // DOM-ready resolver may already own the active loading revision, and
    // advancing it here would make that valid provider result look stale
    // and force an unnecessary second resolution. URL changes still
    // reproject immediately so stale/unsupported UI cannot survive a
    // navigation.
    if (changeInfo.url) {
      await this.syncFromActiveTabs(tabId)
    }
  }

  async handleTabRemoved(tabId: number): Promise<void> {
    this.cache.delete(tabId)
    await this.syncFromActiveTabs()
  }

  async handleTabReplaced(
    addedTabId: number,
    removedTabId: number
  ): Promise<void> {
    const previous = this.cache.get(removedTabId)
    this.cache.delete(removedTabId)
    if (previous !== undefined) {
      this.setCacheEntry(addedTabId, previous)
    }
    await this.syncFromActiveTabs()
  }

  async readAndCache(tabId: number): Promise<TabContextCacheValue> {
    const context = await this.readContextForTab(tabId)
    if (context === null) {
      this.cache.delete(tabId)
    } else {
      this.setCacheEntry(tabId, context)
    }
    return context
  }

  async syncActiveTabContext(
    tabId?: number,
    context?: ActiveTabContextValue,
    options?: ProjectionCommitOptions
  ): Promise<boolean> {
    if (typeof tabId === "number") {
      const committed = await this.commitActiveTabContext(
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
      await this.syncFromActiveTabs()
      return false
    }
    await this.syncFromActiveTabs()
    return true
  }

  async isRequestIdCurrent(
    windowId: number,
    requestId: number
  ): Promise<boolean> {
    return this.projectionMutations.run(async () => {
      const currentRevision = await this.getCurrentRevisionForWindow(windowId)
      return requestId === currentRevision
    })
  }

  async projectLoadingForTab(
    tabId: number,
    windowId?: number,
    supersedeCurrent = false
  ): Promise<
    | {
        requestId: number
      }
    | undefined
  > {
    const resolvedWindowId = await this.getWindowIdForTab(tabId, windowId)
    if (typeof resolvedWindowId !== "number") {
      return undefined
    }
    const nextRevision = await this.writeNextWindowContext(
      resolvedWindowId,
      tabId,
      { loading: true },
      supersedeCurrent
    )
    return nextRevision === undefined ? undefined : { requestId: nextRevision }
  }
}

export function createTabContextCache(deps?: Partial<TabCacheDependencies>) {
  const cache = new TabContextCache(deps)
  return {
    getCurrentSeriesContext: cache.getCurrentSeriesContext.bind(cache),
    getCachedContext: cache.getCachedContext.bind(cache),
    setCachedContext: cache.setCachedContext.bind(cache),
    deleteCachedContext: cache.deleteCachedContext.bind(cache),
    commitTabContextMutation: cache.commitTabContextMutation.bind(cache),
    handleTabActivated: cache.handleTabActivated.bind(cache),
    handleTabUpdated: cache.handleTabUpdated.bind(cache),
    handleTabRemoved: cache.handleTabRemoved.bind(cache),
    handleTabReplaced: cache.handleTabReplaced.bind(cache),
    readAndCache: cache.readAndCache.bind(cache),
    syncActiveTabContext: cache.syncActiveTabContext.bind(cache),
    isRequestIdCurrent: cache.isRequestIdCurrent.bind(cache),
    projectLoadingForTab: cache.projectLoadingForTab.bind(cache),
  }
}

export const tabContextCache = createTabContextCache()

function ownsActiveWindow(
  tabs: Array<{ id?: number; windowId?: number }>,
  tabId: number,
  windowId: number
): boolean {
  return tabs.some(
    (tab) =>
      tab.id === tabId &&
      (tab.windowId === undefined || tab.windowId === windowId)
  )
}
