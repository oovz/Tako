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
import { SeriesHostPermissionRequiredError } from "@/src/site-integrations/host-permission-service"
import { SiteRequestDeniedError } from "@/src/site-integrations/site-request-denied-error"
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
  retryErrors?: boolean
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
  return (
    value === null ||
    value.sourceUrl === undefined ||
    value.sourceUrl === expectedUrl
  )
}

class PageProbeUrlMismatchError extends Error {
  constructor() {
    super("The page changed while its context was loading")
    this.name = "PageProbeUrlMismatchError"
  }
}

interface TabContextResolverDependencies {
  getTabContextStateService: () => TabContextStateService
  tabContextCache: TabContextCache
  resolutionTimeoutMs?: number
  beforeResolution?: () => Promise<void>
  beforeStateMutation?: () => Promise<void>
  rateLimitService: RateLimitService
  siteIntegrationSettingsReader: SiteIntegrationSettingsReader
}

interface TabResolutionRequest {
  tabId: number
  tab: chrome.tabs.Tab
  windowId: number
  requestId: number
  url: string
  ownerSignal: AbortSignal
  startedAt: number
}

type ContextCommitRequest = Parameters<
  TabContextStateService["commitResolvedTabContext"]
>[2]

async function initializeTabContext(
  deps: TabContextResolverDependencies,
  payload: Parameters<TabContextStateService["commitResolvedTabContext"]>[0],
  tabId: number,
  request: ContextCommitRequest
): Promise<void> {
  await deps.beforeStateMutation?.()
  await deps
    .getTabContextStateService()
    .commitResolvedTabContext(payload, tabId, request)
}

class ProviderTabResolution {
  private readonly controller = new AbortController()
  private acceptsPartialResults = true
  private stage = "provider-setup"
  private probe: { url: string; data?: unknown } | undefined
  private providerAdapter: Awaited<
    ReturnType<typeof getBackgroundSiteAdapterById>
  >
  private deadlineAt: number

  constructor(
    private readonly deps: TabContextResolverDependencies,
    private readonly request: TabResolutionRequest,
    private readonly integrationId: string,
    private readonly timeoutMs: number
  ) {
    this.deadlineAt = Date.now() + timeoutMs
  }

  private withinDeadline<T>(operation: Promise<T>): Promise<T> {
    return withinTimeout(
      operation,
      Math.max(1, this.deadlineAt - Date.now()),
      this.controller
    )
  }

  private commitRequest(): ContextCommitRequest {
    const { requestId, windowId, url, ownerSignal } = this.request
    return { requestId, windowId, expectedUrl: url, ownerSignal }
  }

  async run(): Promise<TabContextResolutionOutcome> {
    const releaseOwner = this.observeOwnerCancellation()
    try {
      await this.prepareProbe()
      // Optional enrichment receives a separate budget from provider execution.
      this.deadlineAt = Date.now() + this.timeoutMs
      this.stage = "provider-resolution"
      const result = await this.withinDeadline(
        resolveSiteIntegrationSeriesData({
          siteIntegrationId: this.integrationId,
          seriesUrl: this.request.url,
          pageProbeData: this.probe?.data,
          signal: this.controller.signal,
          rateLimitService: this.deps.rateLimitService,
          siteIntegrationSettingsReader:
            this.deps.siteIntegrationSettingsReader,
          onPartial: (partial) => this.commitPartial(partial),
        })
      )
      this.acceptsPartialResults = false
      this.stage = "normalization"
      const normalized = normalizeFetchedSeriesData(result.chapterList)
      const payload = buildResolvedTabContext({
        sourceUrl: this.request.url,
        siteIntegrationId: this.integrationId,
        rawMangaId: result.seriesId ?? null,
        chapters: normalized.chapters,
        volumes: normalized.volumes,
        seriesMetadata: result.seriesMetadata,
        extractionError: result.metadataError ?? result.chapterListError,
        chapterListNotice: result.chapterListNotice,
      })
      this.stage = "ownership-check"
      const outcome = await this.persistProbeDataIfCurrent(result.seriesId)
      if (outcome) return outcome
      this.stage = "state-commit"
      await initializeTabContext(
        this.deps,
        payload,
        this.request.tabId,
        this.commitRequest()
      )
      logger.debug("[tab-context] Resolved active tab from provider", {
        tabId: this.request.tabId,
        windowId: this.request.windowId,
        integrationId: this.integrationId,
        durationMs: Math.round(performance.now() - this.request.startedAt),
      })
      return "completed"
    } catch (error) {
      return await this.handleFailure(error)
    } finally {
      releaseOwner()
    }
  }

