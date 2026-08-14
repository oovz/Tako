/**
 * Site Integration Settings Service
 * Stores per-site integration-defined settings under 'siteIntegrationSettings'.
 */

import {
  assertValidSettingsFieldValue,
  getDefinition,
} from "@/src/site-integrations/catalog"
import { StorageMutationQueue } from "./storage-mutation-queue"
import {
  SiteIntegrationSettingsMapSchema,
  type SiteIntegrationSettingsMap,
} from "@/src/domain/site-integrations/storage-schemas"
import type { StorageValue } from "@/src/shared/type-guards"
import { assertKnownSiteIntegrationIds } from "./site-integration-document-validation"

export const SITE_INTEGRATION_SETTINGS_STORAGE_KEY = "siteIntegrationSettings"

export function assertValidCurrentSettings(
  map: SiteIntegrationSettingsMap
): void {
  for (const [siteId, siteSettings] of Object.entries(map)) {
    const manifest = getDefinition(siteId)
    if (!manifest) {
      throw new Error(
        `Unknown site integration ID in stored settings: ${siteId}`
      )
    }
    const schemas = new Map(
      (manifest?.customSettings ?? []).map((schema) => [schema.id, schema])
    )

    for (const [settingId, settingValue] of Object.entries(siteSettings)) {
      const schema = schemas.get(settingId)
      if (!schema) {
        throw new Error(
          `Unknown site integration setting "${siteId}.${settingId}"`
        )
      }
      assertValidSettingsFieldValue(schema, settingValue)
    }
  }
}

/**
 * Parse the current site-integration settings document without persisting it.
 * Options uses this before its single multi-key commit so validation cannot
 * issue a partial write.
 */
export function parseSiteIntegrationSettingsDocument(
  value: unknown
): SiteIntegrationSettingsMap {
  const parsed = SiteIntegrationSettingsMapSchema.parse(value)
  assertValidCurrentSettings(parsed)
  return parsed
}

function getManifestDefaultsForSite(
  siteId: string
): Record<string, StorageValue> {
  const manifest = getDefinition(siteId)
  if (!manifest?.customSettings) {
    return {}
  }

  const defaults: Record<string, StorageValue> = {}
  for (const setting of manifest.customSettings) {
    defaults[setting.id] = setting.defaultValue
  }

  return defaults
}

export class SiteIntegrationSettingsService {
  private readonly mutations = new StorageMutationQueue()

  private async persist(map: SiteIntegrationSettingsMap): Promise<void> {
    const validated = parseSiteIntegrationSettingsDocument(map)
    await chrome.storage.local.set({
      [SITE_INTEGRATION_SETTINGS_STORAGE_KEY]: validated,
    })
  }

  async getAll(): Promise<SiteIntegrationSettingsMap> {
    const res = await chrome.storage.local.get(
      SITE_INTEGRATION_SETTINGS_STORAGE_KEY
    )
    if (!(SITE_INTEGRATION_SETTINGS_STORAGE_KEY in res)) return {}
    return parseSiteIntegrationSettingsDocument(
      res[SITE_INTEGRATION_SETTINGS_STORAGE_KEY]
    )
  }
  async getForSite(siteId: string): Promise<Record<string, StorageValue>> {
    assertKnownSiteIntegrationIds({ [siteId]: {} }, "site integration settings")
    const all = await this.getAll()
    return {
      ...getManifestDefaultsForSite(siteId),
      ...(all[siteId] || {}),
    }
  }
  async setAll(map: SiteIntegrationSettingsMap): Promise<void> {
    await this.mutations.run(() => this.persist(map))
  }
  async updateForSite(
    siteId: string,
    updates: Record<string, StorageValue>
  ): Promise<void> {
    assertKnownSiteIntegrationIds({ [siteId]: {} }, "site integration settings")
    await this.mutations.run(async () => {
      const all = await this.getAll()
      all[siteId] = { ...(all[siteId] || {}), ...updates }
      await this.persist(all)
    })
  }
  async clear(): Promise<void> {
    await this.mutations.run(() => this.persist({}))
  }
}
