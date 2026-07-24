import { handleInitializeTab } from "@/entrypoints/background/action-handlers/tab-state-handlers"
import type {
  TabContextCacheValue,
  createTabContextCache,
} from "@/entrypoints/background/tab-cache"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import logger from "@/src/runtime/logger"
import {
  normalizeFetchedSeriesData,
  resolveInitializeTabPayload,
} from "@/src/runtime/series-data-normalization"
import { resolveSiteIntegrationSeriesData } from "@/src/runtime/resolve-site-integration-series-data"
import { composeSeriesKey } from "@/src/runtime/queue-task-summary"
import { getSiteIntegrationManifestById } from "@/src/site-integrations/manifest"
import {
  executeApprovedPageProbe,
  type PageProbeResult,
} from "@/src/site-integrations/page-probe"
import { matchUrl } from "@/src/site-integrations/url-matcher"
import { parseMangadexPagePreferences } from "@/src/site-integrations/mangadex/preferences"
import {
  MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY,
  parseMangadexPreferencesBySeries,
  type MangadexUserPreferences,
} from "@/src/site-integrations/mangadex/preferences-schema"
import { resolveTabUrlForSupportCheck } from "@/src/shared/tab-url-helpers"
import { siteIntegrationSettingsService } from "@/src/storage/site-integration-settings-service"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"
import { DEFAULT_FETCH_TIMEOUT_MS } from "@/src/constants/timeouts"

type TabContextCache = ReturnType<typeof createTabContextCache>
type TabContextResolutionOutcome = "completed" | "retry"

const mangadexPreferenceSessionMutations = new StorageMutationQueue()
const MAX_STALE_RESOLUTION_RETRIES = 2

export interface ResolveTabContextOptions {
  windowId?: number
  allowCached?: boolean
}

function withinTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        reject(new Error("Timed out while resolving page context"))
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

class PageProbeUrlMismatchError extends Error {
  constructor() {
    super("The page changed while its context was loading")
    this.name = "PageProbeUrlMismatchError"
  }
}

function preferencesFromProbe(
  integrationId: string,
  probe: PageProbeResult | undefined
) {
  return integrationId === "mangadex"
    ? parseMangadexPagePreferences(probe?.mangadexPreferences)
    : undefined
}

async function shouldReadMangadexPagePreferences(): Promise<boolean> {
  try {
    const settings = await siteIntegrationSettingsService.getForSite("mangadex")
    return settings.autoReadMangaDexSettings !== false
  } catch (error) {
    // The optional page probe reads website-owned data. If settings cannot be
    // read, retain the privacy-preserving path and resolve with defaults.
    logger.debug("Skipping optional MangaDex page probe", error)
    return false
  }
}

async function persistMangadexPagePreferences(input: {
  seriesId: string
  preferences: MangadexUserPreferences
}): Promise<void> {
  await mangadexPreferenceSessionMutations.run(async () => {
    const session = await chrome.storage.session.get(
      MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY
    )
    const preferencesBySeries = parseMangadexPreferencesBySeries(
      session[MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY]
    )
    preferencesBySeries[composeSeriesKey("mangadex", input.seriesId)] =
      input.preferences
    await chrome.storage.session.set({
      [MANGADEX_PREFERENCES_BY_SERIES_SESSION_KEY]: preferencesBySeries,
    })
  })
}