  private observeOwnerCancellation(): () => void {
    const ownerSignal = this.request.ownerSignal
    const abortOwner = () =>
      this.controller.abort(ownerSignal.reason ?? "superseded")
    ownerSignal.addEventListener("abort", abortOwner, { once: true })
    if (ownerSignal.aborted) abortOwner()

    return () => ownerSignal.removeEventListener("abort", abortOwner)
  }

  private async prepareProbe(): Promise<void> {
    const manifest = getDefinition(this.integrationId)
    let shouldRun = manifest?.pageProbe !== "none"
    this.providerAdapter = shouldRun
      ? await getBackgroundSiteAdapterById(this.integrationId)
      : undefined
    if (
      manifest?.pageProbe === "optional" &&
      this.providerAdapter?.background.shouldExecutePageProbe
    ) {
      shouldRun = await this.shouldExecuteOptionalProbe()
    }
    if (shouldRun) await this.executeProbe(manifest?.pageProbe === "required")
  }

  private async shouldExecuteOptionalProbe(): Promise<boolean> {
    const background = this.providerAdapter?.background
    if (!background?.shouldExecutePageProbe) return false
    try {
      return await withinTimeout(
        background.shouldExecutePageProbe({
          siteIntegrationSettingsReader:
            this.deps.siteIntegrationSettingsReader,
        }),
        this.timeoutMs
      )
    } catch (error) {
      logger.debug("Skipping optional integration page probe", error)
      return false
    }
  }

  private async executeProbe(required: boolean): Promise<void> {
    this.stage = "page-probe"
    try {
      const operation = executeApprovedPageProbe(
        this.request.tabId,
        this.integrationId
      )
      this.probe = required
        ? await this.withinDeadline(operation)
        : await withinTimeout(operation, this.timeoutMs)
      if (this.probe.url !== this.request.url) {
        logger.debug("Ignoring page probe from a superseded URL", {
          tabId: this.request.tabId,
          expectedUrl: this.request.url,
          actualUrl: this.probe.url,
        })
        throw new PageProbeUrlMismatchError()
      }
    } catch (error) {
      if (error instanceof PageProbeUrlMismatchError || required) throw error
      logger.debug("Optional integration page probe failed", {
        integrationId: this.integrationId,
      })
    }
  }

  private async commitPartial(partial: {
    seriesId?: string
    seriesMetadata?: SeriesMetadata
  }): Promise<void> {
    if (!this.canAcceptPartial(partial)) return
    const { tabId, requestId, windowId, ownerSignal } = this.request
    try {
      await this.deps.beforeStateMutation?.()
      if (!this.acceptsPartialResults || ownerSignal.aborted) return
      const currentTab = await this.withinDeadline(chrome.tabs.get(tabId))
      const currentUrl = resolveTabUrlForSupportCheck(currentTab)
      const isCurrent = await this.deps.tabContextCache.isRequestIdCurrent(
        windowId,
        requestId
      )
      if (!this.ownsCurrentPartial(currentTab, currentUrl, isCurrent)) {
        logger.debug("Discarding stale partial tab context result", {
          tabId,
          requestId,
        })
        return
      }
      await this.writePartial(partial.seriesId, partial.seriesMetadata)
    } catch (error) {
      logger.debug("Partial tab context commit failed", {
        tabId,
        requestId,
        error,
      })
    }
  }

