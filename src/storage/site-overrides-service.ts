/**
 * Site Overrides Service
 * Stores per-site overrides in chrome.storage.local under key 'siteOverrides'.
 *
 * Flat structure - presence equals enabled:
 *   { [siteId]: {
 *       outputFormat?: 'cbz' | 'zip' | 'none',
 *       pathTemplate?: string,
 *       rate?: { requestsPerMinute?: number },
 *       retries?: { maxAttempts?: number }
 *   } }
 */

import { ArchiveFormatSchema } from "@/src/shared/download-contract"
import { z } from "zod"
import { StorageMutationQueue } from "./storage-mutation-queue"
import { RATE_POLICY_LIMITS } from "@/src/shared/rate-policy-limits"

export type SiteOverrideRecord = {
  // Format override
  outputFormat?: "cbz" | "zip" | "none"
  // Path override
  pathTemplate?: string
  // Per-scope rate policies (preferred new shape)
  imagePolicy?: { concurrency?: number; delayMs?: number }
  // Chapter concurrency is not accepted as a site override in the current scheduler.
  chapterPolicy?: { delayMs?: number }
  // Retry overrides (preferred new shape)
  retries?: { image?: number; chapter?: number }
}

export type SiteOverridesMap = Record<string, SiteOverrideRecord>

export const SITE_OVERRIDES_STORAGE_KEY = "siteOverrides"

const RatePolicySchema = z.object({
  concurrency: z
    .number()
    .int()
    .min(RATE_POLICY_LIMITS.MIN_CONCURRENCY)
    .max(RATE_POLICY_LIMITS.MAX_CONCURRENCY)
    .optional(),
  delayMs: z
    .number()
    .int()
    .min(RATE_POLICY_LIMITS.MIN_DELAY_MS)
    .max(RATE_POLICY_LIMITS.MAX_DELAY_MS)
    .optional(),
})

const ChapterPolicySchema = z.object({
  delayMs: z
    .number()
    .int()
    .min(RATE_POLICY_LIMITS.MIN_DELAY_MS)
    .max(RATE_POLICY_LIMITS.MAX_DELAY_MS)
    .optional(),
})

const RetryOverridesSchema = z.object({
  image: z.number().optional(),
  chapter: z.number().optional(),
})

const SiteOverrideRecordSchema = z.object({
  outputFormat: ArchiveFormatSchema.optional(),
  pathTemplate: z.string().optional(),
  imagePolicy: RatePolicySchema.optional(),
  chapterPolicy: ChapterPolicySchema.optional(),
  retries: RetryOverridesSchema.optional(),
})

const SiteOverridesMapSchema = z
  .record(z.string(), z.unknown())
  .transform((entries) => {
    const map: SiteOverridesMap = {}
    for (const [key, value] of Object.entries(entries)) {
      const parsed = SiteOverrideRecordSchema.safeParse(value)
      if (parsed.success) {
        map[key] = parsed.data
      }
    }
    return map
  })

const StrictSiteOverridesMapSchema = z.record(
  z.string(),
  SiteOverrideRecordSchema
)

export const normalizeSiteOverridesMap = (raw: unknown): SiteOverridesMap => {
  const parsed = SiteOverridesMapSchema.safeParse(raw)
  return parsed.success ? parsed.data : {}
}

const mutationQueue = new StorageMutationQueue()

async function persistSiteOverrides(map: SiteOverridesMap): Promise<void> {
  const validated = StrictSiteOverridesMapSchema.parse(map)
  await chrome.storage.local.set({ [SITE_OVERRIDES_STORAGE_KEY]: validated })
}

export const siteOverridesService = {
  async getAll(): Promise<SiteOverridesMap> {
    const res = await chrome.storage.local.get(SITE_OVERRIDES_STORAGE_KEY)
    return normalizeSiteOverridesMap(res[SITE_OVERRIDES_STORAGE_KEY])
  },

  async setAll(map: SiteOverridesMap): Promise<void> {
    await mutationQueue.run(() => persistSiteOverrides(map))
  },
  async updateForSite(
    siteId: string,
    updates: SiteOverrideRecord
  ): Promise<void> {
    await mutationQueue.run(async () => {
      const current = await this.getAll()
      current[siteId] = { ...(current[siteId] || {}), ...updates }
      await persistSiteOverrides(current)
    })
  },
  async removeSite(siteId: string): Promise<void> {
    await mutationQueue.run(async () => {
      const current = await this.getAll()
      if (current[siteId]) {
        delete current[siteId]
        await persistSiteOverrides(current)
      }
    })
  },
  async clear(): Promise<void> {
    await mutationQueue.run(() => persistSiteOverrides({}))
  },
}
