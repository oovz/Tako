import logger from "@/src/runtime/logger"
import { matchUrl } from "@/src/site-integrations/url-matcher"
import { isInternalUrl } from "@/entrypoints/background/tab-ui-coordinator"
import { isMangaPageState } from "@/src/runtime/state-shapes"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"

interface NavigationListenerTabUiCoordinator {
  updateActionForTab: (tabId: number, url?: string | null) => Promise<void>
  updateSidePanelForTab: (tabId: number) => Promise<void>
}

interface NavigationListenerTabContextResolver {
  resolveTabContext: (
    tabId: number,
    options?: { windowId?: number; allowCached?: boolean }
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
  deleteCachedContext: (tabId: number) => void
  getCachedContext?: (tabId: number) => unknown
  syncActiveTabContext: () => Promise<unknown>
  projectLoadingForTab: (
    tabId: number,
    windowId?: number
  ) => Promise<{ requestId: number } | undefined>
}

interface RegisterBackgroundNavigationListenersDependencies {
  ensureSiteIntegrationMetadataInitialized: () => Promise<void>
  ensureStateManagerInitialized: () => Promise<void>
  getStateManager: () => CentralizedStateManager
  tabContextCache: NavigationListenerTabContextCache
  tabContextResolver: NavigationListenerTabContextResolver
  tabUiCoordinator: NavigationListenerTabUiCoordinator
}

export function registerBackgroundNavigationListeners(
  deps: RegisterBackgroundNavigationListenersDependencies
): void {
  // Chrome can deliver loading and complete updates for one tab before the
  // first async handler finishes storage work. Serialize only the lightweight
  // projection/update prelude per tab; provider resolution stays asynchronous
  // so a slow site request never delays a newer navigation event.
  const tabUpdateChains = new Map<number, Promise<void>>()
  const enqueueTabUpdate = (
    tabId: number,
    operation: () => Promise<void>
  ): void => {
    const previous = tabUpdateChains.get(tabId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    tabUpdateChains.set(tabId, current)
    void current
      .catch((error) =>
        logger.debug("tabs.onUpdated navigation handling failed", error)
      )
      .finally(() => {
        if (tabUpdateChains.get(tabId) === current) {
          tabUpdateChains.delete(tabId)
        }
      })
  }

  try {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url || changeInfo.status) {
        enqueueTabUpdate(tabId, async () => {
          await deps.ensureSiteIntegrationMetadataInitialized()
          const invalidatesContext =
            Boolean(changeInfo.url) || changeInfo.status === "loading"
          if (invalidatesContext) {
            await deps.tabContextCache.handleTabUpdated(tabId, changeInfo)
          }
          const url = changeInfo.url ?? tab.url ?? null
          void deps.tabUiCoordinator.updateActionForTab(tabId, url)
          void deps.tabUiCoordinator.updateSidePanelForTab(tabId)

          if (tab.active && changeInfo.status === "loading") {
            await deps.tabContextCache.projectLoadingForTab(tabId, tab.windowId)
          }

          if (
            tab.active &&
            changeInfo.status === "complete" &&
            deps.tabContextCache.getCachedContext?.(tabId) === undefined
          ) {
            void deps.tabContextResolver
              .resolveTabContext(tabId, {
                windowId: tab.windowId,
                allowCached: false,
              })
              .catch((error) =>
                logger.debug(
                  "tab context resolution failed after navigation",
                  error
                )
              )
          }

          if (url && !isInternalUrl(url) && !matchUrl(url)) {
            try {
              deps.tabContextCache.setCachedContext(tabId, null)
              await chrome.storage.session.remove(`seriesContextError_${tabId}`)
              // Navigation freshness does not depend on queue/state recovery.
              // Delay only the state-manager cleanup that needs that runtime;
              // cache invalidation and the side-panel projection above happen
              // immediately for the newly unsupported URL.
              await deps.ensureStateManagerInitialized()
              await deps.getStateManager().clearTabState(tabId)
              deps.tabContextCache.deleteCachedContext(tabId)
              logger.info(
                `background: onUpdated unsupported URL detected, clearing tab state for tab ${tabId}`
              )
            } catch (error) {
              logger.debug(
                "onUpdated navigation state cleanup failed (non-fatal):",
                error
              )
            }
          }
        })
      }
    })
  } catch (error) {
    logger.debug(
      "tabs.onUpdated listener unavailable; tab update navigation sync disabled",
      error
    )
  }

  try {
    chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
      if (details.tabId < 0 || details.frameId !== 0) return

      void (async () => {
        await deps.ensureSiteIntegrationMetadataInitialized()
        const tab = await chrome.tabs.get(details.tabId)
        const url = details.url ?? tab.url ?? ""
        if (!tab.active || isInternalUrl(url) || !matchUrl(url)) return

        // Series pages are generally usable at DOM readiness, while ad-heavy
        // hosts can delay `tabs.onUpdated(status=complete)` for a long time.
        // Start the provider work without waiting for queue recovery. The
        // resolver waits for the state manager only when it needs to commit.
        // It coalesces this with any fallback complete event.
        await deps.tabContextResolver.resolveTabContext(details.tabId, {
          windowId: tab.windowId,
          allowCached: false,
        })
      })().catch((error) =>
        logger.debug(
          "webNavigation.onDOMContentLoaded context resolution failed",
          error
        )
      )
    })
  } catch (error) {
    logger.debug("webNavigation.onDOMContentLoaded not available", error)
  }

  try {
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.tabId >= 0 && details.frameId === 0) {
        void (async () => {
          await deps.ensureSiteIntegrationMetadataInitialized()
          await deps.ensureStateManagerInitialized()
          const tab = await chrome.tabs.get(details.tabId)
          const resolvedUrl = tab.url ?? details.url ?? ""
          if (isInternalUrl(resolvedUrl)) {
            return
          }

          void deps.tabUiCoordinator.updateActionForTab(
            details.tabId,
            resolvedUrl
          )
          void deps.tabUiCoordinator.updateSidePanelForTab(details.tabId)

          const isUrlSupported = !!matchUrl(resolvedUrl)
          if (!isUrlSupported) {
            try {
              const storageKey = `tab_${details.tabId}`
              const existing = await chrome.storage.session.get(storageKey)
              const currentTab = await chrome.tabs.get(details.tabId)
              const currentUrl = currentTab.url ?? details.url ?? ""
              if (currentUrl !== resolvedUrl || matchUrl(currentUrl)) {
                return
              }
              if (isMangaPageState(existing[storageKey])) {
                logger.info(
                  `background: unsupported URL detected, clearing tab state for tab ${details.tabId}`
                )
                deps.tabContextCache.setCachedContext(details.tabId, null)
                await deps.getStateManager().clearTabState(details.tabId)
                deps.tabContextCache.deleteCachedContext(details.tabId)
                await chrome.storage.session.remove(
                  `seriesContextError_${details.tabId}`
                )
              }
            } catch (error) {
              logger.debug(
                "Navigation state cleanup failed (non-fatal):",
                error
              )
            }
          }
        })().catch((error) =>
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

  try {
    chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
      if (details.tabId >= 0 && details.frameId === 0) {
        ;(async () => {
          await deps.ensureSiteIntegrationMetadataInitialized()
          await deps.ensureStateManagerInitialized()
          const url =
            details.url ?? (await chrome.tabs.get(details.tabId)).url ?? ""
          if (isInternalUrl(url)) {
            return
          }

          void deps.tabUiCoordinator.updateActionForTab(details.tabId, url)
          void deps.tabUiCoordinator.updateSidePanelForTab(details.tabId)

          try {
            deps.tabContextCache.setCachedContext(details.tabId, null)
            await deps.getStateManager().clearTabState(details.tabId)
            deps.tabContextCache.deleteCachedContext(details.tabId)
            await chrome.storage.session.remove([
              `seriesContextError_${details.tabId}`,
            ])
            await deps.tabContextCache.handleTabUpdated(details.tabId, { url })

            const tab = await chrome.tabs.get(details.tabId)
            if (tab.active) {
              await deps.tabContextResolver.resolveTabContext(details.tabId, {
                windowId: tab.windowId,
                allowCached: false,
              })
            }
          } catch (error) {
            logger.debug(
              "SPA navigation state cleanup failed (non-fatal):",
              error
            )
          }
        })().catch((error) =>
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

  try {
    chrome.tabs.onActivated.addListener((activeInfo) => {
      const activationStartedAt = performance.now()
      logger.debug("[navigation] Active tab changed", {
        phase: "received",
        reason: "tabs.onActivated",
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
      })
      void (async () => {
        try {
          const integrationMetadata =
            deps.ensureSiteIntegrationMetadataInitialized()
          let initializationCompletedAt: number | undefined
          const initialization = deps
            .ensureStateManagerInitialized()
            .then(() => {
              initializationCompletedAt = performance.now()
              logger.debug(
                "[navigation] Active tab initialization synchronized",
                {
                  phase: "initialization-completed",
                  reason: "tabs.onActivated",
                  tabId: activeInfo.tabId,
                  windowId: activeInfo.windowId,
                  initializationWaitMs: Math.round(
                    initializationCompletedAt - activationStartedAt
                  ),
                }
              )
            })
          void initialization.catch((error) =>
            logger.debug(
              "[navigation] Background initialization failed during tab activation",
              error
            )
          )
          const tabPromise = chrome.tabs.get(activeInfo.tabId)
          // Action and Side Panel availability are URL-based, so do not make
          // them wait for a page probe or provider request. This is especially
          // important when activation wakes a cold MV3 service worker.
          void tabPromise
            .then(async (tab) => {
              await integrationMetadata
              return Promise.all([
                deps.tabUiCoordinator.updateActionForTab(
                  activeInfo.tabId,
                  tab.url || null
                ),
                deps.tabUiCoordinator.updateSidePanelForTab(activeInfo.tabId),
              ])
            })
            .catch((error) =>
              logger.debug(
                "Unable to synchronize tab UI during activation",
                error
              )
            )
          await deps.tabContextResolver.resolveTabContext(activeInfo.tabId, {
            windowId: activeInfo.windowId,
            allowCached: true,
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
            resolutionMs: Math.round(
              resolutionCompletedAt - activationStartedAt
            ),
            totalMs: Math.round(performance.now() - activationStartedAt),
          })
        } catch (error) {
          logger.debug(
            "tabs.onActivated handler failed, clearing tab UI state:",
            error
          )
          await deps.tabUiCoordinator.updateActionForTab(activeInfo.tabId, null)
          await deps.tabUiCoordinator.updateSidePanelForTab(activeInfo.tabId)
        }
      })()
    })
  } catch (error) {
    logger.debug(
      "tabs.onActivated listener unavailable; active tab navigation sync disabled",
      error
    )
  }

  try {
    chrome.tabs
      .query({})
      .then(async (tabs) => {
        await deps.ensureSiteIntegrationMetadataInitialized()
        for (const tab of tabs) {
          if (typeof tab.id === "number") {
            void deps.tabUiCoordinator.updateActionForTab(
              tab.id,
              tab.url || null
            )
            void deps.tabUiCoordinator.updateSidePanelForTab(tab.id)
            if (tab.active) {
              void deps.tabContextResolver
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
      })
      .catch((error) => {
        logger.debug("tabs.query failed; initial tab UI sync skipped", error)
      })
  } catch (error) {
    logger.debug("tabs.query unavailable; initial tab UI sync skipped", error)
  }
}