  private canAcceptPartial(partial: {
    seriesId?: string
    seriesMetadata?: SeriesMetadata
  }): partial is { seriesId: string; seriesMetadata: SeriesMetadata } {
    return (
      this.acceptsPartialResults &&
      !this.request.ownerSignal.aborted &&
      !!partial.seriesId &&
      !!partial.seriesMetadata
    )
  }
  private ownsCurrentPartial(
    tab: chrome.tabs.Tab,
    url: string | undefined,
    current: boolean
  ): boolean {
    return (
      tab.active &&
      tab.windowId === this.request.windowId &&
      url === this.request.url &&
      current
    )
  }

  private async writePartial(
    seriesId: string,
    seriesMetadata: SeriesMetadata
  ): Promise<void> {
    const service = this.deps.getTabContextStateService()
    const existing = await service.getTabState(this.request.tabId)
    const sameSeries =
      existing?.siteIntegrationId === this.integrationId &&
      existing.mangaId === seriesId
    const payload = buildResolvedTabContext({
      sourceUrl: this.request.url,
      siteIntegrationId: this.integrationId,
      rawMangaId: seriesId,
      chapters: sameSeries ? existing.chapters : [],
      volumes: sameSeries ? existing.volumes : undefined,
      seriesMetadata,
      chaptersLoading: true,
    })
    await service.commitResolvedTabContext(
      payload,
      this.request.tabId,
      this.commitRequest()
    )
  }

  private async persistProbeDataIfCurrent(
    seriesId: string | undefined
  ): Promise<TabContextResolutionOutcome | undefined> {
    const { tabId, windowId, requestId, url, ownerSignal } = this.request
    const tab = await this.withinDeadline(chrome.tabs.get(tabId))
    const currentUrl = resolveTabUrlForSupportCheck(tab)
    const isCurrent = await this.deps.tabContextCache.isRequestIdCurrent(
      windowId,
      requestId
    )
    if (
      ownerSignal.aborted ||
      !tab.active ||
      tab.windowId !== windowId ||
      currentUrl !== url ||
      !isCurrent
    ) {
      logger.debug("Discarding stale tab context result", { tabId, requestId })
      return this.staleOutcome(tab, currentUrl, isCurrent)
    }
    // Accepted ownership starts provider persistence in the same continuation.
    await this.persistProbeData(seriesId)
    return undefined
  }

  private staleOutcome(
    tab: chrome.tabs.Tab,
    currentUrl: string | undefined,
    isCurrent: boolean
  ): TabContextResolutionOutcome {
    return tab.active &&
      tab.windowId === this.request.windowId &&
      currentUrl !== this.request.url &&
      isCurrent
      ? "retry"
      : "completed"
  }

  private async persistProbeData(seriesId: string | undefined): Promise<void> {
    if (
      this.probe?.data === undefined ||
      typeof seriesId !== "string" ||
      !this.providerAdapter?.background.persistPageProbeData
    )
      return
    try {
      await this.providerAdapter.background.persistPageProbeData({
        seriesId,
        pageProbeData: this.probe.data,
      })
    } catch (error) {
      logger.debug("Unable to persist page-probe data", error)
    }
  }

  private async handleFailure(
    error: unknown
  ): Promise<TabContextResolutionOutcome> {
    this.acceptsPartialResults = false
    const { tabId, windowId, requestId, url, tab, ownerSignal } = this.request
    if (ownerSignal.aborted) return "completed"
    logger.error("Tab context resolution failed", {
      tabId,
      windowId,
      requestId,
      integrationId: this.integrationId,
      stage: this.stage,
      url,
      documentUrlAtStart: tab.url,
      pendingUrlAtStart: tab.pendingUrl,
      probeUrl: this.probe?.url,
      durationMs: Math.round(performance.now() - this.request.startedAt),
      error,
    })
    if (
      !(await this.deps.tabContextCache.isRequestIdCurrent(windowId, requestId))
    )
      return "completed"
    const permissionRequired =
      error instanceof SeriesHostPermissionRequiredError
    await initializeTabContext(
      this.deps,
      permissionRequired
        ? {
            context: "error",
            error: error.message,
            reason: "host_permission_required",
            hostPermissionHostname: error.hostname,
          }
        : {
            context: "error",
            error: createUserFacingResolutionError(),
            ...(error instanceof SiteRequestDeniedError
              ? { reason: "provider_access_denied" as const }
              : {}),
          },
      tabId,
      { ...this.commitRequest(), supersedeInFlight: true }
    )
    return "completed"
  }
}

