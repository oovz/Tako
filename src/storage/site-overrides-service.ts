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

import { ArchiveFormatSchema } from '@/src/shared/download-contract';
import { z } from 'zod';

export type SiteOverrideRecord = {
  // Format override
  outputFormat?: 'cbz' | 'zip' | 'none';
  // Path override
  pathTemplate?: string;
  // Per-scope rate policies (preferred new shape)
  imagePolicy?: { concurrency?: number; delayMs?: number };
  chapterPolicy?: { concurrency?: number; delayMs?: number };
  // Retry overrides (preferred new shape)
  retries?: { image?: number; chapter?: number };
};

export type SiteOverridesMap = Record<string, SiteOverrideRecord>;

export const SITE_OVERRIDES_STORAGE_KEY = 'siteOverrides';

const RatePolicySchema = z.object({
  concurrency: z.number().optional(),
  delayMs: z.number().optional(),
});

const RetryOverridesSchema = z.object({
  image: z.number().optional(),
  chapter: z.number().optional(),
});

const SiteOverrideRecordSchema = z.object({
  outputFormat: ArchiveFormatSchema.optional(),
  pathTemplate: z.string().optional(),
  imagePolicy: RatePolicySchema.optional(),
  chapterPolicy: RatePolicySchema.optional(),
  retries: RetryOverridesSchema.optional(),
});

const SiteOverridesMapSchema = z.record(z.string(), z.unknown()).transform((entries) => {
  const map: SiteOverridesMap = {};
  for (const [key, value] of Object.entries(entries)) {
    const parsed = SiteOverrideRecordSchema.safeParse(value);
    if (parsed.success) {
      map[key] = parsed.data;
    }
  }
  return map;
});

export const normalizeSiteOverridesMap = (raw: unknown): SiteOverridesMap => {
  const parsed = SiteOverridesMapSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
};

export const siteOverridesService = {
  async getAll(): Promise<SiteOverridesMap> {
    try {
      const res = await chrome.storage.local.get(SITE_OVERRIDES_STORAGE_KEY) as Record<string, unknown>;
      return normalizeSiteOverridesMap(res[SITE_OVERRIDES_STORAGE_KEY]);
    } catch {
      return {};
    }
  },

  async setAll(map: SiteOverridesMap): Promise<void> {
    // Store flat format directly
    await chrome.storage.local.set({ [SITE_OVERRIDES_STORAGE_KEY]: map });
  },
  async updateForSite(siteId: string, updates: SiteOverrideRecord): Promise<void> {
    const current = await this.getAll();
    current[siteId] = { ...(current[siteId] || {}), ...updates };
    await this.setAll(current);
  },
  async removeSite(siteId: string): Promise<void> {
    const current = await this.getAll();
    if (current[siteId]) {
      delete current[siteId];
      await this.setAll(current);
    }
  },
  async clear(): Promise<void> {
    await chrome.storage.local.set({ [SITE_OVERRIDES_STORAGE_KEY]: {} });
  },
};
