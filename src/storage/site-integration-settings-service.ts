/**
 * Site Integration Settings Service
 * Stores per-site integration-defined settings under 'siteIntegrationSettings'.
 */

import { getSiteIntegrationManifestById } from '@/src/site-integrations/manifest'
import { type StorageValue } from '@/src/shared/type-guards'
import { z } from 'zod'

export type SiteIntegrationSettingValue = StorageValue;

export type SiteIntegrationSettingsMap = Record<string, Record<string, StorageValue>>; // siteId -> { settingId: value }

export const SITE_INTEGRATION_SETTINGS_STORAGE_KEY = 'siteIntegrationSettings';

const StorageValueSchema: z.ZodType<StorageValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(StorageValueSchema),
  z.record(z.string(), StorageValueSchema),
]))

const SiteIntegrationSettingsRecordSchema = z.record(z.string(), StorageValueSchema)

const SiteIntegrationSettingsMapSchema = z.record(z.string(), z.unknown()).transform((entries) => {
  const normalized: SiteIntegrationSettingsMap = {}
  for (const [siteId, siteSettings] of Object.entries(entries)) {
    const parsed = SiteIntegrationSettingsRecordSchema.safeParse(siteSettings)
    if (parsed.success) {
      normalized[siteId] = parsed.data
    }
  }

  return normalized
})

function toSiteIntegrationSettingsMap(value: unknown): SiteIntegrationSettingsMap {
  const parsed = SiteIntegrationSettingsMapSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}

function getManifestDefaultsForSite(siteId: string): Record<string, StorageValue> {
  const manifest = getSiteIntegrationManifestById(siteId)
  if (!manifest?.customSettings) {
    return {}
  }

  const defaults: Record<string, StorageValue> = {}
  for (const setting of manifest.customSettings) {
    defaults[setting.id] = setting.defaultValue as StorageValue
  }

  return defaults
}

export const siteIntegrationSettingsService = {
  async getAll(): Promise<SiteIntegrationSettingsMap> {
    try {
      const res = await chrome.storage.local.get(SITE_INTEGRATION_SETTINGS_STORAGE_KEY) as Record<string, StorageValue>;
      return toSiteIntegrationSettingsMap(res[SITE_INTEGRATION_SETTINGS_STORAGE_KEY]);
    } catch {
      return {};
    }
  },
  async getForSite(siteId: string): Promise<Record<string, StorageValue>> {
    const all = await this.getAll();
    return {
      ...getManifestDefaultsForSite(siteId),
      ...(all[siteId] || {}),
    };
  },
  async setAll(map: SiteIntegrationSettingsMap): Promise<void> {
    await chrome.storage.local.set({ [SITE_INTEGRATION_SETTINGS_STORAGE_KEY]: map });
  },
  async updateForSite(siteId: string, updates: Record<string, StorageValue>): Promise<void> {
    const all = await this.getAll();
    all[siteId] = { ...(all[siteId] || {}), ...updates };
    await this.setAll(all);
  },
  async clear(): Promise<void> { await chrome.storage.local.set({ [SITE_INTEGRATION_SETTINGS_STORAGE_KEY]: {} }); }
};