interface InFlightResolution {
  url: string | undefined
  promise: Promise<TabContextResolutionOutcome>
  controller: AbortController
  retryErrors: boolean
}

class TabContextResolver {
  private readonly inFlightByTab = new Map<number, InFlightResolution>()
  private readonly timeoutMs: number
  constructor(private readonly deps: TabContextResolverDependencies) {
    this.timeoutMs = deps.resolutionTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  }

  private async resolveUncoalesced(
    tabId: number,
    expectedUrl: string | undefined,
    options: ResolveTabContextOptions,
    ownerSignal: AbortSignal
  ): Promise<TabContextResolutionOutcome> {
    const startedAt = performance.now()
    await this.deps.beforeResolution?.()
    const start = await this.readStartingTab(
      tabId,
      expectedUrl,
      options,
      ownerSignal
    )
    if ("outcome" in start) return start.outcome
    if (ownerSignal.aborted) return "completed"
    const { tab, url } = start
    const windowId = options.windowId ?? tab.windowId
    const loading = await this.deps.tabContextCache.projectLoadingForTab(
      tabId,
      windowId,
      options.supersedeInFlight === true
    )
    if (!loading || ownerSignal.aborted) return "completed"
    return this.resolveClaimedPage(
      {
        tabId,
        tab,
        windowId,
        requestId: loading.requestId,
        url,
        ownerSignal,
        startedAt,
      },
      options
    )
  }

  private async resolveClaimedPage(
    claim: Omit<TabResolutionRequest, "url"> & { url: string | undefined },
    options: ResolveTabContextOptions
  ): Promise<TabContextResolutionOutcome> {
    const { tabId, windowId, requestId, url, ownerSignal } = claim
    const request = { requestId, windowId, expectedUrl: url, ownerSignal }
    if (!url) {
      await initializeTabContext(
        this.deps,
        { context: "unsupported" },
        tabId,
        request
      )
      return "completed"
    }
    if (await this.restoreCached(tabId, url, options, request, claim.startedAt))
      return "completed"
    const matched = matchUrl(url)
    if (!matched) {
      await initializeTabContext(
        this.deps,
        { context: "unsupported" },
        tabId,
        request
      )
      return "completed"
    }
    return new ProviderTabResolution(
      this.deps,
      { ...claim, url },
      matched.integrationId,
      this.timeoutMs
    ).run()
  }

  private async readStartingTab(
    tabId: number,
    expectedUrl: string | undefined,
    options: ResolveTabContextOptions,
    ownerSignal: AbortSignal
  ): Promise<
    | { outcome: TabContextResolutionOutcome }
    | { tab: chrome.tabs.Tab; url: string | undefined }
  > {
    if (ownerSignal.aborted) return { outcome: "completed" }
    let tab: chrome.tabs.Tab
    try {
      tab = await chrome.tabs.get(tabId)
    } catch (error) {
      logger.debug("Unable to read tab for context resolution", error)
      return { outcome: "completed" }
    }
    if (ownerSignal.aborted) return { outcome: "completed" }
    if (
      typeof options.windowId === "number" &&
      tab.windowId !== options.windowId
    )
      return { outcome: "completed" }
    if (!tab.active)
      return { outcome: ownerSignal.aborted ? "completed" : "retry" }
    const url = resolveTabUrlForSupportCheck(tab)
    if (url !== expectedUrl) {
      logger.debug("Restarting tab context resolution after URL changed", {
        tabId,
        expectedUrl,
        currentUrl: url,
      })
      return { outcome: "retry" }
    }
    return { tab, url }
  }

