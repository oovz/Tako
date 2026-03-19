// Bottleneck-based per-site-integration rate limiting
// Provides a simple API to schedule fetches under site integration-specific policies

// Use the light build to avoid Redis/eval code paths and reduce bundle size in MV3/offscreen
import Bottleneck from 'bottleneck/light.js'
import { settingsService, SETTINGS_STORAGE_KEY } from '@/src/storage/settings-service'
import { findSiteIntegrationForUrl, siteIntegrationRegistry } from '@/src/runtime/site-integration-registry'
import { siteOverridesService, SITE_OVERRIDES_STORAGE_KEY } from '@/src/storage/site-overrides-service'

export type RateScope = 'image' | 'chapter'

type EffectivePolicy = { concurrency: number; delayMs: number }

// Maintain limiters per (integrationId + scope)
const limiters = new Map<string, Bottleneck>()

function limiterKey(integrationId: string, scope: RateScope): string {
  return `${integrationId}:${scope}`
}

function createLimiter(policy: EffectivePolicy): Bottleneck {
  return new Bottleneck({
    // minTime is the inter-task delay; we’ll schedule delay explicitly too for precision
    minTime: Math.max(0, policy.delayMs || 0),
    maxConcurrent: Math.max(1, policy.concurrency || 1),
  })
}

export async function resolveEffectivePolicy(integrationId: string, scope: RateScope): Promise<EffectivePolicy> {
  // 1) Site override (if exists)
  try {
    const overrides = await siteOverridesService.getAll()
    const o = overrides[integrationId]
    if (o) {
      const policy = (scope === 'image' ? o.imagePolicy : o.chapterPolicy)
      if (policy && (policy.concurrency != null || policy.delayMs != null)) {
        return normalizePolicy({
          concurrency: policy.concurrency ?? 2,
          delayMs: policy.delayMs ?? 500,
        })
      }
    }
  } catch {
    // Optional: site overrides may not be available; proceed with defaults
  }

  // 2) Site integration policy defaults (if provided)
  const info = siteIntegrationRegistry.findById(integrationId)
  const defaults = info?.policyDefaults?.[scope]
  if (defaults) {
    return normalizePolicy({
      concurrency: defaults.concurrency ?? 2,
      delayMs: defaults.delayMs ?? 500,
    })
  }

  // 3) Global defaults
  const global = await settingsService.getGlobalPolicy()
  return normalizePolicy(global[scope])
}

function normalizePolicy(p: { concurrency: number; delayMs: number }): EffectivePolicy {
  return {
    concurrency: Math.min(10, Math.max(1, Number(p.concurrency) || 1)),
    delayMs: Math.max(0, Number(p.delayMs) || 0),
  }
}

async function ensureLimiter(integrationId: string, scope: RateScope): Promise<Bottleneck> {
  const key = limiterKey(integrationId, scope)
  let limiter = limiters.get(key)
  if (limiter) return limiter
  const policy = await resolveEffectivePolicy(integrationId, scope)
  limiter = createLimiter(policy)
  limiters.set(key, limiter)
  return limiter
}

function resolveIntegrationIdFromUrl(url: string): string | null {
  try {
    const info = findSiteIntegrationForUrl(url)
    return info?.id ?? null
  } catch {
    return null
  }
}

export async function rateLimitedFetchByUrlScope(url: string, scope: RateScope, init?: RequestInit): Promise<Response> {
  // Ensure cookies are sent for authenticated flows; do not set custom headers by default
  const merged: RequestInit = { credentials: 'include', ...init };
  const integrationId = resolveIntegrationIdFromUrl(url)
  if (!integrationId) return fetch(url, merged)
  const limiter = await ensureLimiter(integrationId, scope)
  return limiter.schedule(() => fetch(url, merged))
}

export async function scheduleForIntegrationScope<T>(integrationId: string, scope: RateScope, task: () => Promise<T>): Promise<T> {
  const limiter = await ensureLimiter(integrationId, scope)
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

