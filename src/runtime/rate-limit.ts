// Bottleneck-based per-site-integration rate limiting
// Provides a simple API to schedule fetches under site integration-specific policies

// Use the light build to avoid Redis/eval code paths and reduce bundle size in MV3/offscreen
import Bottleneck from "bottleneck/light.js"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"

export type RateScope = "image" | "chapter"

export type EffectivePolicy = { concurrency: number; delayMs: number }
export type RateLimitPolicySnapshot = TaskSettingsSnapshot["rateLimitSettings"]

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

function normalizePolicy(p: {
  concurrency: number
  delayMs: number
}): EffectivePolicy {
  return {
    concurrency: Math.min(10, Math.max(1, Number(p.concurrency) || 1)),
    delayMs: Math.max(0, Number(p.delayMs) || 0),
  }
}

export interface RateLimitPolicySource {
  resolveEffectivePolicy(
    integrationId: string,
    scope: RateScope
  ): Promise<EffectivePolicy>
}

export interface RateLimitPolicySourceDependencies {
  settingsReader: {
    getGlobalPolicy(): Promise<{
      image: { concurrency: number; delayMs: number }
      chapter: { concurrency: number; delayMs: number }
    }>
  }
  overridesReader: {
    getAll(): Promise<
      Record<
        string,
        {
          imagePolicy?: Partial<EffectivePolicy>
          chapterPolicy?: Partial<EffectivePolicy>
        }
      >
    >
  }
  getSiteDefaults: (
    integrationId: string,
    scope: RateScope
  ) => Partial<EffectivePolicy> | undefined
}

export class StorageRateLimitPolicySource implements RateLimitPolicySource {
  constructor(private readonly deps: RateLimitPolicySourceDependencies) {}

  async resolveEffectivePolicy(
    integrationId: string,
    scope: RateScope
  ): Promise<EffectivePolicy> {
    const [global, overrides] = await Promise.all([
      this.deps.settingsReader.getGlobalPolicy(),
      this.deps.overridesReader.getAll(),
    ])
    const override = overrides[integrationId]
    return {
      ...global[scope],
      ...(this.deps.getSiteDefaults(integrationId, scope) ?? {}),
      ...(scope === "image"
        ? (override?.imagePolicy ?? {})
        : (override?.chapterPolicy ?? {})),
    }
  }
}

/** Per-runtime scheduler. Policy storage and invalidation are composition-root concerns. */
export class RateLimitService {
  private readonly limiters = new Map<string, Bottleneck>()

  constructor(private readonly policySource: RateLimitPolicySource) {}

  async resolveEffectivePolicy(
    integrationId: string,
    scope: RateScope
  ): Promise<EffectivePolicy> {
    return normalizePolicy(
      await this.policySource.resolveEffectivePolicy(integrationId, scope)
    )
  }

  private async ensureLimiter(
    integrationId: string,
    scope: RateScope,
    policyOverride?: EffectivePolicy
  ): Promise<Bottleneck> {
    const normalizedOverride = policyOverride
      ? normalizePolicy(policyOverride)
      : undefined
    const key = limiterKey(integrationId, scope, normalizedOverride)
    let limiter = this.limiters.get(key)
    if (limiter) return limiter
    const policy =
      normalizedOverride ??
      (await this.resolveEffectivePolicy(integrationId, scope))
    limiter = createLimiter(policy)
    this.limiters.set(key, limiter)
    return limiter
  }

  async scheduleForIntegrationScope<T>(
    integrationId: string,
    scope: RateScope,
    task: () => Promise<T>,
    policyOverride?: EffectivePolicy
  ): Promise<T> {
    const limiter = await this.ensureLimiter(
      integrationId,
      scope,
      policyOverride
    )
    return limiter.schedule(task)
  }

  cleanupRateLimiters(): void {
    const limiters = [...this.limiters.values()]
    this.limiters.clear()
    void Promise.allSettled(limiters.map((limiter) => limiter.disconnect()))
  }
}

export function getRateLimitPolicyFromSnapshot(
  settingsSnapshot: Partial<TaskSettingsSnapshot> | undefined,
  scope: RateScope
): EffectivePolicy | undefined {
  return settingsSnapshot?.rateLimitSettings?.[scope]
}
