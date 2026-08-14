import type {
  TabContextCacheValue,
  createTabContextCache,
} from "@/entrypoints/background/tab-cache"
import type { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import logger from "@/src/runtime/logger"
import {
  normalizeFetchedSeriesData,
  buildResolvedTabContext,
} from "@/src/runtime/series-data-normalization"
import { resolveSiteIntegrationSeriesData } from "@/src/runtime/resolve-site-integration-series-data"
import { getBackgroundSiteAdapterById } from "@/src/runtime/background-site-integration-initialization"
import { getDefinition } from "@/src/site-integrations/catalog"
import { executeApprovedPageProbe } from "@/src/site-integrations/page-probe"
import { matchUrl } from "@/src/site-integrations/url-matcher"
import { resolveTabUrlForSupportCheck } from "@/src/shared/tab-url-helpers"
import { DEFAULT_FETCH_TIMEOUT_MS } from "@/src/constants/timeouts"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import type { SiteIntegrationSettingsReader } from "@/src/types/site-integrations"

type TabContextCache = ReturnType<typeof createTabContextCache>
type TabContextResolutionOutcome = "completed" | "retry"

const MAX_STALE_RESOLUTION_RETRIES = 2

export interface ResolveTabContextOptions {
  windowId?: number
  allowCached?: boolean
  supersedeInFlight?: boolean
}

function withinTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  controller?: AbortController
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        const error = new Error("Timed out while resolving page context")
        controller?.abort(error)
        reject(error)
      },
      Math.max(1, timeoutMs)
    )

    void operation.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(
          error instanceof Error
            ? error
            : new Error("Page context resolution failed", { cause: error })
        )
      }
    )
  })
}

function createUserFacingResolutionError(): string {
  return "This site’s series information could not be loaded. Try again."
}

function isIncompleteCachedContext(value: TabContextCacheValue): boolean {
  return value !== null && !("error" in value) && value.chaptersLoading === true
}

function isCachedContextForUrl(
  value: TabContextCacheValue,
  expectedUrl: string
): boolean {
  return value === null || "error" in value || value.sourceUrl === expectedUrl
}

class PageProbeUrlMismatchError extends Error {
  constructor() {
    super("The page changed while its context was loading")
    this.name = "PageProbeUrlMismatchError"
  }
}