  private async restoreCached(
    tabId: number,
    url: string,
    options: ResolveTabContextOptions,
    request: ContextCommitRequest,
    startedAt: number
  ): Promise<boolean> {
    if (!options.allowCached) return false
    const memory = this.deps.tabContextCache.getCachedContext(tabId)
    const cached =
      memory !== undefined
        ? memory
        : await this.deps.tabContextCache.readAndCache(tabId)
    if (
      !this.canRestoreCache(
        cached,
        memory !== undefined,
        options.retryErrors === true,
        url
      )
    )
      return false
    await this.deps.tabContextCache.syncActiveTabContext(tabId, cached, request)
    logger.debug("[tab-context] Resolved active tab from cache", {
      tabId,
      windowId: request?.windowId,
      source: memory !== undefined ? "memory" : "session",
      durationMs: Math.round(performance.now() - startedAt),
    })
    return true
  }

  private canRestoreCache(
    cached: TabContextCacheValue,
    inMemory: boolean,
    retryErrors: boolean,
    url: string
  ): boolean {
    return (
      (inMemory || cached !== null) &&
      (!retryErrors || cached === null || !("error" in cached)) &&
      !isIncompleteCachedContext(cached) &&
      isCachedContextForUrl(cached, url)
    )
  }

  async resolveTabContext(
    tabId: number,
    options: ResolveTabContextOptions = {},
    retryCount = 0
  ): Promise<void> {
    let url: string | undefined
    try {
      url = resolveTabUrlForSupportCheck(await chrome.tabs.get(tabId))
    } catch {
      return
    }
    const existing = this.inFlightByTab.get(tabId)
    if (existing?.url === url && !options.supersedeInFlight) {
      await existing.promise
      if (this.requiresFreshErrorRetry(tabId, existing, options))
        return this.resolveTabContext(tabId, options, retryCount)
      return
    }
    const outcome = await this.startResolution(tabId, url, options, existing)
    if (outcome === "retry")
      await this.retryStaleResolution(tabId, options, retryCount)
  }

  private requiresFreshErrorRetry(
    tabId: number,
    existing: InFlightResolution,
    options: ResolveTabContextOptions
  ): boolean {
    const cached = this.deps.tabContextCache.getCachedContext(tabId)
    return !!(
      options.retryErrors &&
      !existing.retryErrors &&
      cached &&
      "error" in cached
    )
  }

  private async startResolution(
    tabId: number,
    url: string | undefined,
    options: ResolveTabContextOptions,
    existing?: InFlightResolution
  ): Promise<TabContextResolutionOutcome> {
    existing?.controller.abort("superseded by a newer tab URL")
    const controller = new AbortController()
    const operation = this.resolveUncoalesced(
      tabId,
      url,
      options,
      controller.signal
    )
    this.inFlightByTab.set(tabId, {
      url,
      promise: operation,
      controller,
      retryErrors: options.retryErrors === true,
    })
    try {
      return await operation
    } finally {
      if (this.inFlightByTab.get(tabId)?.promise === operation)
        this.inFlightByTab.delete(tabId)
    }
  }

  private async retryStaleResolution(
    tabId: number,
    options: ResolveTabContextOptions,
    retryCount: number
  ): Promise<void> {
    if (retryCount < MAX_STALE_RESOLUTION_RETRIES)
      return this.resolveTabContext(
        tabId,
        { ...options, supersedeInFlight: false },
        retryCount + 1
      )
    logger.debug("Giving up stale tab context retry; a newer request owns it", {
      tabId,
    })
  }

  cancelTabContextResolution(tabId: number, reason?: unknown): void {
    const existing = this.inFlightByTab.get(tabId)
    if (!existing) return
    this.inFlightByTab.delete(tabId)
    existing.controller.abort(reason ?? "superseded by external context")
  }
}

export function createTabContextResolver(deps: TabContextResolverDependencies) {
  const resolver = new TabContextResolver(deps)
  return {
    resolveTabContext: resolver.resolveTabContext.bind(resolver),
    cancelTabContextResolution:
      resolver.cancelTabContextResolution.bind(resolver),
  }
}
