// Bottleneck-based per-site-integration rate limiting
// Provides a simple API to schedule fetches under site integration-specific policies

// Use the light build to avoid Redis/eval code paths and reduce bundle size in MV3/offscreen
import Bottleneck from "bottleneck/light.js"
import {
  settingsService,
  SETTINGS_STORAGE_KEY,
} from "@/src/storage/settings-service"
import {
  findSiteIntegrationForUrl,
  siteIntegrationRegistry,
} from "@/src/runtime/site-integration-registry"
import {
  SITE_INTEGRATION_MANIFESTS,
  type SiteIntegrationManifest,
} from "@/src/site-integrations/manifest"
import {
  siteOverridesService,
  SITE_OVERRIDES_STORAGE_KEY,
} from "@/src/storage/site-overrides-service"
import { isRecord } from "@/src/shared/type-guards"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"
import {
  assertIntegrationRequestUrl,
  assertIntegrationResponseUrl,
} from "@/src/site-integrations/request-policy"
import {
  allowsDeterministicE2eRedirect,
  shouldAcceptDeterministicE2eMockResponse,
} from "./deterministic-e2e-redirect"

export type RateScope = "image" | "chapter"

export type EffectivePolicy = { concurrency: number; delayMs: number }
export type RateLimitPolicySnapshot = TaskSettingsSnapshot["rateLimitSettings"]

// Maintain limiters per (integrationId + scope)
const limiters = new Map<string, Bottleneck>()

function limiterKey(
  integrationId: string,
  scope: RateScope,
  policy?: EffectivePolicy
): string {
  if (!policy) {
    return `${integrationId}:${scope}`
  }

  return `${integrationId}:${scope}:${policy.concurrency}:${policy.delayMs}`
}

function createLimiter(policy: EffectivePolicy): Bottleneck {
  return new Bottleneck({
    // minTime is the inter-task delay; we’ll schedule delay explicitly too for precision
    minTime: Math.max(0, policy.delayMs || 0),
    maxConcurrent: Math.max(1, policy.concurrency || 1),
  })
}

export async function resolveEffectivePolicy(
  integrationId: string,
  scope: RateScope
): Promise<EffectivePolicy> {
  let overridePolicy: Partial<EffectivePolicy> | undefined

  try {
    const overrides = await siteOverridesService.getAll()
    const o = overrides[integrationId]
    if (o) {
      overridePolicy = scope === "image" ? o.imagePolicy : o.chapterPolicy
    }
  } catch {
    // Optional: site overrides may not be available; proceed with defaults
  }

  const info = siteIntegrationRegistry.findById(integrationId)
  const siteDefaults = info?.policyDefaults?.[scope]
  const global = await settingsService.getGlobalPolicy()
  const mergedPolicy = {
    ...global[scope],
    ...(siteDefaults ?? {}),
    ...(overridePolicy ?? {}),
  }

  if (scope === "chapter") {
    mergedPolicy.concurrency = 1
  }

  return normalizePolicy(mergedPolicy)
}

function normalizePolicy(p: {
  concurrency: number
  delayMs: number
}): EffectivePolicy {
  return {
    concurrency: Math.min(10, Math.max(1, Number(p.concurrency) || 1)),
    delayMs: Math.max(0, Number(p.delayMs) || 0),
  }
}

function isDomainMatch(hostname: string, domains: string[]): boolean {
  return domains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  )
}

