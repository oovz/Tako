import logger from "@/src/runtime/logger"
import { matchUrl } from "@/src/site-integrations/url-matcher"
import { isInternalUrl } from "@/entrypoints/background/tab-ui-coordinator"
import type { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"

interface NavigationListenerTabUiCoordinator {
  updateActionForTab: (tabId: number, url?: string | null) => Promise<void>
}

interface NavigationListenerTabContextResolver {
  resolveTabContext: (
    tabId: number,
    options?: {
      windowId?: number
      allowCached?: boolean
      supersedeInFlight?: boolean
    }
  ) => Promise<void>
}

interface NavigationListenerTabContextCache {
  handleTabActivated: (tabId: number, windowId?: number) => Promise<void>
  handleTabUpdated: (
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    windowId?: number
  ) => Promise<void>
  setCachedContext: (tabId: number, value: null) => void
  deleteCachedContext?: (tabId: number) => void
  getCachedContext?: (tabId: number) => unknown
  syncActiveTabContext: () => Promise<unknown>
  projectLoadingForTab: (
    tabId: number,
    windowId?: number
  ) => Promise<{ requestId: number } | undefined>
}

interface RegisterBackgroundNavigationListenersDependencies {
  ensureIntegrationsReady: () => Promise<void>
  getTabContextStateService: () => TabContextStateService
  tabContextCache: NavigationListenerTabContextCache
  tabContextResolver: NavigationListenerTabContextResolver
  tabUiCoordinator: NavigationListenerTabUiCoordinator
}

class BackgroundNavigationListeners {
  private readonly tabUpdateChains = new Map<number, Promise<void>>()
  constructor(
    private readonly deps: RegisterBackgroundNavigationListenersDependencies
  ) {}
  private enqueueTabUpdate(
    tabId: number,
    operation: () => Promise<void>
  ): void {
    const previous = this.tabUpdateChains.get(tabId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.tabUpdateChains.set(tabId, current)
    void current
      .catch((error) =>
        logger.debug("tabs.onUpdated navigation handling failed", error)
      )
      .finally(() => {
        if (this.tabUpdateChains.get(tabId) === current) {
          this.tabUpdateChains.delete(tabId)
        }
      })
  }
  private registerTabUpdates(): void {
    try {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.url || changeInfo.status) {
          this.enqueueTabUpdate(tabId, () =>
            this.handleTabUpdate(tabId, changeInfo, tab)
          )
        }
      })
    } catch (error) {
      logger.debug(
        "tabs.onUpdated listener unavailable; tab update navigation sync disabled",
        error
      )
    }
  }
  private registerDomReady(): void {
    try {
      chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
        if (details.tabId < 0 || details.frameId !== 0) return

        void (() => this.handleDomReady(details))().catch((error) =>
          logger.debug(
            "webNavigation.onDOMContentLoaded context resolution failed",
            error
          )
        )
      })
    } catch (error) {
      logger.debug("webNavigation.onDOMContentLoaded not available", error)
    }
  }
  private registerCommitted(): void {
    try {
      chrome.webNavigation.onCommitted.addListener((details) => {
        if (details.tabId >= 0 && details.frameId === 0) {
          void (() => this.handleCommitted(details))().catch((error) =>
            logger.debug(
              "webNavigation.onCommitted handler failed (non-fatal):",
              error
            )
          )
        }
      })
    } catch (error) {
      logger.debug("webNavigation.onCommitted not available", error)
    }
  }
  private registerHistoryUpdates(): void {
    try {
      chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
        if (details.tabId >= 0 && details.frameId === 0) {
          ;(() => this.handleHistoryUpdate(details))().catch((error) =>
            logger.debug(
              "onHistoryStateUpdated handler failed (non-fatal):",
              error
            )
          )
        }
      })
    } catch (error) {
      logger.debug("webNavigation.onHistoryStateUpdated not available", error)
    }
  }
  private registerActivations(): void {
    try {
      chrome.tabs.onActivated.addListener((activeInfo) => {
        const activationStartedAt = performance.now()
        logger.debug("[navigation] Active tab changed", {
          phase: "received",
          reason: "tabs.onActivated",
          tabId: activeInfo.tabId,
          windowId: activeInfo.windowId,
        })
        void (() => this.handleActivation(activeInfo, activationStartedAt))()
      })
    } catch (error) {
      logger.debug(
        "tabs.onActivated listener unavailable; active tab navigation sync disabled",
        error
      )
    }
  }
  private synchronizeInitialTabs(): void {
    try {
      chrome.tabs
        .query({})
        .then((tabs) => this.synchronizeTabs(tabs))
        .catch((error) => {
          logger.debug("tabs.query failed; initial tab UI sync skipped", error)
        })
    } catch (error) {
      logger.debug("tabs.query unavailable; initial tab UI sync skipped", error)
    }
  }
  register(): void {
    this.registerTabUpdates()
    this.registerDomReady()
    this.registerCommitted()
    this.registerHistoryUpdates()
    this.registerActivations()
    this.synchronizeInitialTabs()
  }

  private async handleTabUpdate(
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab
  ): Promise<void> {
    await this.deps.ensureIntegrationsReady()
    const invalidatesContext =
      Boolean(changeInfo.url) || changeInfo.status === "loading"
    if (
      invalidatesContext &&
      !(await this.invalidateTabUpdate(tabId, changeInfo, tab))
    )
      return
    const url = changeInfo.url ?? tab.url ?? null
    void this.deps.tabUiCoordinator.updateActionForTab(tabId, url)

    if (tab.active && changeInfo.status === "loading") {
      await this.deps.tabContextCache.projectLoadingForTab(tabId, tab.windowId)
    }

    this.resolveCompletedTab(tabId, changeInfo, tab)

    await this.clearUnsupportedTabUpdate(
      tabId,
      tab.windowId,
      url,
      invalidatesContext
    )
  }

  private async invalidateTabUpdate(
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab
  ): Promise<boolean> {
    const expectedUrl = changeInfo.url ?? tab.url ?? undefined
    const applied = await this.deps
      .getTabContextStateService()
      .clearTabState(tabId, {
        windowId: tab.windowId,
        expectedUrl,
        supersedeInFlight: true,
      })
    if (!applied) return false
    await this.deps.tabContextCache.handleTabUpdated(tabId, changeInfo)
    return true
  }

  private resolveCompletedTab(
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab
  ): void {
    if (
      tab.active &&
      changeInfo.status === "complete" &&
      this.deps.tabContextCache.getCachedContext?.(tabId) === undefined
    ) {
      void this.deps.tabContextResolver
        .resolveTabContext(tabId, {
          windowId: tab.windowId,
          allowCached: false,
          supersedeInFlight: true,
        })
        .catch((error) =>
          logger.debug("tab context resolution failed after navigation", error)
        )
    }
  }

  private async clearUnsupportedTabUpdate(
    tabId: number,
    windowId: number,
    url: string | null,
    invalidatesContext: boolean
  ): Promise<void> {
    if (url && !isInternalUrl(url) && !matchUrl(url)) {
      try {
        if (!invalidatesContext) {
          const cachedContext =
            this.deps.tabContextCache.getCachedContext?.(tabId)
          if (cachedContext === undefined) {
            const applied = await this.deps
              .getTabContextStateService()
              .clearTabState(tabId, {
                windowId,
                expectedUrl: url,
                supersedeInFlight: true,
              })
            if (!applied) return
            this.deps.tabContextCache.setCachedContext(tabId, null)
            logger.info(
              `background: onUpdated unsupported URL detected, clearing tab state for tab ${tabId}`
            )
          }
        } else {
          this.deps.tabContextCache.setCachedContext(tabId, null)
        }
      } catch (error) {
        logger.debug(
          "onUpdated navigation state cleanup failed (non-fatal):",
          error
        )
      }
    }
  }

  private async handleDomReady(details: {
    tabId: number
    url?: string
  }): Promise<void> {
    await this.deps.ensureIntegrationsReady()
    const tab = await chrome.tabs.get(details.tabId)
    const url = details.url ?? tab.url ?? ""
    if (!tab.active || isInternalUrl(url) || !matchUrl(url)) return

    // Series pages are generally usable at DOM readiness, while ad-heavy
    // hosts can delay `tabs.onUpdated(status=complete)` for a long time.
    // Start the provider work without waiting for queue recovery. The
    // resolver waits for the state manager only when it needs to commit.
    // It coalesces this with any fallback complete event.
    await this.deps.tabContextResolver.resolveTabContext(details.tabId, {
      windowId: tab.windowId,
      allowCached: false,
    })
  }

  private async handleCommitted(details: {
    tabId: number
    url?: string
  }): Promise<void> {
    await this.deps.ensureIntegrationsReady()
    const tab = await chrome.tabs.get(details.tabId)
    const resolvedUrl = tab.url ?? details.url ?? ""
    if (isInternalUrl(resolvedUrl)) {
      return
    }

    void this.deps.tabUiCoordinator.updateActionForTab(
      details.tabId,
      resolvedUrl
    )

    const isUrlSupported = !!matchUrl(resolvedUrl)
    if (!isUrlSupported) {
      await this.clearCommittedContext(details.tabId, resolvedUrl, details.url)
    }
  }

  private async clearCommittedContext(
    tabId: number,
    resolvedUrl: string,
    fallbackUrl?: string
  ): Promise<void> {
    try {
      const currentTab = await chrome.tabs.get(tabId)
      const currentUrl = currentTab.url ?? fallbackUrl ?? ""
      if (currentUrl !== resolvedUrl || matchUrl(currentUrl)) {
        return
      }
      logger.info(
        `background: unsupported URL detected, clearing tab state for tab ${tabId}`
      )
      const applied = await this.deps
        .getTabContextStateService()
        .clearTabState(tabId, {
          windowId: currentTab.windowId,
          expectedUrl: resolvedUrl,
          supersedeInFlight: true,
        })
      if (!applied) return
      this.deps.tabContextCache.setCachedContext(tabId, null)
    } catch (error) {
      logger.debug("Navigation state cleanup failed (non-fatal):", error)
    }
  }

  private async handleHistoryUpdate(details: {
    tabId: number
    url?: string
  }): Promise<void> {
    await this.deps.ensureIntegrationsReady()
    const url = details.url ?? (await chrome.tabs.get(details.tabId)).url ?? ""
    if (isInternalUrl(url)) {
      return
    }

    void this.deps.tabUiCoordinator.updateActionForTab(details.tabId, url)

    await this.clearHistoryContext(details.tabId, url)
  }
  private async clearHistoryContext(tabId: number, url: string): Promise<void> {
    try {
      const currentTab = await chrome.tabs.get(tabId)
      const currentUrl = currentTab.url ?? ""
      if (currentUrl !== url) return
      const applied = await this.deps
        .getTabContextStateService()
        .clearTabState(tabId, {
          windowId: currentTab.windowId,
          expectedUrl: url,
          supersedeInFlight: true,
        })
      if (!applied) return
      this.deps.tabContextCache.setCachedContext(tabId, null)
      await this.deps.tabContextCache.handleTabUpdated(tabId, { url })

      const tab = await chrome.tabs.get(tabId)
      if (tab.active && (tab.url ?? "") === url) {
        await this.deps.tabContextResolver.resolveTabContext(tabId, {
          windowId: tab.windowId,
          allowCached: false,
        })
      }
    } catch (error) {
      logger.debug("SPA navigation state cleanup failed (non-fatal):", error)
    }
  }

  private async handleActivation(
    activeInfo: chrome.tabs.OnActivatedInfo,
    activationStartedAt: number
  ): Promise<void> {
    try {
      const integrationMetadata = this.deps.ensureIntegrationsReady()
      let initializationCompletedAt: number | undefined
      const initialization = integrationMetadata.then(() => {
        initializationCompletedAt = performance.now()
        logger.debug("[navigation] Active tab initialization synchronized", {
          phase: "initialization-completed",
          reason: "tabs.onActivated",
          tabId: activeInfo.tabId,
          windowId: activeInfo.windowId,
          initializationWaitMs: Math.round(
            initializationCompletedAt - activationStartedAt
          ),
        })
      })
      void initialization.catch((error) =>
        logger.debug(
          "[navigation] Background initialization failed during tab activation",
          error
        )
      )
      const tabPromise = chrome.tabs.get(activeInfo.tabId)
      // Update the URL-based action indicator before any page probe or
      // provider request completes, including on a cold worker start.
      void tabPromise
        .then(async (tab) => {
          await integrationMetadata
          await this.deps.tabUiCoordinator.updateActionForTab(
            activeInfo.tabId,
            tab.url || null
          )
        })
        .catch((error) =>
          logger.debug("Unable to synchronize tab UI during activation", error)
        )
      await this.deps.tabContextResolver.resolveTabContext(activeInfo.tabId, {
        windowId: activeInfo.windowId,
        allowCached: true,
        supersedeInFlight: true,
      })
      const resolutionCompletedAt = performance.now()
      const tab = await tabPromise
      let sanitizedUrl: string | undefined
      try {
        const parsedUrl = tab?.url ? new URL(tab.url) : undefined
        sanitizedUrl = parsedUrl
          ? `${parsedUrl.origin}${parsedUrl.pathname}`
          : undefined
      } catch {
        sanitizedUrl = undefined
      }
      // The resolver can legitimately finish without committing when a
      // newer activation owns the window. Describe the operation, not the
      // state mutation, so rapid switches do not produce a false success
      // record.
      logger.debug("[navigation] Active tab context resolution finished", {
        phase: "resolution-finished",
        reason: "tabs.onActivated",
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
        url: sanitizedUrl,
        initializationWaitMs:
          initializationCompletedAt === undefined
            ? undefined
            : Math.round(initializationCompletedAt - activationStartedAt),
        resolutionMs: Math.round(resolutionCompletedAt - activationStartedAt),
        totalMs: Math.round(performance.now() - activationStartedAt),
      })
    } catch (error) {
      logger.debug(
        "tabs.onActivated handler failed, clearing tab UI state:",
        error
      )
      await this.deps.tabUiCoordinator.updateActionForTab(
        activeInfo.tabId,
        null
      )
    }
  }

  private async synchronizeTabs(tabs: chrome.tabs.Tab[]): Promise<void> {
    await this.deps.ensureIntegrationsReady()
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        void this.deps.tabUiCoordinator.updateActionForTab(
          tab.id,
          tab.url || null
        )
        if (tab.active) {
          void this.deps.tabContextResolver
            .resolveTabContext(tab.id, {
              windowId: tab.windowId,
              allowCached: true,
            })
            .catch((error) =>
              logger.debug(
                "Initial active-tab context resolution failed",
                error
              )
            )
        }
      }
    }
  }
}

