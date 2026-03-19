/**
 * Site Overrides Service
 * Stores per-site overrides in chrome.storage.local under key 'siteOverrides'.
 *
 * Flat structure - presence equals enabled:
 *   { [siteId]: {
 *       outputFormat?: 'cbz' | 'zip',
 *       pathTemplate?: string,
 *       rate?: { requestsPerMinute?: number },
 *       retries?: { maxAttempts?: number }
 *   } }
 */

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRatePolicy = (value: unknown): value is { concurrency?: number; delayMs?: number } => {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (value.concurrency !== undefined && typeof value.concurrency !== 'number') return false;
  if (value.delayMs !== undefined && typeof value.delayMs !== 'number') return false;
  return true;
};

const isRetryOverrides = (value: unknown): value is { image?: number; chapter?: number } => {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (value.image !== undefined && typeof value.image !== 'number') return false;
  if (value.chapter !== undefined && typeof value.chapter !== 'number') return false;
  return true;
};

const isSiteOverrideRecord = (value: unknown): value is SiteOverrideRecord => {
  if (!isRecord(value)) return false;
  if (
    value.outputFormat !== undefined
    && value.outputFormat !== 'cbz'
    && value.outputFormat !== 'zip'
    && value.outputFormat !== 'none'
  ) {
    return false;
  }
  if (value.pathTemplate !== undefined && typeof value.pathTemplate !== 'string') return false;
  if (!isRatePolicy(value.imagePolicy)) return false;
  if (!isRatePolicy(value.chapterPolicy)) return false;
  if (!isRetryOverrides(value.retries)) return false;
  return true;
};

export const normalizeSiteOverridesMap = (raw: unknown): SiteOverridesMap => {
  if (!isRecord(raw)) return {};
  const map: SiteOverridesMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isSiteOverrideRecord(value)) {
      map[key] = value;
    }
  }
  return map;
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