function pathPatternMatches(pathname: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`).test(pathname)
}

function manifestMatchesSeriesPath(
  manifest: SiteIntegrationManifest,
  pathname: string
): boolean {
  if (
    !manifest.patterns.seriesMatches.some((pattern) =>
      pathPatternMatches(pathname, pattern)
    )
  ) {
    return false
  }

  return !(manifest.patterns.excludeMatches ?? []).some((pattern) =>
    pathPatternMatches(pathname, pattern)
  )
}

function resolveKnownIntegrationIdIgnoringUserEnablement(
  url: string
): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const pathname =
    parsed.pathname.length > 1 && parsed.pathname.endsWith("/")
      ? parsed.pathname.replace(/\/+$/, "")
      : parsed.pathname

  const domainMatches = SITE_INTEGRATION_MANIFESTS.filter((manifest) => {
    return (
      manifest.shipped &&
      isDomainMatch(parsed.hostname, manifest.patterns.domains)
    )
  })

  if (domainMatches.length === 0) {
    return null
  }

  if (domainMatches.length === 1) {
    return domainMatches[0].id
  }

  const pathMatches = domainMatches.filter((manifest) =>
    manifestMatchesSeriesPath(manifest, pathname)
  )
  return pathMatches.length === 1 ? pathMatches[0].id : null
}

async function ensureLimiter(
  integrationId: string,
  scope: RateScope,
  policyOverride?: EffectivePolicy
): Promise<Bottleneck> {
  const normalizedOverride = policyOverride
    ? normalizePolicy(policyOverride)
    : undefined
  const key = limiterKey(integrationId, scope, normalizedOverride)
  let limiter = limiters.get(key)
  if (limiter) return limiter
  const policy =
    normalizedOverride ?? (await resolveEffectivePolicy(integrationId, scope))
  limiter = createLimiter(policy)
  limiters.set(key, limiter)
  return limiter
}

function resolveIntegrationIdFromUrl(url: string): string | null {
  try {
    const info = findSiteIntegrationForUrl(url)
    return info?.id ?? resolveKnownIntegrationIdIgnoringUserEnablement(url)
  } catch {
    return resolveKnownIntegrationIdIgnoringUserEnablement(url)
  }
}

export function getRateLimitPolicyFromSnapshot(
  settingsSnapshot: Partial<TaskSettingsSnapshot> | undefined,
  scope: RateScope
): EffectivePolicy | undefined {
  return settingsSnapshot?.rateLimitSettings?.[scope]
}

export function getRateLimitPolicyFromContext(
  context: Record<string, unknown> | undefined,
  scope: RateScope
): EffectivePolicy | undefined {
  const rateLimitSettings = context?.rateLimitSettings
  if (!isRecord(rateLimitSettings)) {
    return undefined
  }

  const policy = rateLimitSettings[scope]
  if (!isRecord(policy)) {
    return undefined
  }

  const { concurrency, delayMs } = policy
  if (typeof concurrency !== "number" || typeof delayMs !== "number") {
    return undefined
  }

  return { concurrency, delayMs }
}

function createRateLimitedFetchInit(init?: RequestInit): RequestInit {
  // Deterministic E2E rewrites approved provider URLs to a loopback mock
  // server with a test-only DNR rule. Fetch treats that browser-level rewrite
  // as a redirect, so production's `redirect: "error"` policy would reject it
  // before the mock receives the request. The production bundle compiles this
  // flag to false; test builds still require the resulting URL to be loopback
  // before bypassing normal response-origin validation below.
  // Ensure cookies are sent for authenticated flows; do not set custom headers by default
  return {
    credentials: "include",
    ...init,
    // A post-fetch response URL check cannot prevent the redirected request.
    // Reject redirects before the browser follows them.
    redirect: allowsDeterministicE2eRedirect ? "follow" : "error",
  }
}

/**
 * Fetch a known provider URL through that provider's rate limiter and origin
 * policy. Integration callers must use this explicit variant because asset
 * CDNs rarely match the provider's page URL patterns.
 */
export async function rateLimitedFetchForIntegration(
  integrationId: string,
  url: string,
  scope: RateScope,
  init?: RequestInit,
  policyOverride?: EffectivePolicy
): Promise<Response> {
  const merged = createRateLimitedFetchInit(init)
  assertIntegrationRequestUrl(integrationId, url)
  const limiter = await ensureLimiter(integrationId, scope, policyOverride)
  return limiter.schedule(async () => {
    const response = await fetch(url, merged)
    if (!shouldAcceptDeterministicE2eMockResponse(response.url)) {
      assertIntegrationResponseUrl(integrationId, url, response.url)
    }
    return response
  })
}

/**
 * Compatibility helper for callers that only have a URL. New provider code
 * must use {@link rateLimitedFetchForIntegration}; this fallback is retained
 * for generic requests that do not belong to an integration.
 */
export async function rateLimitedFetchByUrlScope(
  url: string,
  scope: RateScope,
  init?: RequestInit,
  policyOverride?: EffectivePolicy
): Promise<Response> {
  const integrationId = resolveIntegrationIdFromUrl(url)
  if (!integrationId) {
    return fetch(url, createRateLimitedFetchInit(init))
  }

  return rateLimitedFetchForIntegration(
    integrationId,
    url,
    scope,
    init,
    policyOverride
  )
}

export async function scheduleForIntegrationScope<T>(
  integrationId: string,
  scope: RateScope,
  task: () => Promise<T>,
  policyOverride?: EffectivePolicy
): Promise<T> {
  const limiter = await ensureLimiter(integrationId, scope, policyOverride)
  return limiter.schedule(task)
}

// Clear limiter cache when settings or siteOverrides change
export function initRateLimitStorageListener(): void {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return
        if (
          changes[SETTINGS_STORAGE_KEY] ||
          changes[SITE_OVERRIDES_STORAGE_KEY]
        ) {
          // Recreate limiters on next use to pick up new policies
          cleanupRateLimiters()
        }
      })
    }
  } catch {
    // ignore listener issues in non-extension environments
  }
}

/**
 * Dispose all cached Bottleneck limiters and clear the cache.
 *
 * The limiters Map is bounded by (integrations × scopes × policyVariations),
 * which is small in practice (~20-50 entries). However, calling this on
 * extension lifecycle events (e.g., SW restart) ensures stale limiters
 * with old policies are not reused.
 */
export function cleanupRateLimiters(): void {
  for (const limiter of limiters.values()) {
    try {
      void limiter.disconnect()
    } catch {
      // ignore disposal errors
    }
  }
  limiters.clear()
}