export function registerBackgroundNavigationListeners(
  deps: RegisterBackgroundNavigationListenersDependencies
): void {
  new BackgroundNavigationListeners(deps).register()
}

export async function reconcileIntegrationSupportAfterPermissionRemoval(deps: {
  refreshIntegrations: () => Promise<void>
  ensureRuntimeReady: () => Promise<void>
  tabUiCoordinator: NavigationListenerTabUiCoordinator
  tabContextResolver: NavigationListenerTabContextResolver
}): Promise<void> {
  await deps.refreshIntegrations()
  await deps.ensureRuntimeReady()

  const tabs = await chrome.tabs.query({})
  const outcomes = await Promise.allSettled(
    tabs.flatMap((tab) => {
      if (typeof tab.id !== "number") return []
      const url = tab.url ?? tab.pendingUrl ?? ""
      const refreshes: Promise<unknown>[] = [
        deps.tabUiCoordinator.updateActionForTab(tab.id, url),
      ]
      if (tab.active) {
        refreshes.push(
          deps.tabContextResolver.resolveTabContext(tab.id, {
            windowId: tab.windowId,
            allowCached: false,
          })
        )
      }
      return refreshes
    })
  )
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      logger.debug(
        "Failed to refresh tab support after permission removal",
        outcome.reason
      )
    }
  }
}
