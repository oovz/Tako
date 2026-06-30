// Bottleneck-based per-site-integration rate limiting
// Provides a simple API to schedule fetches under site integration-specific policies

// Use the light build to avoid Redis/eval code paths and reduce bundle size in MV3/offscreen
import Bottleneck from 'bottleneck/light.js'
import { settingsService, SETTINGS_STORAGE_KEY } from '@/src/storage/settings-service'
import { findSiteIntegrationForUrl, siteIntegrationRegistry } from '@/src/runtime/site-integration-registry'
import { SITE_INTEGRATION_MANIFESTS, type SiteIntegrationManifest } from '@/src/site-integrations/manifest'
import { siteOverridesService, SITE_OVERRIDES_STORAGE_KEY } from '@/src/storage/site-overrides-service'
import { isRecord } from '@/src/shared/type-guards'
import type { TaskSettingsSnapshot } from '@/src/types/state-snapshots'

export type RateScope = 'image' | 'chapter'

export type EffectivePolicy = { concurrency: number; delayMs: number }
export type RateLimitPolicySnapshot = TaskSettingsSnapshot['rateLimitSettings']

// Maintain limiters per (integrationId + scope)
const limiters = new Map<string, Bottleneck>()

function limiterKey(integrationId: string, scope: RateScope, policy?: EffectivePolicy): string {
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

export async function resolveEffectivePolicy(integrationId: string, scope: RateScope): Promise<EffectivePolicy> {
  let overridePolicy: Partial<EffectivePolicy> | undefined

  try {
    const overrides = await siteOverridesService.getAll()
    const o = overrides[integrationId]
    if (o) {
      overridePolicy = scope === 'image' ? o.imagePolicy : o.chapterPolicy
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

  if (scope === 'chapter') {
    mergedPolicy.concurrency = 1
  }

  return normalizePolicy(mergedPolicy)
}

function normalizePolicy(p: { concurrency: number; delayMs: number }): EffectivePolicy {
  return {
    concurrency: Math.min(10, Math.max(1, Number(p.concurrency) || 1)),
    delayMs: Math.max(0, Number(p.delayMs) || 0),
  }
}

function isDomainMatch(hostname: string, domains: string[]): boolean {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

function pathPatternMatches(pathname: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(pathname)
}

function manifestMatchesSeriesPath(manifest: SiteIntegrationManifest, pathname: string): boolean {
  if (!manifest.patterns.seriesMatches.some((pattern) => pathPatternMatches(pathname, pattern))) {
    return false
  }

  return !(manifest.patterns.excludeMatches ?? []).some((pattern) => pathPatternMatches(pathname, pattern))
}

function resolveKnownIntegrationIdIgnoringUserEnablement(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const pathname = parsed.pathname.length > 1 && parsed.pathname.endsWith('/')
    ? parsed.pathname.replace(/\/+$/, '')
    : parsed.pathname

  const domainMatches = SITE_INTEGRATION_MANIFESTS.filter((manifest) => {
    return manifest.enabled !== false && isDomainMatch(parsed.hostname, manifest.patterns.domains)
  })

  if (domainMatches.length === 0) {
    return null
  }

  if (domainMatches.length === 1) {
    return domainMatches[0].id
  }

  const pathMatches = domainMatches.filter((manifest) => manifestMatchesSeriesPath(manifest, pathname))
  return pathMatches.length === 1 ? pathMatches[0].id : null
}

async function ensureLimiter(integrationId: string, scope: RateScope, policyOverride?: EffectivePolicy): Promise<Bottleneck> {
  const normalizedOverride = policyOverride ? normalizePolicy(policyOverride) : undefined
  const key = limiterKey(integrationId, scope, normalizedOverride)
  let limiter = limiters.get(key)
  if (limiter) return limiter
  const policy = normalizedOverride ?? await resolveEffectivePolicy(integrationId, scope)
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
  settingsSnapshot: TaskSettingsSnapshot | undefined,
  scope: RateScope,
): EffectivePolicy | undefined {
  return settingsSnapshot?.rateLimitSettings?.[scope]
}

export function getRateLimitPolicyFromContext(
  context: Record<string, unknown> | undefined,
  scope: RateScope,
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
  if (typeof concurrency !== 'number' || typeof delayMs !== 'number') {
    return undefined
  }

  return { concurrency, delayMs }
}

export async function rateLimitedFetchByUrlScope(
  url: string,
  scope: RateScope,
  init?: RequestInit,
  policyOverride?: EffectivePolicy,
): Promise<Response> {
  // Ensure cookies are sent for authenticated flows; do not set custom headers by default
  const merged: RequestInit = { credentials: 'include', ...init };
  const integrationId = resolveIntegrationIdFromUrl(url)
  if (!integrationId) return fetch(url, merged)
  const limiter = await ensureLimiter(integrationId, scope, policyOverride)
  return limiter.schedule(() => fetch(url, merged))
}

export async function scheduleForIntegrationScope<T>(
  integrationId: string,
  scope: RateScope,
  task: () => Promise<T>,
  policyOverride?: EffectivePolicy,
): Promise<T> {
  const limiter = await ensureLimiter(integrationId, scope, policyOverride)
  return limiter.schedule(task)
}

// Clear limiter cache when settings or siteOverrides change
try {
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return
      if (changes[SETTINGS_STORAGE_KEY] || changes[SITE_OVERRIDES_STORAGE_KEY]) {
        // Recreate limiters on next use to pick up new policies
        limiters.clear()
      }
    })
  }
} catch {
  // ignore listener issues in non-extension environments
}