export function createTabContextResolver(deps: {
  getTabContextStateService: () => TabContextStateService
  tabContextCache: TabContextCache
  resolutionTimeoutMs?: number
  beforeResolution?: () => Promise<void>
  beforeStateMutation?: () => Promise<void>
  rateLimitService: RateLimitService
  siteIntegrationSettingsReader: SiteIntegrationSettingsReader
}) {
  const resolutionTimeoutMs =
    deps.resolutionTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const inFlightByTab = new Map<
    number,
    {
      url: string | undefined
      promise: Promise<void>
      controller: AbortController
    }
  >()

  async function commitCachedContext(
    tabId: number,
    cached: TabContextCacheValue,
    requestId: number,
    windowId: number | undefined,
    expectedUrl: string,
    ownerSignal: AbortSignal | undefined
  ): Promise<void> {
    await deps.tabContextCache.syncActiveTabContext(tabId, cached, {
      requestId,
      windowId,
      expectedUrl,
      ownerSignal,
    })
  }

  async function initializeTabContext(
    payload: Parameters<TabContextStateService["commitResolvedTabContext"]>[0],
    tabId: number,
    request: {
      requestId: number
      windowId?: number
      supersedeInFlight?: boolean
      expectedUrl?: string
      ownerSignal?: AbortSignal
    }
  ): Promise<void> {
    await deps.beforeStateMutation?.()
    await deps
      .getTabContextStateService()
      .commitResolvedTabContext(payload, tabId, request)
  }

  async function resolveTabContextUncoalesced(
    tabId: number,
    expectedUrl: string | undefined,
    options: ResolveTabContextOptions = {},
    ownerSignal?: AbortSignal
  ): Promise<TabContextResolutionOutcome> {
    const resolutionStartedAt = performance.now()
    await deps.beforeResolution?.()
    if (ownerSignal?.aborted) return "completed"
    let tab: chrome.tabs.Tab
    try {
      tab = await chrome.tabs.get(tabId)
    } catch (error) {
      logger.debug("Unable to read tab for context resolution", error)
      return "completed"
    }
    if (ownerSignal?.aborted) return "completed"
    if (
      typeof options.windowId === "number" &&
      tab.windowId !== options.windowId
    ) {
      return "completed"
    }
    if (!tab.active) {
      return ownerSignal?.aborted ? "completed" : "retry"
    }

    const currentUrl = resolveTabUrlForSupportCheck(tab)
    if (currentUrl !== expectedUrl) {
      // A startup or navigation event can be delivered while the tab is
      // still about:blank. Do not let that stale invocation claim a loading
      // request for the URL that replaces it; restart from the latest tab
      // snapshot instead.
      logger.debug("Restarting tab context resolution after URL changed", {
        tabId,
        expectedUrl,
        currentUrl,
      })
      return "retry"
    }

    const windowId = options.windowId ?? tab.windowId
    const loading = await deps.tabContextCache.projectLoadingForTab(
      tabId,
      windowId,
      options.supersedeInFlight === true
    )
    if (!loading) return "completed"
    const requestId = loading.requestId
    if (ownerSignal?.aborted) return "completed"

    const url = currentUrl
    if (!url) {
      await initializeTabContext({ context: "unsupported" }, tabId, {
        requestId,
        windowId,
        expectedUrl: url,
        ownerSignal,
      })
      return "completed"
    }

    if (options.allowCached) {
      const inMemory = deps.tabContextCache.getCachedContext(tabId)
      const cached =
        inMemory !== undefined
          ? inMemory
          : await deps.tabContextCache.readAndCache(tabId)
      if (
        (inMemory !== undefined || cached !== null) &&
        !isIncompleteCachedContext(cached) &&
        isCachedContextForUrl(cached, url)
      ) {
        await commitCachedContext(
          tabId,
          cached,
          requestId,
          windowId,
          url,
          ownerSignal
        )
        logger.debug("[tab-context] Resolved active tab from cache", {
          tabId,
          windowId,
          source: inMemory !== undefined ? "memory" : "session",
          durationMs: Math.round(performance.now() - resolutionStartedAt),
        })
        return "completed"
      }
    }

    const matched = matchUrl(url)
    if (!matched) {
      await initializeTabContext({ context: "unsupported" }, tabId, {
        requestId,
        windowId,
        expectedUrl: url,
        ownerSignal,
      })
      return "completed"
    }

    let acceptsPartialResults = true
    const resolutionController = new AbortController()
    const abortOwner = () =>
      resolutionController.abort(ownerSignal?.reason ?? "superseded")
    ownerSignal?.addEventListener("abort", abortOwner, { once: true })
    if (ownerSignal?.aborted) abortOwner()
    try {
      let deadlineAt = Date.now() + resolutionTimeoutMs
      const awaitWithinResolutionDeadline = <T>(operation: Promise<T>) =>
        withinTimeout(
          operation,
          Math.max(1, deadlineAt - Date.now()),
          resolutionController
        )
      const awaitOptionalEnrichment = <T>(operation: Promise<T>) =>
        withinTimeout(operation, resolutionTimeoutMs)
      const manifest = getDefinition(matched.integrationId)
      let probe: { url: string; data?: unknown } | undefined
      let shouldRunPageProbe = manifest?.pageProbe !== "none"
      const providerAdapter = shouldRunPageProbe
        ? await getBackgroundSiteAdapterById(matched.integrationId)
        : undefined
      if (
        manifest?.pageProbe === "optional" &&
        providerAdapter?.background.shouldExecutePageProbe
      ) {
        try {
          shouldRunPageProbe = await awaitOptionalEnrichment(
            providerAdapter.background.shouldExecutePageProbe({
              siteIntegrationSettingsReader: deps.siteIntegrationSettingsReader,
            })
          )
        } catch (error) {
          // Optional provider policy failures cannot make a site unavailable.
          logger.debug("Skipping optional integration page probe", error)
          shouldRunPageProbe = false
        }
      }
      if (shouldRunPageProbe) {
        try {
          const probeOperation = executeApprovedPageProbe(
            tabId,
            matched.integrationId
          )
          probe =
            manifest?.pageProbe === "required"
              ? await awaitWithinResolutionDeadline(probeOperation)
              : await awaitOptionalEnrichment(probeOperation)
          if (probe.url !== url) {
            logger.debug("Ignoring page probe from a superseded URL", {
              tabId,
              expectedUrl: url,
              actualUrl: probe.url,
            })
            throw new PageProbeUrlMismatchError()
          }
        } catch (error) {
          if (error instanceof PageProbeUrlMismatchError) {
            throw error
          }
          if (manifest?.pageProbe === "required") {
            throw error
          }
          // Optional probes enrich provider resolution but cannot make the
          // provider unavailable when their transient page owner disappears.
          logger.debug("Optional integration page probe failed", {
            integrationId: matched.integrationId,
          })
        }
      }

      // Optional enrichment has its own bounded wait and cannot consume the
      // provider resolver's execution budget.
      deadlineAt = Date.now() + resolutionTimeoutMs

      const onPartial = async (partial: {
        seriesId?: string
        seriesMetadata?: SeriesMetadata
      }) => {
        if (
          !acceptsPartialResults ||
          ownerSignal?.aborted ||
          !partial.seriesId ||
          !partial.seriesMetadata
        ) {
          return
        }

        try {
          await deps.beforeStateMutation?.()
          if (!acceptsPartialResults || ownerSignal?.aborted) return

          const currentTab = await awaitWithinResolutionDeadline(
            chrome.tabs.get(tabId)
          )
          const currentUrl = resolveTabUrlForSupportCheck(currentTab)
          const isCurrent = await deps.tabContextCache.isRequestIdCurrent(
            windowId,
            requestId
          )
          if (
            !currentTab.active ||
            currentTab.windowId !== windowId ||
            currentUrl !== url ||
            !isCurrent
          ) {
            logger.debug("Discarding stale partial tab context result", {
              tabId,
              requestId,
            })
            return
          }

          const tabContextStateService = deps.getTabContextStateService()
          const existingState = await tabContextStateService.getTabState(tabId)
          const isSameSeries =
            existingState?.siteIntegrationId === matched.integrationId &&
            existingState.mangaId === partial.seriesId
          const existingChapters = isSameSeries ? existingState.chapters : []
          const partialPayload = buildResolvedTabContext({
            sourceUrl: url,
            siteIntegrationId: matched.integrationId,
            rawMangaId: partial.seriesId,
            chapters: existingChapters,
            volumes: isSameSeries ? existingState.volumes : undefined,
            seriesMetadata: partial.seriesMetadata,
            chaptersLoading: true,
          })

          await tabContextStateService.commitResolvedTabContext(
            partialPayload,
            tabId,
            {
              requestId,
              windowId,
              expectedUrl: url,
              ownerSignal,
            }
          )
        } catch (error) {
          logger.debug("Partial tab context commit failed", {
            tabId,
            requestId,
            error,
          })
        }
      }

      const result = await awaitWithinResolutionDeadline(
        resolveSiteIntegrationSeriesData({
          siteIntegrationId: matched.integrationId,
          seriesUrl: url,
          pageProbeData: probe?.data,
          signal: resolutionController.signal,
          rateLimitService: deps.rateLimitService,
          siteIntegrationSettingsReader: deps.siteIntegrationSettingsReader,
          onPartial,
        })
      )
      acceptsPartialResults = false
      const normalized = normalizeFetchedSeriesData(result.chapterList)
      const extractionError = result.metadataError ?? result.chapterListError
      const payload = buildResolvedTabContext({
        sourceUrl: url,
        siteIntegrationId: matched.integrationId,
        rawMangaId: result.seriesId ?? null,
        chapters: normalized.chapters,
        volumes: normalized.volumes,
        seriesMetadata: result.seriesMetadata,
        extractionError,
        chapterListNotice: result.chapterListNotice,
      })

      const currentTab = await awaitWithinResolutionDeadline(
        chrome.tabs.get(tabId)
      )
      const currentUrl = resolveTabUrlForSupportCheck(currentTab)
      const isCurrent = await deps.tabContextCache.isRequestIdCurrent(
        windowId,
        requestId
      )
      if (
        ownerSignal?.aborted ||
        !currentTab.active ||
        currentTab.windowId !== windowId ||
        currentUrl !== url ||
        !isCurrent
      ) {
        logger.debug("Discarding stale tab context result", {
          tabId,
          requestId,
        })
        return currentTab.active &&
          currentTab.windowId === windowId &&
          currentUrl !== url &&
          isCurrent
          ? "retry"
          : "completed"
      }

      if (
        probe?.data !== undefined &&
        typeof result.seriesId === "string" &&
        providerAdapter?.background.persistPageProbeData
      ) {
        try {
          await providerAdapter.background.persistPageProbeData({
            seriesId: result.seriesId,
            pageProbeData: probe.data,
          })
        } catch (error) {
          // Resolution still succeeds if this recoverable session snapshot
          // cannot be written; a later dispatch uses extension defaults.
          logger.debug("Unable to persist page-probe data", error)
        }
      }

      await initializeTabContext(payload, tabId, {
        requestId,
        windowId,
        expectedUrl: url,
        ownerSignal,
      })
      logger.debug("[tab-context] Resolved active tab from provider", {
        tabId,
        windowId,
        integrationId: matched.integrationId,
        durationMs: Math.round(performance.now() - resolutionStartedAt),
      })
      return "completed"
    } catch (error) {
      acceptsPartialResults = false
      if (ownerSignal?.aborted) {
        return "completed"
      }
      logger.error("Tab context resolution failed:", error)
      const isCurrent = await deps.tabContextCache.isRequestIdCurrent(
        windowId,
        requestId
      )
      if (!isCurrent) {
        return "completed"
      }
      await initializeTabContext(
        { context: "error", error: createUserFacingResolutionError() },
        tabId,
        {
          requestId,
          windowId,
          supersedeInFlight: true,
          expectedUrl: url,
          ownerSignal,
        }
      )
      return "completed"
    } finally {
      ownerSignal?.removeEventListener("abort", abortOwner)
    }
  }

  async function resolveTabContext(
    tabId: number,
    options: ResolveTabContextOptions = {},
    retryCount = 0
  ): Promise<void> {
    let requestedUrl: string | undefined
    try {
      requestedUrl = resolveTabUrlForSupportCheck(await chrome.tabs.get(tabId))
    } catch {
      return
    }

    const existing = inFlightByTab.get(tabId)
    if (existing?.url === requestedUrl && !options.supersedeInFlight) {
      return await existing.promise
    }

    existing?.controller.abort("superseded by a newer tab URL")
    const controller = new AbortController()
    const operation = resolveTabContextUncoalesced(
      tabId,
      requestedUrl,
      options,
      controller.signal
    )
    const promise = operation.then(() => undefined)
    inFlightByTab.set(tabId, { url: requestedUrl, promise, controller })
    let outcome: TabContextResolutionOutcome
    try {
      outcome = await operation
    } finally {
      if (inFlightByTab.get(tabId)?.promise === promise) {
        inFlightByTab.delete(tabId)
      }
    }

    if (outcome === "retry") {
      if (retryCount < MAX_STALE_RESOLUTION_RETRIES) {
        return await resolveTabContext(
          tabId,
          { ...options, supersedeInFlight: false },
          retryCount + 1
        )
      }
      logger.debug(
        "Giving up stale tab context retry; a newer request owns it",
        {
          tabId,
        }
      )
    }
  }

  return {
    resolveTabContext,
  }
}