export function createTabContextResolver(deps: {
  getStateManager: () => CentralizedStateManager
  tabContextCache: TabContextCache
  resolutionTimeoutMs?: number
  beforeStateMutation?: () => Promise<void>
}) {
  const resolutionTimeoutMs =
    deps.resolutionTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const inFlightByTab = new Map<
    number,
    { url: string | undefined; promise: Promise<void> }
  >()

  async function commitCachedContext(
    tabId: number,
    cached: TabContextCacheValue,
    requestId: number,
    windowId?: number
  ): Promise<void> {
    await deps.tabContextCache.syncActiveTabContext(tabId, cached, {
      requestId,
      windowId,
    })
  }

  async function initializeTabContext(
    payload: Parameters<typeof handleInitializeTab>[1],
    tabId: number,
    request: { requestId: number; windowId?: number }
  ): Promise<void> {
    await deps.beforeStateMutation?.()
    await handleInitializeTab(deps.getStateManager(), payload, tabId, request)
  }

  async function resolveTabContextUncoalesced(
    tabId: number,
    expectedUrl: string | undefined,
    options: ResolveTabContextOptions = {}
  ): Promise<TabContextResolutionOutcome> {
    const resolutionStartedAt = performance.now()
    let tab: chrome.tabs.Tab
    try {
      tab = await chrome.tabs.get(tabId)
    } catch (error) {
      logger.debug("Unable to read tab for context resolution", error)
      return "completed"
    }
    if (!tab.active) return "completed"

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
      windowId
    )
    if (!loading) return "completed"
    const requestId = loading.requestId

    const url = currentUrl
    if (!url) {
      await initializeTabContext({ context: "unsupported" }, tabId, {
        requestId,
        windowId,
      })
      return "completed"
    }

    if (options.allowCached) {
      const inMemory = deps.tabContextCache.getCachedContext(tabId)
      const cached =
        inMemory !== undefined
          ? inMemory
          : await deps.tabContextCache.readAndCache(tabId)
      if (inMemory !== undefined || cached !== null) {
        await commitCachedContext(tabId, cached, requestId, windowId)
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
      })
      return "completed"
    }

    try {
      const deadlineAt = Date.now() + resolutionTimeoutMs
      const awaitWithinResolutionDeadline = <T>(operation: Promise<T>) =>
        withinTimeout(operation, Math.max(1, deadlineAt - Date.now()))
      const manifest = getSiteIntegrationManifestById(matched.integrationId)
      let probe: PageProbeResult | undefined
      const shouldReadMangadexPreferences =
        matched.integrationId === "mangadex"
          ? await awaitWithinResolutionDeadline(
              shouldReadMangadexPagePreferences()
            )
          : false
      const shouldRunPageProbe =
        manifest?.requiresPageProbe &&
        (matched.integrationId !== "mangadex" || shouldReadMangadexPreferences)
      if (shouldRunPageProbe) {
        try {
          probe = await awaitWithinResolutionDeadline(
            executeApprovedPageProbe(tabId, matched.integrationId)
          )
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
          if (matched.integrationId !== "mangadex") {
            throw error
          }
          // MangaDex preferences are optional. Series resolution safely uses
          // extension defaults if the constrained preference probe is unavailable.
          logger.debug("Optional MangaDex preference probe failed")
        }
      }

      const mangadexPreferences = preferencesFromProbe(
        matched.integrationId,
        probe
      )

      const result = await awaitWithinResolutionDeadline(
        resolveSiteIntegrationSeriesData({
          siteIntegrationId: matched.integrationId,
          seriesUrl: url,
          mangadexPreferences,
          ...(probe?.integrationContext
            ? { integrationContext: probe.integrationContext }
            : {}),
        })
      )
      const normalized = normalizeFetchedSeriesData(result.chapterList)
      const extractionError = result.metadataError ?? result.chapterListError
      const payload = resolveInitializeTabPayload({
        siteIntegrationId: matched.integrationId,
        rawMangaId: result.seriesId ?? null,
        chapters: normalized.chapters,
        volumes: normalized.volumes,
        seriesMetadata: result.seriesMetadata,
        extractionError,
      })

      const currentTab = await awaitWithinResolutionDeadline(
        chrome.tabs.get(tabId)
      )
      const currentUrl = resolveTabUrlForSupportCheck(currentTab)
      const isCurrent = await deps.tabContextCache.isRequestIdCurrent(
        windowId,
        requestId
      )
      if (!currentTab.active || currentUrl !== url || !isCurrent) {
        logger.debug("Discarding stale tab context result", {
          tabId,
          requestId,
        })
        return currentTab.active ? "retry" : "completed"
      }

      if (
        matched.integrationId === "mangadex" &&
        shouldReadMangadexPreferences &&
        mangadexPreferences &&
        typeof result.seriesId === "string"
      ) {
        try {
          await persistMangadexPagePreferences({
            seriesId: result.seriesId,
            preferences: mangadexPreferences,
          })
        } catch (error) {
          // Resolution still succeeds if this recoverable session snapshot
          // cannot be written; a later dispatch uses extension defaults.
          logger.debug("Unable to persist MangaDex page preferences", error)
        }
      }

      await initializeTabContext(payload, tabId, {
        requestId,
        windowId,
      })
      logger.debug("[tab-context] Resolved active tab from provider", {
        tabId,
        windowId,
        integrationId: matched.integrationId,
        durationMs: Math.round(performance.now() - resolutionStartedAt),
      })
      return "completed"
    } catch (error) {
      logger.error("Tab context resolution failed:", error)
      const isCurrent = await deps.tabContextCache.isRequestIdCurrent(
        windowId,
        requestId
      )
      if (!isCurrent) {
        return "retry"
      }
      await initializeTabContext(
        { context: "error", error: createUserFacingResolutionError() },
        tabId,
        { requestId, windowId }
      )
      return "completed"
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
    if (existing?.url === requestedUrl) {
      return await existing.promise
    }

    const operation = resolveTabContextUncoalesced(tabId, requestedUrl, options)
    const promise = operation.then(() => undefined)
    inFlightByTab.set(tabId, { url: requestedUrl, promise })
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
        return await resolveTabContext(tabId, options, retryCount + 1)
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
