/**
 * Site Integration Settings Service
 * Stores per-site integration-defined settings under 'siteIntegrationSettings'.
 */

import { getSiteIntegrationManifestById } from '@/src/site-integrations/manifest'

type StorageValue = string | number | boolean | null | StorageValue[] | { [key: string]: StorageValue };

export type SiteIntegrationSettingValue = StorageValue;

export type SiteIntegrationSettingsMap = Record<string, Record<string, StorageValue>>; // siteId -> { settingId: value }

export const SITE_INTEGRATION_SETTINGS_STORAGE_KEY = 'siteIntegrationSettings';

function toSiteIntegrationSettingsMap(value: unknown): SiteIntegrationSettingsMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as SiteIntegrationSettingsMap;
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
